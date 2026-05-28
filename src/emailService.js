import net from 'node:net';
import tls from 'node:tls';

const readLine=(socket)=>new Promise((resolve,reject)=>{let data=''; const onData=(chunk)=>{data+=chunk.toString('utf8'); const lines=data.split(/\r?\n/).filter(Boolean); if(lines.length&&/^\d{3} /.test(lines[lines.length-1])){cleanup(); resolve(data);} }; const onError=(e)=>{cleanup(); reject(e);}; const onTimeout=()=>{cleanup(); reject(new Error('SMTP timeout while waiting for server response'));}; const cleanup=()=>{socket.off('data',onData); socket.off('error',onError); socket.off('timeout',onTimeout);}; socket.on('data',onData); socket.on('error',onError); socket.on('timeout',onTimeout);});
const sendCmd=async(socket,cmd,ok=[250])=>{ if(cmd) socket.write(`${cmd}\r\n`); const res=await readLine(socket); const code=Number(res.slice(0,3)); if(!ok.includes(code)) throw new Error(`SMTP command failed (${cmd||'connect'}): ${res.trim()}`); return res; };
const b64=(v)=>Buffer.from(String(v||''),'utf8').toString('base64');
const header=(v)=>String(v||'').replace(/[\r\n]+/g,' ');
const addr=(v)=>`<${String(v||'').replace(/[<>\r\n]/g,'').trim()}>`;

function buildMime({from,to,subject,body,attachments=[]}){
  const boundary=`----=_ERP_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const parts=[
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    body||''
  ];
  for(const a of attachments){
    const content=Buffer.isBuffer(a.content)?a.content:Buffer.from(a.content||'');
    parts.push(`--${boundary}`,'Content-Type: '+(a.contentType||'application/octet-stream')+`; name="${header(a.filename)}"`,'Content-Transfer-Encoding: base64',`Content-Disposition: attachment; filename="${header(a.filename)}"`,'',content.toString('base64').replace(/.{1,76}/g,'$&\r\n').trim());
  }
  parts.push(`--${boundary}--`,'');
  return [`From: ${header(from)}`,`To: ${Array.isArray(to)?to.join(', '):to}`,`Subject: ${header(subject)}`,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`,'',...parts].join('\r\n');
}

export function resolveSmtpSettings(overrides={}){
  const SMTP_HOST=overrides.SMTP_HOST??overrides.smtpHost??process.env.SMTP_HOST;
  const SMTP_PORT=overrides.SMTP_PORT??overrides.smtpPort??process.env.SMTP_PORT;
  const SMTP_USER=overrides.SMTP_USER??overrides.smtpUser??process.env.SMTP_USER;
  const SMTP_PASS=overrides.SMTP_PASS??overrides.smtpPass??process.env.SMTP_PASS;
  const SMTP_FROM=overrides.SMTP_FROM??overrides.fromEmail??process.env.SMTP_FROM??SMTP_USER;
  return {SMTP_HOST,SMTP_PORT,SMTP_USER,SMTP_PASS,SMTP_FROM};
}

export function validateSmtpSettings(settings=resolveSmtpSettings()){
  const missing=[];
  if(!settings.SMTP_HOST) missing.push('SMTP_HOST');
  if(!settings.SMTP_PORT) missing.push('SMTP_PORT');
  if(!settings.SMTP_USER) missing.push('SMTP_USER');
  if(!settings.SMTP_PASS) missing.push('SMTP_PASS');
  if(missing.length) throw new Error(`SMTP settings are missing. Set ${missing.join(', ')}. SMTP_FROM is optional and defaults to SMTP_USER.`);
  if(Number.isNaN(Number(settings.SMTP_PORT))) throw new Error('SMTP_PORT must be a number.');
}

export function formatSmtpError(error){
  const raw=String(error?.message||error||'SMTP send failed');
  const code=String(error?.code||'');
  const response=String(error?.response||'');
  const text=[raw,code,response].join(' ');
  if(/auth|535|534|invalid login|credentials|username|password/i.test(text)) return `SMTP authentication failed. Check SMTP_USER and SMTP_PASS. Gmail requires an App Password when 2FA is enabled. Details: ${raw}`;
  if(/certificate|tls|ssl|starttls|self signed/i.test(text)) return `SMTP TLS/SSL negotiation failed. Check SMTP_PORT and provider security settings. Details: ${raw}`;
  if(/ECONNREFUSED|connection refused/i.test(text)) return `SMTP connection refused. Check SMTP_HOST, SMTP_PORT, and provider firewall settings. Details: ${raw}`;
  if(/ETIMEDOUT|timeout|timed out/i.test(text)) return `SMTP connection timed out. Check SMTP_HOST, SMTP_PORT, and network access. Details: ${raw}`;
  if(/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(text)) return `SMTP host could not be resolved. Check SMTP_HOST. Details: ${raw}`;
  return raw;
}

async function sendWithNodemailer({to,subject,body,attachments},settings){
  try{
    const nodemailer=await import('nodemailer');
    const transporter=nodemailer.default.createTransport({
      host:settings.SMTP_HOST,
      port:Number(settings.SMTP_PORT),
      secure:false,
      auth:{user:settings.SMTP_USER,pass:settings.SMTP_PASS}
    });
    return await transporter.sendMail({from:settings.SMTP_FROM||settings.SMTP_USER,to,subject,text:body,attachments});
  }catch(e){ if(e.code==='ERR_MODULE_NOT_FOUND'||/Cannot find package 'nodemailer'/.test(e.message)) return null; throw e; }
}

export async function sendInvoiceEmail({to,subject,body,attachments=[],settings}){
  const smtp=resolveSmtpSettings(settings);
  validateSmtpSettings(smtp);
  try{
    const nodemailerResult=await sendWithNodemailer({to,subject,body,attachments},smtp);
    if(nodemailerResult) return nodemailerResult;
    const port=Number(smtp.SMTP_PORT); const secure=port===465;
    let socket=secure?tls.connect({host:smtp.SMTP_HOST,port,servername:smtp.SMTP_HOST,timeout:30000}):net.connect({host:smtp.SMTP_HOST,port,timeout:30000});
    socket.setTimeout(30000);
    await new Promise((resolve,reject)=>{socket.once('connect',resolve); socket.once('secureConnect',resolve); socket.once('error',reject); socket.once('timeout',()=>reject(new Error('SMTP connection timeout')));});
    try{
      await sendCmd(socket,null,[220]);
      let hello=await sendCmd(socket,`EHLO ${smtp.SMTP_HOST}`,[250]);
      if(!secure&&/STARTTLS/i.test(hello)){ await sendCmd(socket,'STARTTLS',[220]); socket=tls.connect({socket,servername:smtp.SMTP_HOST}); socket.setTimeout(30000); await new Promise((resolve,reject)=>{socket.once('secureConnect',resolve); socket.once('error',reject); socket.once('timeout',()=>reject(new Error('SMTP TLS timeout')));}); await sendCmd(socket,`EHLO ${smtp.SMTP_HOST}`,[250]); }
      await sendCmd(socket,'AUTH LOGIN',[334]); await sendCmd(socket,b64(smtp.SMTP_USER),[334]); await sendCmd(socket,b64(smtp.SMTP_PASS),[235]);
      const recipients=Array.isArray(to)?to:[to];
      await sendCmd(socket,`MAIL FROM:${addr(smtp.SMTP_FROM||smtp.SMTP_USER)}`,[250]);
      for(const r of recipients) await sendCmd(socket,`RCPT TO:${addr(r)}`,[250,251]);
      await sendCmd(socket,'DATA',[354]);
      socket.write(buildMime({from:smtp.SMTP_FROM||smtp.SMTP_USER,to:recipients,subject,body,attachments}).replace(/\r?\n\.\r?\n/g,'\r\n..\r\n')+'\r\n.\r\n');
      await sendCmd(socket,null,[250]);
      await sendCmd(socket,'QUIT',[221]);
      return {messageId:`smtp-${Date.now()}`};
    } finally { socket.destroy(); }
  }catch(e){ throw new Error(formatSmtpError(e)); }
}

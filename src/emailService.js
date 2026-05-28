import net from 'node:net';
import tls from 'node:tls';

const readLine=(socket)=>new Promise((resolve,reject)=>{let data=''; const onData=(chunk)=>{data+=chunk.toString('utf8'); const lines=data.split(/\r?\n/).filter(Boolean); if(lines.length&&/^\d{3} /.test(lines[lines.length-1])){cleanup(); resolve(data);} }; const onError=(e)=>{cleanup(); reject(e);}; const cleanup=()=>{socket.off('data',onData); socket.off('error',onError);}; socket.on('data',onData); socket.on('error',onError);});
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

async function sendWithNodemailer({to,subject,body,attachments},settings){
  try{
    const nodemailer=await import('nodemailer');
    const transporter=nodemailer.default.createTransport({host:settings.SMTP_HOST,port:Number(settings.SMTP_PORT),secure:Number(settings.SMTP_PORT)===465,auth:settings.SMTP_USER||settings.SMTP_PASS?{user:settings.SMTP_USER,pass:settings.SMTP_PASS}:undefined});
    return await transporter.sendMail({from:settings.SMTP_FROM,to,subject,text:body,attachments});
  }catch(e){ if(e.code==='ERR_MODULE_NOT_FOUND'||/Cannot find package 'nodemailer'/.test(e.message)) return null; throw e; }
}

export async function sendInvoiceEmail({to,subject,body,attachments=[]}){
  const {SMTP_HOST,SMTP_PORT,SMTP_USER,SMTP_PASS,SMTP_FROM}=process.env;
  if(!SMTP_HOST||!SMTP_PORT||!SMTP_FROM) throw new Error('SMTP settings are missing. Set SMTP_HOST, SMTP_PORT, and SMTP_FROM.');
  const nodemailerResult=await sendWithNodemailer({to,subject,body,attachments},{SMTP_HOST,SMTP_PORT,SMTP_USER,SMTP_PASS,SMTP_FROM});
  if(nodemailerResult) return nodemailerResult;
  const port=Number(SMTP_PORT); const secure=port===465;
  let socket=secure?tls.connect({host:SMTP_HOST,port,servername:SMTP_HOST}):net.connect({host:SMTP_HOST,port});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve); socket.once('secureConnect',resolve); socket.once('error',reject);});
  try{
    await sendCmd(socket,null,[220]);
    let hello=await sendCmd(socket,`EHLO ${SMTP_HOST}`,[250]);
    if(!secure&&/STARTTLS/i.test(hello)){ await sendCmd(socket,'STARTTLS',[220]); socket=tls.connect({socket,servername:SMTP_HOST}); await new Promise((resolve,reject)=>{socket.once('secureConnect',resolve); socket.once('error',reject);}); await sendCmd(socket,`EHLO ${SMTP_HOST}`,[250]); }
    if(SMTP_USER||SMTP_PASS){ await sendCmd(socket,'AUTH LOGIN',[334]); await sendCmd(socket,b64(SMTP_USER),[334]); await sendCmd(socket,b64(SMTP_PASS),[235]); }
    const recipients=Array.isArray(to)?to:[to];
    await sendCmd(socket,`MAIL FROM:${addr(SMTP_FROM)}`,[250]);
    for(const r of recipients) await sendCmd(socket,`RCPT TO:${addr(r)}`,[250,251]);
    await sendCmd(socket,'DATA',[354]);
    socket.write(buildMime({from:SMTP_FROM,to:recipients,subject,body,attachments}).replace(/\r?\n\.\r?\n/g,'\r\n..\r\n')+'\r\n.\r\n');
    await sendCmd(socket,null,[250]);
    await sendCmd(socket,'QUIT',[221]);
    return {messageId:`smtp-${Date.now()}`};
  } finally { socket.destroy(); }
}

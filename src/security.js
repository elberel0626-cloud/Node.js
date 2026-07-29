import crypto from 'node:crypto';
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const COOKIE_NAME = '__Host-erp_session';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const nowIso = () => new Date().toISOString();
const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const safeEqual = (a, b) => {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const duration = (name, fallback) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 60_000) throw new Error(`${name} must be at least 60000 milliseconds`);
  return value;
};

export const ALL_PERMISSIONS = Object.freeze([
  'AP_BILL_READ','AP_BILL_CREATE','AP_BILL_EDIT','AP_BILL_DELETE','AP_BILL_SUBMIT','AP_BILL_APPROVE','AP_BILL_POST','AP_BILL_VOID','AP_PAYMENT_CREATE','AP_PAYMENT_APPROVE','AP_PAYMENT_RELEASE','AP_VENDOR_READ','AP_VENDOR_EDIT','AP_VENDOR_BANK_EDIT','AP_APPROVAL_RULE_ADMIN','AP_MATCH_OVERRIDE',
  'AR_DOCUMENT_READ','AR_DOCUMENT_CREATE','AR_DOCUMENT_EDIT','AR_DOCUMENT_POST','AR_DOCUMENT_VOID','AR_PAYMENT_CREATE','AR_PAYMENT_APPLY',
  'GL_JOURNAL_CREATE','GL_JOURNAL_EDIT','GL_JOURNAL_POST','GL_JOURNAL_REVERSE','GL_RECLASSIFY','FINANCIAL_PERIOD_CLOSE','FINANCIAL_PERIOD_REOPEN',
  'PO_CREATE','PO_APPROVE','PO_RECEIVE','PO_VOID','INVENTORY_READ','INVENTORY_ADJUST','INVENTORY_POST','INVENTORY_TRANSFER',
  'USER_ADMIN','ROLE_ADMIN','SECURITY_AUDIT_READ','SYSTEM_CONFIGURATION_ADMIN'
]);

export const ROLE_PERMISSIONS = Object.freeze({
  Admin: ALL_PERMISSIONS,
  Controller: ['AP_BILL_READ','AP_BILL_APPROVE','AP_BILL_POST','AP_BILL_VOID','AP_PAYMENT_APPROVE','AP_PAYMENT_RELEASE','AP_VENDOR_READ','AR_DOCUMENT_READ','AR_DOCUMENT_POST','AR_DOCUMENT_VOID','GL_JOURNAL_CREATE','GL_JOURNAL_EDIT','GL_JOURNAL_POST','GL_JOURNAL_REVERSE','GL_RECLASSIFY','FINANCIAL_PERIOD_CLOSE','FINANCIAL_PERIOD_REOPEN','PO_APPROVE','INVENTORY_READ','INVENTORY_POST'],
  'AP Manager': ['AP_BILL_READ','AP_BILL_CREATE','AP_BILL_EDIT','AP_BILL_SUBMIT','AP_BILL_APPROVE','AP_PAYMENT_CREATE','AP_PAYMENT_APPROVE','AP_VENDOR_READ','AP_VENDOR_EDIT','AP_VENDOR_BANK_EDIT','AP_MATCH_OVERRIDE'],
  'AP Clerk': ['AP_BILL_READ','AP_BILL_CREATE','AP_BILL_EDIT','AP_BILL_SUBMIT','AP_PAYMENT_CREATE','AP_VENDOR_READ'],
  'Procurement Approver': ['AP_BILL_READ','PO_CREATE','PO_APPROVE','PO_RECEIVE','AP_VENDOR_READ'],
  'IT Manager': ['AP_BILL_READ','AP_BILL_APPROVE'], 'Project Manager': ['AP_BILL_READ','AP_BILL_APPROVE'],
  CFO: ['AP_BILL_READ','AP_BILL_APPROVE','AP_PAYMENT_APPROVE','AP_PAYMENT_RELEASE','GL_JOURNAL_POST','FINANCIAL_PERIOD_CLOSE'], CEO: ['AP_BILL_READ','AP_BILL_APPROVE']
});

export class SecurityError extends Error { constructor(statusCode, message, code='SECURITY_ERROR') { super(message); this.statusCode=statusCode; this.code=code; } }

export class FileSecurityStore {
  constructor(root = path.resolve('data/security')) { this.root=root; this.sessionPath=path.join(root,'sessions.json'); this.userPath=path.join(root,'users.json'); this.auditPath=path.join(root,'audit.jsonl'); this.sessions=[]; this.users=[]; this.writeQueues=new Map(); }
  async init() { await mkdir(this.root,{recursive:true}); this.sessions=await readFile(this.sessionPath,'utf8').then(JSON.parse).catch(()=>[]); this.users=await readFile(this.userPath,'utf8').then(JSON.parse).catch(()=>[]); }
  atomicWrite(file, value) {
    // Capture before yielding: a later mutation must never leak into, or be
    // overwritten by, this queued write.
    const snapshot=JSON.stringify(value,null,2);
    const previous=this.writeQueues.get(file)||Promise.resolve();
    const write=previous.catch(()=>{}).then(async()=>{
      const temporary=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try { await writeFile(temporary,snapshot,{mode:0o600}); await rename(temporary,file); }
      catch(error) { await rm(temporary,{force:true}).catch(()=>{}); throw error; }
    });
    this.writeQueues.set(file,write);
    return write.finally(()=>{ if(this.writeQueues.get(file)===write)this.writeQueues.delete(file); });
  }
  async saveSessions() { await this.atomicWrite(this.sessionPath,this.sessions); }
  async saveUsers() { await this.atomicWrite(this.userPath,this.users); }
  async audit(event) { await appendFile(this.auditPath,`${JSON.stringify(event)}\n`,{mode:0o600}); }
}

export class SecurityService {
  constructor({store, appOrigin=process.env.APP_ORIGIN}) { this.store=store; this.appOrigin=appOrigin; this.idleMs=duration('SESSION_IDLE_TIMEOUT_MS',30*60_000); this.absoluteMs=duration('SESSION_ABSOLUTE_TIMEOUT_MS',12*60*60_000); this.loginAttempts=new Map(); }
  async init() { await this.store.init(); await this.bootstrap(); }
  async bootstrap() {
    const admins=this.store.users.filter(u=>u.active && (u.roles||[]).includes('Admin'));
    if(admins.length) return;
    const email=String(process.env.BOOTSTRAP_ADMIN_EMAIL||'').trim().toLowerCase(), password=String(process.env.BOOTSTRAP_ADMIN_PASSWORD||'');
    if(!email&&!password) { if(process.env.NODE_ENV==='production') throw new Error('Production requires an existing administrator or secure bootstrap configuration'); return; }
    if(!email||!password||password.length<14||/^(admin|password|changeme|123456)/i.test(password)||password.toLowerCase().includes(email.split('@')[0])) throw new Error('Bootstrap administrator credentials do not meet security requirements');
    if(process.env.NODE_ENV==='production') throw new Error('BOOTSTRAP_ADMIN_PASSWORD is not permitted in production');
    const { hash } = await import('argon2');
    const passwordHash=await hash(password,{type:2,memoryCost:19456,timeCost:2,parallelism:1});
    this.store.users.push({id:crypto.randomUUID(),email,name:'Bootstrap Administrator',passwordHash,roles:['Admin'],active:true,mustChangePassword:true,companies:['*'],branches:['*'],departments:['*'],createdAt:nowIso()});
    await this.store.saveUsers();
  }
  cookie(token,maxAge=Math.floor(this.absoluteMs/1000)) { return `${COOKIE_NAME}=${token}; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Strict; Path=/`; }
  clearCookie() { return `${COOKIE_NAME}=; Max-Age=0; Secure; HttpOnly; SameSite=Strict; Path=/`; }
  tokenFrom(req) { const raw=(String(req.headers.cookie||'').match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`))||[])[1]||''; try { return decodeURIComponent(raw); } catch { return ''; } }
  async createSession(user,req) { const token=crypto.randomBytes(32).toString('base64url'), time=Date.now(); const record={id:crypto.randomUUID(),tokenHash:hashToken(token),userId:user.id,createdAt:new Date(time).toISOString(),lastSeenAt:new Date(time).toISOString(),idleExpiresAt:new Date(time+this.idleMs).toISOString(),absoluteExpiresAt:new Date(time+this.absoluteMs).toISOString(),revokedAt:null,createdIp:req.socket.remoteAddress||'',userAgent:String(req.headers['user-agent']||'').slice(0,512),csrfTokenHash:null}; this.store.sessions.push(record); await this.store.saveSessions(); return {token,record}; }
  async authenticate(req) { const token=this.tokenFrom(req); if(!TOKEN_PATTERN.test(token)) return null; const record=this.store.sessions.find(s=>safeEqual(s.tokenHash,hashToken(token))); if(!record||record.revokedAt||Date.parse(record.idleExpiresAt)<=Date.now()||Date.parse(record.absoluteExpiresAt)<=Date.now()) return null; const user=this.store.users.find(u=>u.id===record.userId&&u.active); if(!user) { record.revokedAt=record.revokedAt||nowIso(); await this.store.saveSessions(); return null; } record.lastSeenAt=nowIso(); record.idleExpiresAt=new Date(Math.min(Date.now()+this.idleMs,Date.parse(record.absoluteExpiresAt))).toISOString(); await this.store.saveSessions(); return {user,session:record}; }
  permissions(user) { return new Set((user.roles||[]).flatMap(role=>ROLE_PERMISSIONS[role]||[])); }
  requirePermission(req,permission) { if(!req.auth) throw new SecurityError(401,'Authentication required','UNAUTHENTICATED'); if(!this.permissions(req.auth.user).has(permission)) throw new SecurityError(403,'Permission denied','FORBIDDEN'); }
  async csrf(req) { const token=crypto.randomBytes(32).toString('base64url'); req.auth.session.csrfTokenHash=hashToken(token); await this.store.saveSessions(); return token; }
  verifyCsrf(req) { if(!this.appOrigin) throw new SecurityError(500,'Security configuration error'); if(String(req.headers.origin||'')!==this.appOrigin) throw new SecurityError(403,'Invalid request origin','CSRF'); const supplied=String(req.headers['x-csrf-token']||''); if(!TOKEN_PATTERN.test(supplied)||!req.auth.session.csrfTokenHash||!safeEqual(hashToken(supplied),req.auth.session.csrfTokenHash)) throw new SecurityError(403,'Invalid CSRF token','CSRF'); }
  async revoke(session,all=false) { for(const item of this.store.sessions) if((all?item.userId===session.userId:item.id===session.id)&&!item.revokedAt)item.revokedAt=nowIso(); await this.store.saveSessions(); }
  async audit(req, action, result, extra={}) { const auth=req.auth||{}; await this.store.audit({eventId:crypto.randomUUID(),timestamp:nowIso(),requestId:req.requestId,userId:auth.user?.id||null,sessionIdHash:auth.session?hashToken(auth.session.id):null,action,entityType:extra.entityType||null,entityId:extra.entityId||null,result,reason:extra.reason||null,sourceIp:req.socket.remoteAddress||'',userAgent:String(req.headers['user-agent']||'').slice(0,512),metadata:extra.metadata||{}}); }
  limitLogin(key) { const cutoff=Date.now()-15*60_000; const entries=(this.loginAttempts.get(key)||[]).filter(t=>t>cutoff); this.loginAttempts.set(key,entries); if(entries.length>=5) throw new SecurityError(429,'Too many login attempts','RATE_LIMIT'); return entries.length; }
  failedLogin(key) { const entries=this.loginAttempts.get(key)||[]; entries.push(Date.now()); this.loginAttempts.set(key,entries); }
  successfulLogin(key) { this.loginAttempts.delete(key); }
}

export function securityHeaders(req,res) {
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('Strict-Transport-Security','max-age=31536000; includeSubDomains'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()'); res.setHeader('Cross-Origin-Opener-Policy','same-origin'); res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  if(req.url?.startsWith('/api/')||req.headers.cookie?.includes(`${COOKIE_NAME}=`)) res.setHeader('Cache-Control','no-store');
}

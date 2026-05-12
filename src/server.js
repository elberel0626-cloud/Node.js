import http from 'node:http';
import { parse } from 'node:url';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { arDocuments, branchMaster, creditTerms, customers, glAccounts, itemMaster, journalEntries } from './data/seed.js';

const publicDir = path.resolve('public');
const json=(res,c,d)=>{res.writeHead(c,{'Content-Type':'application/json'});res.end(JSON.stringify(d));};
const body=(req)=>new Promise((resolve,reject)=>{let r='';req.on('data',c=>r+=c);req.on('end',()=>{try{resolve(r?JSON.parse(r):{});}catch{reject(new Error('Invalid JSON'));}});req.on('error',reject);});
const acct=(code)=>glAccounts.find(a=>a.code===code); const bump=(code,side,amt)=>{const a=acct(code);if(!a)return;a.balance+=(a.normal===side?amt:-amt)};
const nextId=(prefix)=>`${prefix}-${String(arDocuments.filter(d=>d.id.startsWith(prefix+'-')).length+1001).padStart(4,'0')}`;
function postJE(doc,reverse=false){
  const amt=Number(doc.amount||0); let lines=[];
  if(doc.type==='Invoice'){
    const tax=Number(doc.taxTotal||0); const net=amt-tax;
    lines=[{a:'1100',dr:amt,cr:0},{a:'4000',dr:0,cr:net}]; if(tax>0) lines.push({a:'2100',dr:0,cr:tax});
    if(doc.cogsTotal) { lines.push({a:'5000',dr:Number(doc.cogsTotal),cr:0},{a:'1200',dr:0,cr:Number(doc.cogsTotal)}); }
  }
  if(doc.type==='Debit Memo') lines=[{a:'1100',dr:amt,cr:0},{a:'4050',dr:0,cr:amt}];
  if(doc.type==='Credit Memo') lines=[{a:'1100',dr:0,cr:amt},{a:'4050',dr:amt,cr:0}];
  if(doc.type==='Payment') lines=[{a:'1000',dr:amt,cr:0},{a:'1100',dr:0,cr:amt}];
  if(reverse) lines=lines.map(l=>({a:l.a,dr:l.cr,cr:l.dr}));
  lines.forEach(l=>{if(l.dr)bump(l.a,'Debit',l.dr);if(l.cr)bump(l.a,'Credit',l.cr);});
  journalEntries.push({jeNumber:`JE${String(journalEntries.length+1).padStart(6,'0')}`,batchNumber:`BATCH-${String(journalEntries.length+1).padStart(6,'0')}`,module:doc.type==='Payment'?'AR':doc.type,description:`Auto from ${doc.id}`,financialPeriod:(doc.date||new Date().toISOString().slice(0,10)).slice(0,7),transactionDate:doc.date||new Date().toISOString().slice(0,10),status:'Posted',sourceRef:doc.id,createdBy:'system',createdDate:new Date().toISOString(),lines:lines.map(l=>({branch:'100',branchName:'Chicago HQ',account:l.a,debit:l.dr,credit:l.cr,sourceReference:doc.id}))});
}
async function serve(p,res){ if(p==='/app.js'||p==='/styles.css'){const c=await readFile(path.join(publicDir,p.slice(1)));res.writeHead(200,{'Content-Type':p.endsWith('.css')?'text/css':'application/javascript'});res.end(c);return true;} if(!p.startsWith('/api')){const c=await readFile(path.join(publicDir,'index.html'));res.writeHead(200,{'Content-Type':'text/html'});res.end(c);return true;} return false; }

const server=http.createServer(async(req,res)=>{const {pathname,query}=parse(req.url,true); const method=req.method||'GET'; try{
 if(method==='GET'&&await serve(pathname,res)) return;
 if(method==='POST'&&pathname==='/api/auth/login'){const b=await body(req); return b.username==='admin'&&b.password==='admin'?json(res,200,{ok:true}):json(res,401,{error:'Invalid'});}
 if(method==='GET'&&pathname==='/api/ar/customers') return json(res,200,customers);
 if(method==='GET'&&pathname==='/api/ar/credit-terms') return json(res,200,creditTerms);
 if(method==='GET'&&pathname==='/api/finance/branches') return json(res,200,branchMaster);

 if(method==='GET'&&pathname==='/api/inventory/items') return json(res,200,itemMaster);

 if(method==='GET'&&pathname==='/api/ar/open-invoices'){ const cid=query.customerId; const data=arDocuments.filter(d=>d.type==='Invoice'&&d.customerId===cid&&d.balance>0&&d.status!=='Voided'&&d.status!=='Closed'&&d.status!=='Paid'); return json(res,200,data); }
 if(method==='GET'&&pathname==='/api/ar/documents'){ let data=[...arDocuments]; if(query.type)data=data.filter(d=>d.type===query.type); if(query.customerId)data=data.filter(d=>d.customerId===query.customerId); if(query.status)data=data.filter(d=>d.status===query.status); return json(res,200,data); }
 if(method==='GET'&&pathname.startsWith('/api/ar/documents/')){const id=pathname.split('/').pop(); const d=arDocuments.find(x=>x.id===id); return d?json(res,200,d):json(res,404,{error:'Not found'});}
 if(method==='POST'&&pathname==='/api/ar/documents'){ const b=await body(req); if(!b.customerId) return json(res,400,{error:'Customer required'}); const customer=customers.find(c=>c.id===b.customerId); if(!customer) return json(res,400,{error:'Invalid customer'}); if(customer.status==='On Hold') return json(res,400,{error:'Customer on credit hold'}); if(Number(b.amount)<=0) return json(res,400,{error:'Positive amount only'});
 const prefix=b.type==='Payment'?'PAY':b.type==='Credit Memo'?'CM':b.type==='Debit Memo'?'DM':'INV';
 const lines=(b.lines||[]).map(l=>{ const item=itemMaster.find(i=>i.code===l.itemCode)||{}; const qty=Number(l.qty||0); const unitPrice=Number(l.unitPrice??item.salesPrice??0); const discountPct=Number(l.discountPct||0); const base=qty*unitPrice; const discount=base*(discountPct/100); const taxable=(l.taxable??item.taxable)?1:0; const tax=taxable?(base-discount)*0.1:0; const lineTotal=base-discount+tax; return {itemCode:l.itemCode,description:l.description||item.name||'',qty,unitPrice,discountPct,taxable:!!taxable,tax,lineTotal,cost:Number(item.cost||0)}; });
 const subtotal=lines.reduce((s,l)=>s+l.qty*l.unitPrice,0); const discountTotal=lines.reduce((s,l)=>s+(l.qty*l.unitPrice*(l.discountPct/100)),0); const taxTotal=lines.reduce((s,l)=>s+l.tax,0); const grandTotal=lines.reduce((s,l)=>s+l.lineTotal,0); const cogsTotal=lines.filter(l=>(itemMaster.find(i=>i.code===l.itemCode)?.type||'')==='Inventory').reduce((s,l)=>s+(l.cost*l.qty),0);
 const doc={id:nextId(prefix),type:b.type||'Invoice',customerId:customer.id,customerName:customer.name,date:b.date||new Date().toISOString().slice(0,10),dueDate:b.dueDate,terms:b.terms||customer.terms,status:'Saved',posted:false,createdDate:new Date().toISOString().slice(0,10),amount:Number(b.amount||grandTotal),balance:Number(b.amount||grandTotal),lines,subtotal,discountTotal,taxTotal,grandTotal,cogsTotal,applications:b.applications||[],method:b.method,checkNumber:b.checkNumber}; if(doc.type==='Payment'){ if(!doc.date) return json(res,400,{error:'Payment date required'}); if(!doc.method) return json(res,400,{error:'Payment method required'}); if(doc.method==='Check'&&!doc.checkNumber) return json(res,400,{error:'Check number required'}); const totalApplied=(doc.applications||[]).reduce((s,a)=>s+Number(a.amount||0),0); if(totalApplied!==doc.amount) return json(res,400,{error:'Total applied must equal payment amount'}); for(const app of doc.applications){const inv=arDocuments.find(d=>d.id===app.invoiceId&&d.type==='Invoice'); if(!inv) return json(res,400,{error:'Invalid invoice application'}); if(Number(app.amount)>inv.balance) return json(res,400,{error:'Applied payment cannot exceed invoice balance'});} }
 arDocuments.push(doc); return json(res,201,doc);} 
 if(method==='PUT'&&pathname.startsWith('/api/ar/documents/')){ const id=pathname.split('/').pop(); const d=arDocuments.find(x=>x.id===id); if(!d)return json(res,404,{error:'Not found'}); if(d.status==='Posted') return json(res,400,{error:'Cannot edit posted docs'}); Object.assign(d,await body(req)); return json(res,200,d);}
 if(method==='DELETE'&&pathname.startsWith('/api/ar/documents/')){ const id=pathname.split('/').pop(); const idx=arDocuments.findIndex(x=>x.id===id); if(idx<0)return json(res,404,{error:'Not found'}); if(arDocuments[idx].status==='Posted') return json(res,400,{error:'Cannot delete posted'}); arDocuments.splice(idx,1); return json(res,200,{ok:true}); }
 if(method==='POST'&&pathname==='/api/ar/documents/post'){ const {id}=await body(req); const d=arDocuments.find(x=>x.id===id); if(!d)return json(res,404,{error:'Not found'}); if(d.status==='Voided') return json(res,400,{error:'Voided doc'}); if(d.status!=='Posted'){ d.status='Posted'; d.posted=true; if(d.reversalOf){ const orig=arDocuments.find(x=>x.id===d.reversalOf); if(orig) orig.status='Voided'; postJE(orig||d,true); } else { postJE(d,false); } if(d.type==='Payment'){ for(const a of d.applications||[]){const inv=arDocuments.find(x=>x.id===a.invoiceId); if(inv){ inv.balance-=Number(a.amount); inv.applications=inv.applications||[]; inv.applications.push({paymentId:d.id,amount:Number(a.amount),date:d.date,status:d.status,type:'Payment'}); inv.status=inv.balance<=0?'Closed':'Open'; } } } } return json(res,200,d); }
 if(method==='POST'&&pathname==='/api/ar/documents/void'){ const {id}=await body(req); const d=arDocuments.find(x=>x.id===id); if(!d)return json(res,404,{error:'Not found'}); if(d.status!=='Posted') return json(res,400,{error:'Only posted docs can be voided'}); const prefix=`VOID-${d.id}`; const rev={...d,id:`${prefix}-${String(arDocuments.filter(x=>x.id.startsWith(prefix)).length+1).padStart(3,'0')}`,status:'Saved',posted:false,reversalOf:d.id,createdDate:new Date().toISOString().slice(0,10)}; arDocuments.push(rev); return json(res,201,{message:'Reversal draft created',reversal:rev}); }
 if(method==='POST'&&pathname==='/api/ar/release/post-selected'){ const b=await body(req); const ids=b.ids||[]; const updated=[]; for(const id of ids){ const d=arDocuments.find(x=>x.id===id); if(d&&d.status==='Saved'){ d.status='Posted'; d.posted=true; postJE(d,false); updated.push(d);} } return json(res,200,{posted:updated.length,documents:updated}); }

 if(method==='GET'&&pathname==='/api/ar/reports/aging'){
   const asOf=new Date(query.date||new Date().toISOString().slice(0,10));
   const customerFilter=query.customerId;
   const bucketFilter=query.bucket;
   const invoices=arDocuments.filter(d=>d.type==='Invoice'&&d.status!=='Voided'&&d.balance>0&&(customerFilter?d.customerId===customerFilter:true));
   const map={};
   for(const inv of invoices){
     const days=Math.floor((asOf-new Date(inv.dueDate||inv.date))/86400000);
     const key=inv.customerName;
     if(!map[key]) map[key]={customerName:key,current:0,b1_30:0,b31_60:0,b61_90:0,b90p:0,items:[]};
     if(days<=0) map[key].current+=inv.balance;
     else if(days<=30) map[key].b1_30+=inv.balance;
     else if(days<=60) map[key].b31_60+=inv.balance;
     else if(days<=90) map[key].b61_90+=inv.balance;
     else map[key].b90p+=inv.balance;
     map[key].items.push({invoice:inv.id,balance:inv.balance,daysPastDue:days});
   }
   let rows=Object.values(map);
   if(bucketFilter){
     rows=rows.filter(r=>bucketFilter==='30'?r.b1_30>0:bucketFilter==='60'?r.b31_60>0:bucketFilter==='90'?r.b61_90>0:bucketFilter==='120'?r.b90p>0:true);
   }
   return json(res,200,rows);
 }


 if(method==='GET'&&pathname==='/api/finance/journal-transactions'){ return json(res,200,journalEntries); }
 if(method==='GET'&&pathname.startsWith('/api/finance/journal-transactions/')){ const id=pathname.split('/').pop(); const je=journalEntries.find(j=>j.jeNumber===id); return je?json(res,200,je):json(res,404,{error:'JE not found'}); }
 if(method==='POST'&&pathname==='/api/finance/journal-transactions'){ const b=await body(req); const lines=b.lines||[]; const dr=lines.reduce((s,l)=>s+Number(l.debit||0),0); const cr=lines.reduce((s,l)=>s+Number(l.credit||0),0); if(dr!==cr) return json(res,400,{error:'Total debits must equal total credits'}); const je={jeNumber:`JE${String(journalEntries.length+1).padStart(6,'0')}`,batchNumber:`BATCH-${String(journalEntries.length+1).padStart(6,'0')}`,module:'GL',description:b.description||'',financialPeriod:b.financialPeriod||new Date().toISOString().slice(0,7),transactionDate:b.transactionDate||new Date().toISOString().slice(0,10),status:'Saved',sourceRef:b.sourceRef||'',createdBy:'admin',createdDate:new Date().toISOString(),lines:lines.map(l=>({branch:l.branch||'100',branchName:(branchMaster.find(b=>b.code===String(l.branch||'100'))?.name)||'Custom Branch',account:l.account,debit:Number(l.debit||0),credit:Number(l.credit||0),sourceReference:l.sourceReference||''}))}; journalEntries.push(je); return json(res,201,je); }
 if(method==='POST'&&pathname==='/api/finance/journal-transactions/post'){ const {jeNumber}=await body(req); const je=journalEntries.find(j=>j.jeNumber===jeNumber); if(!je) return json(res,404,{error:'JE not found'}); const dr=je.lines.reduce((s,l)=>s+l.debit,0), cr=je.lines.reduce((s,l)=>s+l.credit,0); if(dr!==cr) return json(res,400,{error:'Out-of-balance JE'}); if(je.status!=='Posted'){ je.status='Posted'; je.lines.forEach(l=>{ if(l.debit) bump(l.account,'Debit',l.debit); if(l.credit) bump(l.account,'Credit',l.credit);}); if(je.reversalOf){ const orig=journalEntries.find(x=>x.jeNumber===je.reversalOf); if(orig) orig.status='Reversed'; } } return json(res,200,je); }
 if(method==='DELETE'&&pathname.startsWith('/api/finance/journal-transactions/')){ const id=pathname.split('/').pop(); const idx=journalEntries.findIndex(j=>j.jeNumber===id); if(idx<0) return json(res,404,{error:'JE not found'}); if(journalEntries[idx].status==='Posted') return json(res,400,{error:'Delete allowed only before posting'}); journalEntries.splice(idx,1); return json(res,200,{ok:true}); }
 if(method==='POST'&&pathname==='/api/finance/journal-transactions/reverse'){ const {jeNumber}=await body(req); const je=journalEntries.find(j=>j.jeNumber===jeNumber); if(!je) return json(res,404,{error:'JE not found'}); const rev={...je,jeNumber:`RJE${String(journalEntries.length+1).padStart(6,'0')}`,batchNumber:`RBATCH-${String(journalEntries.length+1).padStart(6,'0')}`,description:`Reversal of ${je.jeNumber}`,status:'Saved',sourceRef:je.jeNumber,reversalOf:je.jeNumber,lines:je.lines.map(l=>({...l,debit:l.credit,credit:l.debit,sourceReference:je.jeNumber}))}; journalEntries.push(rev); return json(res,201,rev); }
 if(method==='POST'&&pathname==='/api/finance/journal-transactions/copy'){ const {jeNumber}=await body(req); const je=journalEntries.find(j=>j.jeNumber===jeNumber); if(!je) return json(res,404,{error:'JE not found'}); const c={...je,jeNumber:`JE${String(journalEntries.length+1).padStart(6,'0')}`,batchNumber:`BATCH-${String(journalEntries.length+1).padStart(6,'0')}`,status:'Saved',description:`Copy of ${je.jeNumber}`}; journalEntries.push(c); return json(res,201,c); }

 if(method==='GET'&&pathname==='/api/gl/journal-entries') return json(res,200,journalEntries);
 return json(res,404,{error:'Not found'});
 }catch(e){return json(res,400,{error:e.message});}});
server.listen(process.env.PORT||3000);

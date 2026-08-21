import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const generatedName='.server-ar-professional-documents-runtime.js';
const generatedPath=path.join(here,generatedName);

function replaceOnce(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`AR professional documents integration failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`AR professional documents integration failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyArProfessionalDocumentsPatch(source){
  source=replaceOnce(
    source,
    "import { generateInvoicePdf } from './invoicePdf.js';",
    "import { generateInvoicePdf } from './invoicePdf.js';\nimport { generateStatementPdf } from './statementPdf.js';",
    'statement PDF import'
  );

  const routeMarker="if(method==='GET'&&pathname==='/api/ar/invoices/send-history'){ return json(res,200,invoiceEmailHistory); }";
  const professionalRoutes=`if(method==='GET'&&pathname==='/api/ar/reports/statement-pdf'){
  normalizeAllArStatuses();
  const customer=customers.find(c=>c.id===query.customerId); if(!customer)return json(res,404,{error:'Customer not found'});
  const statementDate=String(query.statementDate||new Date().toISOString().slice(0,10)).slice(0,10);
  const allCustomerDocuments=arDocuments.filter(d=>d.customerId===customer.id);
  const documents=allCustomerDocuments.filter(d=>['Invoice','Debit Memo','Credit Memo'].includes(d.type)&&d.posted&&d.status==='Open'&&Math.abs(Number(d.balance||0))>0);
  const pdf=generateStatementPdf({customer,documents,allDocuments:allCustomerDocuments,statementDate,companyName:companyName()});
  const fileName=\`Statement-\${String(customer.id).replace(/[^a-zA-Z0-9._-]/g,'_')}-\${statementDate}.pdf\`;
  res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':pdf.length,'Content-Disposition':\`\${query.download==='1'?'attachment':'inline'}; filename="\${fileName}"\`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"frame-ancestors 'self'"});res.end(pdf);return;
 }
 if(method==='GET'&&/^\\/api\\/ar\\/documents\\/[^/]+\\/pdf$/.test(pathname)){
  normalizeAllArStatuses();const parts=pathname.split('/'),id=decodeURIComponent(parts.at(-2)),invoice=arDocuments.find(d=>d.id===id&&['Invoice','Credit Memo','Debit Memo'].includes(d.type));if(!invoice)return json(res,404,{error:'AR document not found'});
  const customer=customers.find(c=>c.id===invoice.customerId)||{};const pdf=generateInvoicePdf({invoice,customer,companyName:companyName()});const fileName=\`\${String(invoice.type||'Invoice').replace(/\\s+/g,'-')}-\${String(invoice.id).replace(/[^a-zA-Z0-9._-]/g,'_')}.pdf\`;
  res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':pdf.length,'Content-Disposition':\`\${query.download==='1'?'attachment':'inline'}; filename="\${fileName}"\`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Content-Security-Policy':"frame-ancestors 'self'"});res.end(pdf);return;
 }
 if(method==='POST'&&pathname==='/api/ar/invoices/send-statement'){
  requireAuthenticated(req);normalizeAllArStatuses();const b=await body(req),customer=customers.find(c=>c.id===b.customerId);if(!customer)return json(res,404,{error:'Customer not found'});if(!customer.email)return json(res,400,{error:'Customer email is missing. Please update the customer profile before sending the statement.'});
  const statementDate=String(b.statementDate||new Date().toISOString().slice(0,10)).slice(0,10),allCustomerDocuments=arDocuments.filter(d=>d.customerId===customer.id),documents=allCustomerDocuments.filter(d=>['Invoice','Debit Memo','Credit Memo'].includes(d.type)&&d.posted&&d.status==='Open'&&Math.abs(Number(d.balance||0))>0);if(!documents.length)return json(res,400,{error:'This customer has no open AR documents to include on a statement.'});
  const pdf=generateStatementPdf({customer,documents,allDocuments:allCustomerDocuments,statementDate,companyName:companyName()}),balance=documents.reduce((sum,d)=>sum+(d.type==='Credit Memo'?-Math.abs(Number(d.balance||0)):Math.abs(Number(d.balance||0))),0),subject=\`Customer Statement - \${customer.name} - \${statementDate}\`,bodyText=\`Hello \${customer.name},\\n\\nPlease find attached your customer statement dated \${statementDate}. Current open balance: $\${balance.toFixed(2)}.\\n\\nThank you,\\n\${companyName()}\`;
  try{await sendInvoiceEmail({to:customer.email,subject,body:bodyText,attachments:[{filename:\`Statement-\${customer.id}-\${statementDate}.pdf\`,contentType:'application/pdf',content:pdf}],settings:resolveSmtpSettings(runtimeEmailSettings)});return json(res,200,{ok:true,customerId:customer.id,email:customer.email,statementDate,balance});}catch(error){return json(res,400,{error:formatSmtpError(error)});}
 }
 ${routeMarker}`;
  source=replaceOnce(source,routeMarker,professionalRoutes,'AR statement and invoice PDF routes');
  return source;
}

export async function prepareArProfessionalDocumentsServer(inputModule='./server.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8'),patched=applyArProfessionalDocumentsPatch(source);
  await writeFile(generatedPath,patched,'utf8');
  return `./${generatedName}`;
}

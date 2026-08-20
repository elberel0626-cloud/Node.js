import { buildPdf, createPdfCanvas, PDF_COLORS, pdfDate, pdfMoney, wrapPdfText } from './pdfDrawing.js';

const DISPLAY_COMPANY='M&R PRINTING EQUIPMENT INC.';
const COMPANY_ADDRESS='440 Medinah Rd - Roselle, IL 60172 U.S.A.';
const COMPANY_PHONE='USA: 800-736-6431 / 630-858-6101   FAX: (630) 858-6134   Outside US: +1-847-967-4461';
const BLUE=PDF_COLORS.blue,DARK=PDF_COLORS.darkBlue,RED=PDF_COLORS.red,WHITE=PDF_COLORS.white,BLACK=PDF_COLORS.black;
const signedBalance=d=>d.type==='Credit Memo'?-Math.abs(Number(d.balance||0)):Math.abs(Number(d.balance||0));
const signedAmount=d=>d.type==='Credit Memo'?-Math.abs(Number(d.amount||0)):Math.abs(Number(d.amount||0));
const typeCode=d=>d.type==='Credit Memo'?'CM':d.type==='Debit Memo'?'DM':d.type==='Payment'?'CP':'INV';
const customerAddressLines=c=>String(c?.billingAddress||c?.address||'').split(/\n|,(?=\s*[^,]+(?:,|$))/).map(x=>x.trim()).filter(Boolean).slice(0,4);
const statementDateValue=value=>String(value||new Date().toISOString().slice(0,10)).slice(0,10);

function daysPastDue(dueDate,statementDate){
  if(!dueDate)return 0;const due=new Date(`${String(dueDate).slice(0,10)}T12:00:00`),asOf=new Date(`${statementDateValue(statementDate)}T12:00:00`);if(Number.isNaN(due.getTime())||Number.isNaN(asOf.getTime()))return 0;return Math.max(0,Math.floor((asOf-due)/86400000));
}
function agingTotals(docs,statementDate){
  const a={current:0,b1:0,b2:0,b3:0,b4:0};
  for(const d of docs){const amount=signedBalance(d),days=daysPastDue(d.dueDate,statementDate);if(!d.dueDate||new Date(d.dueDate)>new Date(statementDate))a.current+=amount;else if(days<=30)a.b1+=amount;else if(days<=60)a.b2+=amount;else if(days<=90)a.b3+=amount;else a.b4+=amount;}
  return a;
}
function drawLogo(c){
  c.ellipse(73,41,46,20,{fill:[0.92,0.95,1],stroke:[0.24,0.43,0.7],width:1.6});
  c.ellipse(73,41,39,15,{stroke:[0.08,0.18,0.39],width:1});
  c.textCenter(73,47,'M&R',{size:20,font:'F2',fill:[0.02,0.08,0.2]});
}
function drawStatementPage({customer,documents,allDocuments,statementDate,companyName,pageIndex,pageCount,rows}){
  const c=createPdfCanvas(),company=companyName&&companyName!=='Company'?companyName:DISPLAY_COMPANY;
  const total=documents.reduce((sum,d)=>sum+signedBalance(d),0),aging=agingTotals(documents,statementDate);
  const payments=(allDocuments||[]).filter(d=>d.type==='Payment'&&d.customerId===customer.id&&d.posted!==false).sort((a,b)=>String(b.date||b.createdDate||'').localeCompare(String(a.date||a.createdDate||''))),lastPayment=payments[0];
  c.rect(18,16,576,752,{stroke:BLACK,width:0.8});drawLogo(c);
  c.textCenter(306,37,company,{size:9,font:'F2',fill:BLACK});c.textCenter(306,52,COMPANY_ADDRESS,{size:7.2,font:'F1',fill:BLACK});c.textCenter(306,65,COMPANY_PHONE,{size:6.4,font:'F1',fill:BLACK});
  c.textRight(588,44,'Customer Statement',{size:16,font:'F2',fill:RED});
  c.textRight(588,62,`Statement Date: ${pdfDate(statementDate)}`,{size:7.5,font:'F2',fill:BLACK});c.textRight(588,75,`Page: ${pageIndex+1} of ${pageCount}`,{size:7,font:'F1',fill:BLACK});
  c.line(18,92,594,92,{stroke:BLACK,width:1.3});

  c.text(36,113,'Customer:',{size:7.2,font:'F2',fill:BLACK});c.text(36,128,customer.name||'',{size:9,font:'F2',fill:BLACK});
  customerAddressLines(customer).forEach((line,i)=>c.text(36,142+i*11,line,{size:7.2,font:'F1',fill:BLACK}));
  c.text(392,112,'Cust A/C :',{size:7.2,font:'F2',fill:BLACK});c.text(466,112,customer.id||'',{size:7.2,font:'F1',fill:BLACK});
  c.text(392,126,'Run Date :',{size:7.2,font:'F2',fill:BLACK});c.text(466,126,pdfDate(statementDate),{size:7.2,font:'F1',fill:BLACK});
  c.text(392,140,'Balance :',{size:7.2,font:'F2',fill:BLACK});c.textRight(586,140,pdfMoney(total),{size:8,font:'F2',fill:BLACK});
  c.text(36,190,'TYPES :  INV=Invoiced   CP=Payment   DSC=Discount   CM=Credit   CSH=On Account',{size:6.6,font:'F1',fill:BLACK});

  const ageTop=211,ageCols=[['Current',18,115,aging.current],['PAST DUE\n1 - 30 Days',133,115,aging.b1],['PAST DUE\n31 - 60 Days',248,115,aging.b2],['PAST DUE\n61 - 90 Days',363,115,aging.b3],['PAST DUE\nOver 90 Days',478,116,aging.b4]];
  ageCols.forEach(([label,x,w,amount])=>{c.rect(x,ageTop,w,28,{fill:BLUE,stroke:BLACK,width:0.4});String(label).split('\n').forEach((t,i)=>c.textCenter(x+w/2,ageTop+10+i*8,t,{size:6.3,font:'F2',fill:WHITE}));c.rect(x,ageTop+28,w,24,{stroke:BLACK,width:0.4});c.textRight(x+w-7,ageTop+44,pdfMoney(amount),{size:7,font:'F1',fill:BLACK});});
  c.text(26,279,`Account Type : ${customer.accountType||'Customer'}`,{size:6.8,font:'F2',fill:BLACK});c.textRight(586,279,`Terms : ${customer.terms||''}`,{size:6.8,font:'F2',fill:BLACK});

  const tableTop=294,cols=[18,75,132,222,300,358,409,468,594];
  c.rect(18,tableTop,576,24,{fill:BLUE,stroke:BLACK,width:0.5});
  const labels=[['Tran Date',18,57],['Due Date',75,57],['Cust PO',132,90],['Invoice #',222,78],['Order#',300,58],['Type',358,51],['Orig Amt',409,59],['Balance Due',468,126]];
  labels.forEach(([label,x,w])=>c.textCenter(x+w/2,tableTop+15,label,{size:6.2,font:'F2',fill:WHITE}));cols.slice(1,-1).forEach(x=>c.line(x,tableTop,x,650,{stroke:BLACK,width:0.35}));c.line(18,tableTop+24,594,tableTop+24,{stroke:BLACK,width:0.45});
  rows.forEach((d,index)=>{
    const y=335+index*18;c.text(22,y,pdfDate(d.date||d.createdDate),{size:6.4,font:'F1',fill:BLACK});c.text(79,y,pdfDate(d.dueDate),{size:6.4,font:'F1',fill:BLACK});
    c.text(136,y,String(d.customerPO||'').slice(0,18),{size:6.1,font:'F1',fill:BLACK});c.text(226,y,String(d.id||''),{size:6.3,font:'F1',fill:BLACK});c.text(304,y,String(d.sourceSalesOrderNumber||d.orderNumber||'').slice(0,12),{size:6.1,font:'F1',fill:BLACK});c.textCenter(383,y,typeCode(d),{size:6.2,font:'F2',fill:BLACK});c.textRight(464,y,pdfMoney(signedAmount(d)),{size:6.3,font:'F1',fill:BLACK});c.textRight(588,y,pdfMoney(signedBalance(d)),{size:6.3,font:'F1',fill:BLACK});
    const note=d.description||d.reason||'';if(note)c.text(136,y+7,wrapPdfText(note,55)[0],{size:5.4,font:'F3',fill:[0.25,0.25,0.25]});
  });
  c.line(18,650,594,650,{stroke:BLACK,width:0.55});
  if(pageIndex===pageCount-1){
    c.text(370,668,'Sub Total :',{size:7,font:'F2',fill:BLACK});c.textRight(588,668,pdfMoney(total),{size:7,font:'F2',fill:BLACK});
    c.text(370,688,'Total :',{size:8,font:'F2',fill:BLACK});c.textRight(588,688,pdfMoney(total),{size:8,font:'F2',fill:BLACK});
    if(lastPayment)c.text(28,687,`Thank you for your last payment on ${pdfDate(lastPayment.date||lastPayment.createdDate)}`,{size:6.7,font:'F1',fill:BLACK});
    c.text(28,710,'For Customer Inquiry, please contact the Customer Credit Department at (630) 858-6101.',{size:6.3,font:'F1',fill:BLACK});
    c.textCenter(306,735,'Parts & Supplies Are Available Online at store.mrprint.com.',{size:6.4,font:'F2',fill:RED});
  }else c.textCenter(306,681,'Statement continued on next page',{size:7,font:'F2',fill:BLACK});
  return c.output();
}

export function generateStatementPdf({customer,documents=[],allDocuments=[],statementDate,companyName='Company'}){
  const asOf=statementDateValue(statementDate),openDocs=(documents||[]).filter(d=>Math.abs(Number(d.balance||0))>0).sort((a,b)=>String(a.dueDate||a.date||'').localeCompare(String(b.dueDate||b.date||''))||String(a.id||'').localeCompare(String(b.id||'')));
  const chunks=[];for(let i=0;i<openDocs.length;i+=17)chunks.push(openDocs.slice(i,i+17));if(!chunks.length)chunks.push([]);
  return buildPdf(chunks.map((rows,index)=>drawStatementPage({customer:customer||{},documents:openDocs,allDocuments,statementDate:asOf,companyName,pageIndex:index,pageCount:chunks.length,rows})));
}

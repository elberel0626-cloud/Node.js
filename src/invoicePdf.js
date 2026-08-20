import { buildPdf, createPdfCanvas, PDF_COLORS, pdfDate, pdfMoney, wrapPdfText } from './pdfDrawing.js';

const DISPLAY_COMPANY='M&R PRINTING EQUIPMENT INC.';
const COMPANY_ADDRESS='440 Medinah Rd - Roselle, IL 60172 U.S.A.';
const COMPANY_PHONE='USA: 800-736-6431 / 630-858-6101   FAX: (630) 858-6134   Outside US: +1-847-967-4461';
const BLUE=PDF_COLORS.blue, DARK=PDF_COLORS.darkBlue, RED=PDF_COLORS.red, WHITE=PDF_COLORS.white, BLACK=PDF_COLORS.black;
const lineAmount=line=>{
  const qty=Number(line.qty??line.quantity??0),price=Number(line.unitPrice??line.price??0),discountPct=Number(line.discountPct??line.discountPercent??0);
  return qty*price*(1-discountPct/100);
};
const addressLines=value=>String(value||'').split(/\n|,(?=\s*[^,]+(?:,|$))/).map(x=>x.trim()).filter(Boolean).slice(0,4);
const docTitle=doc=>doc.type==='Credit Memo'?'Credit Memo':doc.type==='Debit Memo'?'Debit Memo':'Invoice';

function drawLogo(c){
  c.ellipse(66,38,47,20,{fill:[0.92,0.95,1],stroke:[0.24,0.43,0.7],width:1.6});
  c.ellipse(66,38,40,15,{stroke:[0.08,0.18,0.39],width:1});
  c.textCenter(66,44,'M&R',{size:20,font:'F2',fill:[0.02,0.08,0.2]});
}

function drawInvoicePage({invoice,customer,companyName,rows,pageIndex,pageCount}){
  const c=createPdfCanvas();
  const company=companyName&&companyName!=='Company'?companyName:DISPLAY_COMPANY;
  c.rect(18,16,576,752,{stroke:BLACK,width:0.8});
  drawLogo(c);
  c.rect(123,20,330,16,{fill:RED});c.text(132,32,'The M&R Companies',{size:10,font:'F2',fill:WHITE});
  c.textRight(590,31,docTitle(invoice),{size:11,font:'F3',fill:BLACK});
  c.text(128,53,company,{size:8.5,font:'F2',fill:BLACK});
  c.text(128,66,COMPANY_ADDRESS,{size:7.4,font:'F2',fill:BLACK});
  c.text(128,78,COMPANY_PHONE,{size:6.7,font:'F2',fill:BLACK});
  c.line(18,96,594,96,{stroke:BLACK,width:2});

  const achAba=process.env.AR_ACH_ABA||'',achAccount=process.env.AR_ACH_ACCOUNT||'',wireBank=process.env.AR_WIRE_BANK||'',wireAba=process.env.AR_WIRE_ABA||'',wireSwift=process.env.AR_WIRE_SWIFT||'';
  const remit=achAba||achAccount?`REMIT PAYMENTS TO: ACH ABA# ${achAba||'Configured'}  ACCT# ${achAccount||'Configured'}`:'REMIT PAYMENTS TO: Contact Accounts Receivable for ACH / wire instructions.';
  c.text(22,111,remit,{size:6.8,font:'F2',fill:DARK});
  if(wireBank||wireAba||wireSwift)c.text(22,123,`WIRE TRANSFER TO: ${wireBank}${wireAba?`  ABA# ${wireAba}`:''}${wireSwift?`  SWIFT# ${wireSwift}`:''}`,{size:6.5,font:'F1',fill:DARK});

  c.text(390,111,'Invoice Number:',{size:7.4,font:'F2',fill:DARK});c.text(490,111,invoice.id||'',{size:7.4,font:'F1',fill:BLACK});
  c.text(390,125,'Invoice Date:',{size:7.4,font:'F2',fill:DARK});c.text(490,125,pdfDate(invoice.date||invoice.invoiceDate),{size:7.4,font:'F1',fill:BLACK});
  c.text(390,139,'Customer Number:',{size:7.4,font:'F2',fill:DARK});c.text(490,139,customer?.id||invoice.customerId||'',{size:7.4,font:'F1',fill:BLACK});
  c.text(390,153,'VAT Number:',{size:7.4,font:'F2',fill:DARK});c.text(490,153,customer?.vatNumber||'',{size:7.4,font:'F1',fill:BLACK});
  c.textRight(588,167,`Page: ${pageIndex+1} OF ${pageCount}`,{size:7,font:'F1',fill:BLACK});

  c.text(40,171,'Bill to:',{size:7.5,font:'F2',fill:DARK});
  c.text(350,171,'Ship to:',{size:7.5,font:'F2',fill:DARK});
  const bill=[customer?.name||invoice.customerName||'',...addressLines(customer?.billingAddress||customer?.address||invoice.billingAddress)];
  const ship=[customer?.name||invoice.customerName||'',...addressLines(customer?.shippingAddress||invoice.shipToAddress||customer?.billingAddress||customer?.address)];
  bill.forEach((cLine,i)=>c.text(40,187+i*11,cLine,{size:7,font:i===0?'F2':'F1',fill:BLACK}));
  ship.forEach((cLine,i)=>c.text(350,187+i*11,cLine,{size:7,font:i===0?'F2':'F1',fill:BLACK}));

  const top=258,headers=[['SHIP DATE',18,113],['DUE DATE',131,93],['SHIPVIA',224,117],['ROS',341,118],['TERMS',459,135]];
  headers.forEach(([t,x,w])=>{c.rect(x,top,w,14,{fill:BLUE,stroke:BLACK,width:0.4});c.textCenter(x+w/2,top+10,t,{size:6.5,font:'F2',fill:WHITE});});
  const values=[[pdfDate(invoice.shipDate||invoice.date),18,113],[pdfDate(invoice.dueDate),131,93],[invoice.shipVia||'Not Applicable',224,117],[invoice.branchName||invoice.branch||'Roselle',341,118],[invoice.terms||customer?.terms||'',459,135]];
  values.forEach(([t,x,w])=>{c.rect(x,top+14,w,25,{stroke:BLACK,width:0.4});c.textCenter(x+w/2,top+29,String(t||''),{size:6.6,font:'F1',fill:BLACK});});

  const top2=297,meta=[['CUSTOMER PO NUMBER',18,135],['ORDER DATE',153,92],['TRACKING NUMBER',245,215],['OUR ORDER NUMBER',460,134]];
  meta.forEach(([t,x,w])=>{c.rect(x,top2,w,13,{fill:BLUE,stroke:BLACK,width:0.4});c.textCenter(x+w/2,top2+9.5,t,{size:5.8,font:'F2',fill:WHITE});});
  const metaVals=[[invoice.customerPO||'',18,135],[pdfDate(invoice.orderDate||invoice.date),153,92],[invoice.trackingNumber||'',245,215],[invoice.sourceSalesOrderNumber||invoice.orderNumber||'',460,134]];
  metaVals.forEach(([t,x,w])=>{c.rect(x,top2+13,w,20,{stroke:BLACK,width:0.4});c.textCenter(x+w/2,top2+27,String(t||''),{size:6.5,font:'F1',fill:BLACK});});

  const tableTop=330,cols=[18,84,115,145,176,277,446,500,594],labels=[['QUANTITY\nORD | SHIP | BO',18,66],['UOM',84,31],['ITEM\nNUMBER',115,30],['DESCRIPTION',145,132],['UNIT PRICE',446,54],['DISCOUNT\n%',500,51],['EXTENDED\nPRICE',551,43]];
  c.rect(18,tableTop,576,28,{fill:BLUE,stroke:BLACK,width:0.5});
  cols.slice(1,-1).forEach(x=>c.line(x,tableTop,x,690,{stroke:BLACK,width:0.35}));
  labels.forEach(([label,x,w])=>{const pieces=String(label).split('\n');pieces.forEach((p,i)=>c.textCenter(x+w/2,tableTop+9+i*8,p,{size:5.8,font:'F2',fill:WHITE}));});
  c.line(18,tableTop+28,594,tableTop+28,{stroke:BLACK,width:0.45});c.line(18,690,594,690,{stroke:BLACK,width:0.55});

  rows.forEach((line,index)=>{
    const y=373+index*16,qty=Number(line.qty??line.quantity??0),shipQty=Number(line.shipQty??line.qtyShipped??qty),bo=Math.max(0,qty-shipQty),unit=Number(line.unitPrice??line.price??0),disc=Number(line.discountPct??line.discountPercent??0),amount=lineAmount(line);
    c.textCenter(51,y,`${qty}    ${shipQty}    ${bo}`,{size:6.2,font:'F1',fill:BLACK});
    c.textCenter(99,y,line.uom||'EAC',{size:6.2,font:'F1',fill:BLACK});
    c.text(119,y,line.itemCode||line.item||'',{size:6.1,font:'F1',fill:BLACK});
    const desc=wrapPdfText(line.description||line.itemName||line.item||'',42).slice(0,2);desc.forEach((t,i)=>c.text(150,y+i*7,t,{size:6.1,font:'F1',fill:BLACK}));
    c.textRight(496,y,pdfMoney(unit),{size:6.2,font:'F1',fill:BLACK});
    c.textRight(546,y,disc?`${disc.toFixed(2)}%`:'',{size:6.2,font:'F1',fill:BLACK});
    c.textRight(589,y,pdfMoney(amount),{size:6.2,font:'F1',fill:BLACK});
  });

  const lineSubtotal=(invoice.lines||[]).reduce((sum,line)=>sum+lineAmount(line),0),discountTotal=Number(invoice.discountTotal||0),tax=Number(invoice.taxTotal||0),freight=Number(invoice.freight||invoice.deliveryHandling||0),net=Number(invoice.subtotal??lineSubtotal),grand=Number(invoice.grandTotal??invoice.amount??(net-discountTotal+tax+freight)),balance=Number(invoice.balance??grand);
  if(pageIndex===pageCount-1){
    const ty=578;c.text(366,ty,'Net Order Value',{size:6.7,font:'F2',fill:BLACK});c.textRight(589,ty,pdfMoney(net),{size:6.7,font:'F1',fill:BLACK});
    c.text(366,ty+13,'Delivery and Handling',{size:6.7,font:'F1',fill:BLACK});c.textRight(589,ty+13,pdfMoney(freight),{size:6.7,font:'F1',fill:BLACK});
    c.text(366,ty+26,'Tax',{size:6.7,font:'F1',fill:BLACK});c.textRight(589,ty+26,pdfMoney(tax),{size:6.7,font:'F1',fill:BLACK});
    if(discountTotal)c.text(366,ty+39,'Discount',{size:6.7,font:'F1',fill:BLACK}),c.textRight(589,ty+39,`-${pdfMoney(discountTotal)}`,{size:6.7,font:'F1',fill:BLACK});
    c.text(285,655,'Balance Due (USD)',{size:7.2,font:'F2',fill:BLACK});c.textRight(589,655,pdfMoney(balance),{size:7.2,font:'F2',fill:BLACK});
    c.text(120,704,'** PLEASE CONTACT THE CREDIT DEPT WITH ANY QUESTIONS **',{size:7.1,font:'F2',fill:BLACK});
  } else c.textCenter(306,666,'Continued on next page',{size:7,font:'F2',fill:BLACK});
  c.textCenter(306,744,'Until final payment we reserve all rights available under the applicable sales agreement and law.',{size:5.5,font:'F3',fill:BLACK});
  return c.output();
}

export function generateInvoicePdf({invoice,customer,companyName='Company'}){
  const allRows=(invoice?.lines||[]).length?(invoice.lines||[]):[{description:invoice?.description||docTitle(invoice),qty:1,unitPrice:Number(invoice?.amount||0),uom:'EAC'}];
  const chunks=[];for(let i=0;i<allRows.length;i+=18)chunks.push(allRows.slice(i,i+18));if(!chunks.length)chunks.push([]);
  return buildPdf(chunks.map((rows,index)=>drawInvoicePage({invoice:invoice||{},customer:customer||{},companyName,rows,pageIndex:index,pageCount:chunks.length})));
}

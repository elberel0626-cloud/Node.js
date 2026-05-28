const esc=(s)=>String(s??'').replace(/[\\()]/g,'\\$&').replace(/[\r\n]+/g,' ');
const money=(v)=>Number(v||0).toFixed(2);

export function generateInvoicePdf({invoice,customer,companyName='Company'}){
  const lines=[
    companyName,
    `${invoice.type||'Invoice'} ${invoice.id}`,
    `Customer: ${customer?.name||invoice.customerName||''}`,
    `Invoice Date: ${invoice.date||''}`,
    `Due Date: ${invoice.dueDate||''}`,
    `Amount: $${money(invoice.amount||invoice.grandTotal)}`,
    '',
    'Items:'
  ];
  for(const l of invoice.lines||[]) lines.push(`${l.itemCode||''} ${l.description||''} Qty ${l.qty||0} Unit $${money(l.unitPrice)} Line $${money(l.lineTotal||((Number(l.qty||0)*Number(l.unitPrice||0))))}`);
  lines.push('', `Balance: $${money(invoice.balance)}`, 'Thank you.');
  const content=['BT','/F1 12 Tf','50 760 Td',...lines.flatMap((line,i)=>[(i?'0 -16 Td':''),`(${esc(line)}) Tj`].filter(Boolean)),'ET'].join('\n');
  const objs=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ];
  let pdf='%PDF-1.4\n'; const offsets=[0];
  objs.forEach((obj,i)=>{offsets[i+1]=Buffer.byteLength(pdf); pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
  const xref=Buffer.byteLength(pdf); pdf+=`xref\n0 ${objs.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(o=>`${String(o).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size ${objs.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf,'utf8');
}

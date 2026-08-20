import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const generatedName='.server-financial-report-mapping.js';
const generatedPath=path.join(here,generatedName);

export function applyFinancialReportMappingPatch(source){
  const start=source.indexOf('function reportWorkbook(type,report){');
  const end=source.indexOf('\nfunction accountSummaryReport(filters={}){',start);
  if(start<0||end<0)throw new Error('Financial report mapping integration failed: reportWorkbook was not found.');
  const replacement=`function reportWorkbook(type,report){
 let headers=['Account Code','Account Name','Amount'],rows=[];
 if(type==='trial-balance'){
  headers=['Account Code','Account Name','Debit','Credit','Balance'];
  rows=report.rows.map(r=>[r.accountNumber,r.accountTitle,r.debit,r.credit,r.balance]);
 }else if(type==='profit-loss'){
  const mappedRows=(report.sections||[]).flatMap(section=>(section.groups||[]).flatMap(group=>{
   const subgroups=Array.isArray(group.subgroups)&&group.subgroups.length?group.subgroups:[{name:'',details:group.details||[]}];
   return subgroups.flatMap(subgroup=>(subgroup.details||[]).map(row=>({type:group.name,geography:subgroup.name||row.subgroup||'',row})));
  }));
  if(report.view==='monthly'){
   headers=['Type','Geography','Account Code','Account Name',...report.months,'Total'];
   rows=mappedRows.map(item=>[item.type,item.geography,item.row.accountCode,item.row.accountName,...report.months.map(month=>item.row.months?.[month]||0),item.row.amount]);
  }else{
   headers=['Type','Geography','Account Code','Account Name','Amount'];
   rows=mappedRows.map(item=>[item.type,item.geography,item.row.accountCode,item.row.accountName,item.row.amount]);
  }
 }else if(report.sections){
  rows=report.sections.flatMap(section=>[[section.name,'',0],...(section.groups||[]).flatMap(group=>[[group.name,'',group.total],...(group.details||[]).map(row=>[row.accountCode,row.accountName,row.amount])])]);
 }else rows=[['Beginning Retained Earnings','',report.beginningRetainedEarnings],['Net Income','',report.netIncome],['Adjustments','',report.adjustments],['Distributions','',report.distributions],['Ending Retained Earnings','',report.endingRetainedEarnings]];
 const period=report.asOf?\`As of \${report.asOf}\`:\`\${report.fromPeriod||'Beginning'} through \${report.toPeriod||'Current'}\`;
 return financialWorkbook({sheetName:report.reportName.slice(0,31),title:\`\${report.companyName} — \${report.reportName}\`,period,headers,rows});
}`;
  return source.slice(0,start)+replacement+source.slice(end);
}

export async function prepareFinancialReportMappingServer(inputModule='./server.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyFinancialReportMappingPatch(source);
  await writeFile(generatedPath,patched,'utf8');
  return `./${generatedName}`;
}

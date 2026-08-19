import { test, expect, openView } from './fixtures/authenticated.js';

async function api(page,path,method='GET',payload){
  return page.evaluate(async ({path,method,payload})=>{
    const options={method,headers:{'Content-Type':'application/json'}};
    if(payload!==undefined)options.body=JSON.stringify(payload);
    const response=await fetch(path,options);
    const text=await response.text();
    let body={};try{body=text?JSON.parse(text):{};}catch{body={raw:text};}
    if(!response.ok)throw new Error(`${method} ${path}: ${body.error||text}`);
    return body;
  },{path,method,payload});
}

test('posted AR source reference drills from GL activity to its document',async({page})=>{
  const tag=Date.now().toString().slice(-8);
  const invoice=await api(page,'/api/ar/documents','POST',{
    type:'Invoice',customerId:'CUST-1002',date:'2026-08-19',postDate:'2026-08-19',description:'AR source routing regression',
    lines:[{itemCode:'ITEM-1001',description:'AR routing line',qty:1,unitPrice:25,revenueAccount:'4008'}]
  });
  await api(page,'/api/ar/documents/post','POST',{id:invoice.id});
  const journals=await api(page,'/api/finance/journal-transactions');
  const je=journals.find(row=>row.sourceRef===invoice.id&&String(row.module).toUpperCase()==='AR'&&!row.reversalOf);
  expect(je).toBeTruthy();
  const account=je.lines.find(line=>Number(line.debit||0)>0)?.account||je.lines[0]?.account;
  expect(account).toBeTruthy();

  await openView(page,`/finance/account-details/${encodeURIComponent(account)}`,'#acctDtlGrid');
  const sourceLink=page.locator(`#acctDtlGrid a[href='/ar/doc/${invoice.id}']`).first();
  await expect(sourceLink).toBeVisible();
  const row=sourceLink.locator('xpath=ancestor::tr');
  await expect(row.locator("td[data-k='sourceModule']")).toHaveText('AR');
  await expect(row.locator("td[data-k='jeLink'] a")).toHaveAttribute('href',`/finance/journal/${je.jeNumber}`);
  await sourceLink.click();
  await expect(page).toHaveURL(new RegExp(`/ar/doc/${invoice.id}$`));
});

import { readFile, writeFile } from 'node:fs/promises';

async function replaceOnce(path,name,from,to){
  let text=await readFile(path,'utf8');
  const hits=text.split(from).length-1;
  if(hits!==1)throw new Error(`${path}: ${name} expected one match, found ${hits}`);
  text=text.replace(from,to);
  await writeFile(path,text);
  console.log(`patched ${path}: ${name}`);
}

await replaceOnce(
  'e2e/finance-drilldowns.spec.js',
  'self contained module source routing',
  "test('saved module source references retain JE and AP, AR, and Inventory routing', async ({ page }) => {\n  const targets = await page.evaluate(async () => { const report=await(await fetch('/api/finance/trial-balance')).json(),found={}; for(const row of report.rows){const details=await(await fetch(`/api/finance/account-details/${encodeURIComponent(row.accountNumber)}`)).json();for(const source of details.activityRows){const module=String(source.sourceModule).toUpperCase();if(source.sourceHref&&['AP','AR','INVENTORY'].includes(module)&&!found[module])found[module]={accountNumber:row.accountNumber,source};}}return found; });\n  expect(Object.keys(targets).sort()).toEqual(['AP','AR','INVENTORY']);\n  for (const target of Object.values(targets)) { await openView(page, `/finance/account-details/${encodeURIComponent(target.accountNumber)}`, '#acctDtlGrid'); const row=page.locator('#acctDtlGrid tr',{hasText:target.source.jeReference}).filter({has:page.locator(`a[href='${target.source.sourceHref}']`)}).first(); await row.locator(\"td[data-k='jeLink'] a\").click(); await expect(page).toHaveURL(new RegExp(`/finance/journal/${encodeURIComponent(target.source.jeReference)}$`)); }\n});",
  "test('saved module source references retain JE and AP, AR, and Inventory routing', async ({ page }) => {\n  await page.evaluate(async () => {\n    const existing=await(await fetch('/api/ar/documents')).json();\n    if(!existing.some(document=>document.posted&&document.type==='Invoice')){\n      const response=await fetch('/api/ar/documents',{method:'POST',body:JSON.stringify({type:'Invoice',customerId:'CUST-1002',date:'2026-08-19',postDate:'2026-08-19',description:'Finance source routing fixture',lines:[{itemCode:'ITEM-1001',description:'AR source route',qty:1,unitPrice:25,revenueAccount:'4008'}]})});\n      if(!response.ok)throw new Error(await response.text());\n      const invoice=await response.json();\n      const posted=await fetch('/api/ar/documents/post',{method:'POST',body:JSON.stringify({id:invoice.id})});\n      if(!posted.ok)throw new Error(await posted.text());\n    }\n  });\n  const targets = await page.evaluate(async () => { const report=await(await fetch('/api/finance/trial-balance')).json(),found={}; for(const row of report.rows){const details=await(await fetch(`/api/finance/account-details/${encodeURIComponent(row.accountNumber)}`)).json();for(const source of details.activityRows){const module=String(source.sourceModule).toUpperCase();if(source.sourceHref&&['AP','AR','INVENTORY'].includes(module)&&!found[module])found[module]={accountNumber:row.accountNumber,source};}}return found; });\n  expect(Object.keys(targets).sort()).toEqual(['AP','AR','INVENTORY']);\n  for (const target of Object.values(targets)) { await openView(page, `/finance/account-details/${encodeURIComponent(target.accountNumber)}`, '#acctDtlGrid'); const row=page.locator('#acctDtlGrid tr',{hasText:target.source.jeReference}).filter({has:page.locator(`a[href='${target.source.sourceHref}']`)}).first(); await row.locator(\"td[data-k='jeLink'] a\").click(); await expect(page).toHaveURL(new RegExp(`/finance/journal/${encodeURIComponent(target.source.jeReference)}$`)); }\n});"
);

console.log('existing regression test patch completed');

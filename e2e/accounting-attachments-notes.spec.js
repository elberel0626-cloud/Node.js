import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { test, expect, openView } from './fixtures/authenticated.js';

let fixtureDirectory,fixture;
test.beforeAll(async()=>{fixtureDirectory=await mkdtemp(path.join(os.tmpdir(),'erp-pdf-'));fixture=path.join(fixtureDirectory,'supporting-document.pdf');const pdf=await PDFDocument.create(),page=pdf.addPage([400,240]),font=await pdf.embedFont(StandardFonts.Helvetica);page.drawText('Accounting supporting document fixture',{x:40,y:150,size:16,font});await writeFile(fixture,await pdf.save());});
test.afterAll(async()=>rm(fixtureDirectory,{recursive:true,force:true}));

const browserFailures=page=>{const failures=[];page.on('pageerror',error=>failures.push(`pageerror: ${error.message}`));page.on('console',message=>{if(message.type()==='error')failures.push(`console: ${message.text()}`);});page.on('requestfailed',request=>failures.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`));return failures;};
async function uploadRefreshAndOpen(page,context){
  await expect(page.locator('#attachmentsButton')).toBeVisible();await page.locator('#attachmentsButton').click();const before=await page.locator('.attachment-row').count();await page.locator('#attachmentFile').setInputFiles(fixture);await expect(page.locator('.attachment-row')).toHaveCount(before+1);await page.reload();await expect(page.locator('#attachmentsButton')).toContainText(`Attachments ${before+1}`);await page.locator('#attachmentsButton').click();
  const popupPromise=context.waitForEvent('page'),responsePromise=page.waitForResponse(response=>/\/api\/attachments\/ATT-.+\/file$/.test(response.url()));await page.locator('.attachment-row a').last().click();const [popup,response]=await Promise.all([popupPromise,responsePromise]);expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('application/pdf');await expect(popup.locator('body')).toBeVisible();await popup.close();
}

test('saved and posted journal keeps PDF attachments and append-only notes after refresh',async({page,context})=>{
  const errors=browserFailures(page);
  await openView(page,'/finance/journal/new','#newJe');
  const rows=page.locator('#jlines tr').filter({has:page.locator('td')});
  await rows.nth(0).locator('.dr').fill('42');await rows.nth(1).locator('.cr').fill('42');await page.locator('#jdesc').fill('Attachment and notes browser verification');await page.locator('#saveDoc').click();
  await expect(page).toHaveURL(/\/finance\/journal\/JE\d+$/);const jeNumber=page.url().split('/').pop();
  await page.locator('#attachmentsButton').click();await page.locator('#attachmentFile').setInputFiles(fixture);await expect(page.locator('.attachment-row')).toContainText('supporting-document.pdf');
  const popupPromise=context.waitForEvent('page'),pdfResponse=page.waitForResponse(value=>/\/api\/attachments\/ATT-.+\/file$/.test(value.url()));await page.locator('.attachment-row a').click();const [popup,response]=await Promise.all([popupPromise,pdfResponse]);expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('application/pdf');await expect(popup.locator('embed,iframe,body')).toBeVisible();await popup.close();
  await page.bringToFront();await page.locator('#notesButton').click();await page.locator('#addNoteButton').click();await page.locator('#noteText').fill('Waiting for supporting invoice.');await page.locator('#saveNote').click();await expect(page.locator('#notesButton')).toContainText('Notes 1');await expect(page.locator('.journal-note')).toContainText('Waiting for supporting invoice.');
  await page.reload();await expect(page.locator('#attachmentsButton')).toContainText('Attachments 1');await expect(page.locator('#notesButton')).toContainText('Notes 1');
  await page.locator('#jePost').click();await expect(page.locator("input[value='Posted']")).toBeVisible();await page.locator('#attachmentsButton').click();await expect(page.locator('.attachment-row')).toContainText('supporting-document.pdf');
  expect(errors,`browser errors for ${jeNumber}`).toEqual([]);
});

for(const [name,listPath,grid] of [['AP Bill','/ap/bills','#apBillGrid'],['AP Payment','/ap/payments','#apPayGrid'],['AR Invoice','/ar/invoices','#invGrid'],['AR Payment','/ar/payments','#payGrid']])test(`${name} PDF reopens through the binary streaming endpoint after refresh`,async({page,context})=>{const errors=browserFailures(page);await openView(page,listPath,grid);await page.locator(`${grid} a.link`).first().click();await uploadRefreshAndOpen(page,context);expect(errors).toEqual([]);});

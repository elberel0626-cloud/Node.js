import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedName = '.server-rga-all-sales-runtime.js';
const generatedPath = path.join(here, generatedName);

function replaceOnce(source, oldText, newText, label) {
  if (source.includes(newText)) return source;
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error(`RGA all-sales integration failed: ${label} was not found.`);
  if (source.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`RGA all-sales integration failed: ${label} matched more than once.`);
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

export function applyRgaAllSalesPatch(source) {
  const oldEligibility = "const rows = arDocuments.filter(doc => doc.type === 'Invoice' && doc.posted && doc.status !== 'Voided' && (!query.customerId || doc.customerId === query.customerId)).map(rgaInvoiceSummary).filter(row => row.returnableLines.some(line => Number(line.availableToReturnQty || 0) > 0));";
  const newEligibility = "const rows = arDocuments.filter(doc => doc.type === 'Invoice' && doc.posted && doc.status !== 'Voided' && (!query.customerId || doc.customerId === query.customerId)).map(rgaInvoiceSummary).sort((a,b)=>String(b.invoiceDate||'').localeCompare(String(a.invoiceDate||'')));";
  return replaceOnce(source, oldEligibility, newEligibility, 'eligible invoice query');
}

export async function prepareRgaAllSalesServer(inputModule = './server.js') {
  const inputPath = path.isAbsolute(inputModule) ? inputModule : path.join(here, String(inputModule).replace(/^\.\//, ''));
  const source = await readFile(inputPath, 'utf8');
  const patched = applyRgaAllSalesPatch(source);
  await writeFile(generatedPath, patched, 'utf8');
  return './' + generatedName;
}

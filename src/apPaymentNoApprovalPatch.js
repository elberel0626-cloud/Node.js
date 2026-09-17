import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const generatedName = '.server-ap-payment-no-approval-runtime.js';
const generatedPath = path.join(here, generatedName);

function replaceOnce(source, oldText, newText, label) {
  if (source.includes(newText)) return source;
  const first = source.indexOf(oldText);
  if (first < 0) throw new Error(`AP payment integration failed: ${label} was not found.`);
  if (source.indexOf(oldText, first + oldText.length) >= 0) throw new Error(`AP payment integration failed: ${label} matched more than once.`);
  return source.slice(0, first) + newText + source.slice(first + oldText.length);
}

export function applyApPaymentNoApprovalPatch(source) {
  return replaceOnce(
    source,
    "if(!doc.paymentApprovalStatus) doc.paymentApprovalStatus=doc.type==='Prepayment'?'Pending Payment Approval':(Number(doc.amount||0)>=Number(apApprovalThresholds.paymentControllerThreshold||25000)?'Pending Payment Approval':'Not Required');",
    "if(doc.type==='Payment') doc.paymentApprovalStatus='Not Required'; else if(!doc.paymentApprovalStatus) doc.paymentApprovalStatus='Pending Payment Approval';",
    'normal AP payments do not require payment approval'
  );
}

export async function prepareApPaymentNoApprovalServer(inputModule = './server.js') {
  const inputPath = path.isAbsolute(inputModule) ? inputModule : path.join(here, String(inputModule).replace(/^\.\//, ''));
  const source = await readFile(inputPath, 'utf8');
  const patched = applyApPaymentNoApprovalPatch(source);
  await writeFile(generatedPath, patched, 'utf8');
  return `./${generatedName}`;
}

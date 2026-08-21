import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const reviewedRuntimePath=path.join(here,'.manufacturingRuntime-agent3.js');

export function applyManufacturingAgent3FinalizationPatch(source){
  const invalid="Number(input.unitCost??op.outsideUnitCost??h.itemCost(serviceItem)||0)";
  const valid="Number(input.unitCost??op.outsideUnitCost??h.itemCost(serviceItem)??0)";
  if(source.includes(valid))return source;
  const first=source.indexOf(invalid);
  if(first<0)throw new Error('Agent 3 manufacturing finalization patch failed: outside-processing unit cost expression was not found.');
  if(source.indexOf(invalid,first+invalid.length)>=0)throw new Error('Agent 3 manufacturing finalization patch failed: outside-processing unit cost expression matched more than once.');
  return source.slice(0,first)+valid+source.slice(first+invalid.length);
}

export async function prepareManufacturingAgent3FinalizedRuntime(inputModule='./.manufacturingRuntime-agent3.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyManufacturingAgent3FinalizationPatch(source);
  await writeFile(reviewedRuntimePath,patched,'utf8');
  return './.manufacturingRuntime-agent3.js';
}

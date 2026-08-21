import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const runtimePath=path.join(here,'.manufacturingRuntime-agent3.js');
const clientPath=path.join(here,'../public/manufacturingModule.js');

function replaceOnceOrAlready(source,oldText,newText,label){
  if(source.includes(newText))return source;
  const first=source.indexOf(oldText);
  if(first<0)throw new Error(`Agent 3 manufacturing idempotency patch failed: ${label} was not found.`);
  if(source.indexOf(oldText,first+oldText.length)>=0)throw new Error(`Agent 3 manufacturing idempotency patch failed: ${label} matched more than once.`);
  return source.slice(0,first)+newText+source.slice(first+oldText.length);
}

export function applyManufacturingAgent3IdempotencyRuntimePatch(source){
  source=replaceOnceOrAlready(
    source,
    "async function handle({method,pathname,query={},readBody,user}={}){",
    "async function handleCore({method,pathname,query={},readBody,user}={}){",
    'core manufacturing handler rename'
  );
  source=replaceOnceOrAlready(
    source,
    "return{handle,overview,runMrp,",
    `const processedRequests=new Map();
  async function handle(request={}){if(!request.pathname?.startsWith('/api/manufacturing'))return null;const method=String(request.method||'GET').toUpperCase();if(method==='GET')return handleCore(request);const payload=typeof request.readBody==='function'?await request.readBody():{},requestId=String(payload?.clientRequestId||payload?.requestId||'').trim();if(!requestId)return handleCore({...request,readBody:async()=>payload});if(requestId.length>160)throw new Error('Manufacturing clientRequestId must be 160 characters or fewer.');const actor=userFrom(request.user),key=[actor,method,request.pathname,requestId].join('|');if(processedRequests.has(key))return structuredClone(processedRequests.get(key));const result=await handleCore({...request,method,readBody:async()=>payload});if(result&&Number(result.status||200)<400){processedRequests.set(key,structuredClone(result));while(processedRequests.size>2000)processedRequests.delete(processedRequests.keys().next().value);}return result;}
  return{handle,overview,runMrp,`,
    'idempotent manufacturing handler wrapper'
  );
  return source;
}

export function applyManufacturingAgent3IdempotencyClientPatch(source){
  return replaceOnceOrAlready(
    source,
    "async function api(path,options={}){const headers=new Headers(options.headers||{});if(options.body!==undefined&&!(options.body instanceof FormData)){headers.set('Content-Type','application/json');if(typeof options.body!=='string')options={...options,body:JSON.stringify(options.body)};}const response=await fetch(path,{...options,headers,credentials:'same-origin'});const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{payload={error:text};}if(!response.ok)throw new Error(payload.error||payload.message||`Request failed (${response.status})`);return payload;}",
    "const mfgInFlightMutations=new Map();\nfunction mfgRequestId(){return globalThis.crypto?.randomUUID?.()||`mfg-${Date.now()}-${Math.random().toString(36).slice(2)}`;}\nasync function api(path,options={}){const method=String(options.method||'GET').toUpperCase(),headers=new Headers(options.headers||{});let requestKey='',requestBody=options.body;if(requestBody!==undefined&&!(requestBody instanceof FormData)){headers.set('Content-Type','application/json');if(typeof requestBody!=='string'){if(method!=='GET'&&requestBody&&typeof requestBody==='object'&&!requestBody.clientRequestId&&!requestBody.requestId)requestBody={...requestBody,clientRequestId:mfgRequestId()};options={...options,body:JSON.stringify(requestBody)};}else options={...options,body:requestBody};}if(method!=='GET'&&!(requestBody instanceof FormData)){const logicalBody=requestBody&&typeof requestBody==='object'?{...requestBody,clientRequestId:undefined,requestId:undefined}:requestBody;requestKey=`${method}|${path}|${JSON.stringify(logicalBody??null)}`;if(mfgInFlightMutations.has(requestKey))return mfgInFlightMutations.get(requestKey);}const run=(async()=>{const response=await fetch(path,{...options,headers,credentials:'same-origin'});const text=await response.text();let payload={};try{payload=text?JSON.parse(text):{};}catch{payload={error:text};}if(!response.ok)throw new Error(payload.error||payload.message||`Request failed (${response.status})`);return payload;})();if(requestKey)mfgInFlightMutations.set(requestKey,run);try{return await run;}finally{if(requestKey&&mfgInFlightMutations.get(requestKey)===run)mfgInFlightMutations.delete(requestKey);}}",
    'idempotent manufacturing client API'
  );
}

export async function prepareManufacturingAgent3IdempotentRuntime(inputModule='./.manufacturingRuntime-agent3.js'){
  const inputPath=path.isAbsolute(inputModule)?inputModule:path.join(here,String(inputModule).replace(/^\.\//,''));
  const source=await readFile(inputPath,'utf8');
  const patched=applyManufacturingAgent3IdempotencyRuntimePatch(source);
  await writeFile(runtimePath,patched,'utf8');
  return './.manufacturingRuntime-agent3.js';
}

export async function patchManufacturingAgent3IdempotencyUiFile(){
  const source=await readFile(clientPath,'utf8');
  const patched=applyManufacturingAgent3IdempotencyClientPatch(source);
  if(patched!==source)await writeFile(clientPath,patched,'utf8');
  return clientPath;
}

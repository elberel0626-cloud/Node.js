import { DocumentAIProvider } from './DocumentAIProvider.js';

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const shouldTrace=()=>['1','true','yes'].includes(String(process.env.AP_TRACE_INVOICE_RECOGNITION||'').toLowerCase());
const logTrace=(label,payload)=>{ if(shouldTrace()) console.log(`[invoice-recognition-trace] ${label}`, JSON.stringify(payload,null,2)); };
const isEmptyAzureResult=(json)=>!json?.analyzeResult || (!String(json.analyzeResult.content||'').trim() && !(json.analyzeResult.documents||[]).length && !(json.analyzeResult.pages||[]).length);

export class AzureDocumentAIProvider extends DocumentAIProvider {
  constructor({ endpoint=process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, key=process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY, model=process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL||'prebuilt-invoice', apiVersion=process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION||'2024-11-30' }={}) {
    super(); Object.assign(this,{endpoint,key,model,apiVersion,providerName:'azure-document-intelligence'});
  }
  assertConfigured(){ if(!this.endpoint||!this.key) throw new Error('Invoice recognition provider is not configured.'); }
  async analyzeInvoice(document,mimeType='application/pdf'){
    this.assertConfigured(); const started=Date.now();
    const url=`${this.endpoint.replace(/\/$/,'')}/documentintelligence/documentModels/${encodeURIComponent(this.model)}:analyze?api-version=${encodeURIComponent(this.apiVersion)}`;
    logTrace('azure-request', { called: true, endpoint: url, model: this.model, apiVersion: this.apiVersion, mimeType, bytes: document?.length||0 });
    const operation=await this.retryFetch(url,{method:'POST',headers:{'Ocp-Apim-Subscription-Key':this.key,'Content-Type':mimeType},body:document});
    const providerRequestId=operation.headers.get('apim-request-id')||operation.headers.get('x-ms-request-id')||'';
    logTrace('azure-initial-response', { httpStatus: operation.status, ok: operation.ok, providerRequestId });
    if(!operation.ok){ const error=new Error(`Azure Document Intelligence request failed: ${operation.status}`); error.azureDiagnostics={called:true,endpoint:url,model:this.model,httpStatus:operation.status,providerRequestId,responseEmpty:true}; throw error; }
    const operationLocation=operation.headers.get('operation-location'); if(!operationLocation) throw new Error('Azure Document Intelligence did not return an operation-location.');
    for(let i=0;i<40;i++){
      await sleep(Math.min(1000*Math.pow(1.25,i),5000));
      const poll=await this.retryFetch(operationLocation,{headers:{'Ocp-Apim-Subscription-Key':this.key}});
      const json=await poll.json();
      const pollRequestId=poll.headers.get('apim-request-id')||poll.headers.get('x-ms-request-id')||providerRequestId;
      logTrace('azure-poll-response', { httpStatus: poll.status, ok: poll.ok, providerRequestId: pollRequestId, status: json.status, responseEmpty: isEmptyAzureResult(json), raw: json });
      if(json.status==='succeeded') return {providerName:this.providerName,providerModel:this.model,providerEndpoint:url,providerHttpStatus:poll.status,providerRequestId:pollRequestId,providerInitialRequestId:providerRequestId,providerResponseEmpty:isEmptyAzureResult(json),processingDurationMs:Date.now()-started,raw:json,analyzeResult:json.analyzeResult};
      if(json.status==='failed'){ const error=new Error(json.error?.message||'Azure Document Intelligence analysis failed.'); error.azureDiagnostics={called:true,endpoint:url,model:this.model,httpStatus:poll.status,providerRequestId:pollRequestId,responseEmpty:isEmptyAzureResult(json),raw:json}; throw error; }
    }
    throw new Error('Azure Document Intelligence analysis timed out.');
  }
  async analyzeLayout(document,mimeType){ return this.analyzeInvoice(document,mimeType); }
  async extractText(document,mimeType){ const r=await this.analyzeInvoice(document,mimeType); return { text:r.analyzeResult?.content||'', ...r }; }
  async retryFetch(url,options,attempt=0){
    try{ const res=await fetch(url,options); if([429,500,502,503,504].includes(res.status)&&attempt<4){await sleep(500*Math.pow(2,attempt)); return this.retryFetch(url,options,attempt+1);} return res; }
    catch(e){ if(attempt<4){await sleep(500*Math.pow(2,attempt)); return this.retryFetch(url,options,attempt+1);} throw e; }
  }
}

import { DocumentAIProvider } from './DocumentAIProvider.js';

const shouldTrace=()=>['1','true','yes'].includes(String(process.env.AP_TRACE_INVOICE_RECOGNITION||'').toLowerCase());
const logTrace=(label,payload)=>{ if(shouldTrace()) console.log(`[invoice-recognition-trace] ${label}`, JSON.stringify(payload,null,2)); };
const isEmptyAzureResult=(analyzeResult)=>!analyzeResult || (!String(analyzeResult.content||'').trim() && !(analyzeResult.documents||[]).length && !(analyzeResult.pages||[]).length);
const headerObject=(headers={})=>{
  if(typeof headers.toJSON==='function') return headers.toJSON();
  if(typeof headers.entries==='function') return Object.fromEntries(headers.entries());
  return {...headers};
};
const logAzureExchange=(details)=>console.log('[invoice-recognition-trace] azure-sdk-exchange', JSON.stringify(details,null,2));
const sanitizeRequestHeaders=(headers={})=>Object.fromEntries(Object.entries(headers).filter(([key])=>key.toLowerCase()!=='ocp-apim-subscription-key'));

async function loadDocumentIntelligenceSdk(){
  const sdk=await import('@azure/ai-document-intelligence');
  const auth=sdk.AzureKeyCredential ? sdk : await import('@azure/core-auth');
  return { DocumentIntelligenceClient:sdk.DocumentIntelligenceClient, AzureKeyCredential:auth.AzureKeyCredential };
}

export class AzureDocumentAIProvider extends DocumentAIProvider {
  constructor({ endpoint=process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, key=process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY, model=process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL||'prebuilt-invoice', apiVersion=process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION||'2024-11-30' }={}) {
    super(); Object.assign(this,{endpoint:String(endpoint||'').replace(/\/+$/,''),key,model,apiVersion,providerName:'azure-document-intelligence',client:null}); this.assertConfigured();
  }
  assertConfigured(){ if(!this.endpoint||!this.key) throw new Error('Azure Document Intelligence startup validation failed: AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY are required.'); }
  async getClient(){
    if(!this.client){ const { DocumentIntelligenceClient, AzureKeyCredential }=await loadDocumentIntelligenceSdk(); this.client=new DocumentIntelligenceClient(this.endpoint,new AzureKeyCredential(this.key),{apiVersion:this.apiVersion}); }
    return this.client;
  }
  async analyzeInvoice(document,mimeType='application/pdf'){
    this.assertConfigured(); const started=Date.now(); const client=await this.getClient(); const requestHeaders={'Content-Type':'application/pdf','Ocp-Apim-Subscription-Key':this.key}; let lastResponse={};
    console.log('[invoice-recognition-trace] azure-sdk-call', { method:'beginAnalyzeDocument', endpoint:this.endpoint, apiVersion:this.apiVersion, model:this.model, requestHeaders:sanitizeRequestHeaders(requestHeaders) });
    logTrace('azure-request', { called:true, transport:'@azure/ai-document-intelligence', method:'beginAnalyzeDocument', endpoint:this.endpoint, apiVersion:this.apiVersion, model:this.model, mimeType:'application/pdf', bytes:document?.length||0, requestHeaders:sanitizeRequestHeaders(requestHeaders) });
    const poller=await client.beginAnalyzeDocument(this.model, document, { contentType:'application/pdf', onResponse:(response)=>{ lastResponse={status:response.status, headers:headerObject(response.headers), bodyAsText:response.bodyAsText}; logAzureExchange({ method:response.request?.method||'SDK', requestUrl:response.request?.url||this.endpoint, apiVersion:this.apiVersion, model:this.model, requestHeaders:sanitizeRequestHeaders(requestHeaders), httpStatus:response.status, responseHeaders:lastResponse.headers, responseBody:response.bodyAsText||response.parsedBody||null }); } });
    const sdkResult=await poller.pollUntilDone();
    const analyzeResult=sdkResult?.analyzeResult||sdkResult;
    const providerRequestId=lastResponse.headers?.['apim-request-id']||lastResponse.headers?.['x-ms-request-id']||lastResponse.headers?.['x-ms-client-request-id']||'';
    logAzureExchange({ method:'pollUntilDone', requestUrl:this.endpoint, apiVersion:this.apiVersion, model:this.model, requestHeaders:sanitizeRequestHeaders(requestHeaders), httpStatus:lastResponse.status, providerRequestId, responseHeaders:lastResponse.headers||{}, responseBody:analyzeResult });
    return {providerName:this.providerName,providerModel:this.model,providerEndpoint:this.endpoint,providerHttpStatus:lastResponse.status,providerRequestId,providerResponseEmpty:isEmptyAzureResult(analyzeResult),processingDurationMs:Date.now()-started,raw:sdkResult,analyzeResult};
  }
  async analyzeLayout(document,mimeType){ return this.analyzeInvoice(document,mimeType); }
  async extractText(document,mimeType){ const r=await this.analyzeInvoice(document,mimeType); return { text:r.analyzeResult?.content||'', ...r }; }
}

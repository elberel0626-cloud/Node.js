import DocumentIntelligence, { getLongRunningPoller, isUnexpected } from '@azure-rest/ai-document-intelligence';
import { AzureKeyCredential } from '@azure/core-auth';
import { DocumentAIProvider } from './DocumentAIProvider.js';

const shouldTrace=()=>['1','true','yes'].includes(String(process.env.AP_TRACE_INVOICE_RECOGNITION||'').toLowerCase());
const logTrace=(label,payload)=>{ if(shouldTrace()) console.log(`[invoice-recognition-trace] ${label}`, JSON.stringify(payload,null,2)); };
const isEmptyAzureResult=(analyzeResult)=>!analyzeResult || (!String(analyzeResult.content||'').trim() && !(analyzeResult.documents||[]).length && !(analyzeResult.pages||[]).length);
const headerObject=(headers={})=>{
  if(typeof headers.toJSON==='function') return headers.toJSON();
  if(typeof headers.entries==='function') return Object.fromEntries(headers.entries());
  return {...headers};
};
const responseBody=(response)=>response?.body ?? response?.parsedBody ?? response?.bodyAsText ?? null;
const requestUrl=(response, fallback)=>response?.request?.url || fallback;
const requestMethod=(response, fallback='SDK')=>response?.request?.method || fallback;
const logAzureExchange=(details)=>console.log('[invoice-recognition-trace] azure-sdk-exchange', JSON.stringify(details,null,2));
const sanitizeRequestHeaders=(headers={})=>Object.fromEntries(Object.entries(headers).filter(([key])=>key.toLowerCase()!=='ocp-apim-subscription-key'));

export class AzureDocumentAIProvider extends DocumentAIProvider {
  constructor({ endpoint=process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, key=process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY, model=process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL||'prebuilt-invoice', apiVersion=process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION||'2024-11-30' }={}) {
    super(); Object.assign(this,{endpoint:String(endpoint||'').replace(/\/+$/,''),key,model,apiVersion,providerName:'azure-document-intelligence',client:null}); this.assertConfigured();
  }
  assertConfigured(){ if(!this.endpoint||!this.key) throw new Error('Azure Document Intelligence startup validation failed: AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY are required.'); }
  getClient(){
    if(!this.client) this.client=DocumentIntelligence(this.endpoint,new AzureKeyCredential(this.key),{apiVersion:this.apiVersion});
    return this.client;
  }
  async analyzeInvoice(document,mimeType='application/pdf'){
    this.assertConfigured(); const started=Date.now(); const client=this.getClient(); const requestHeaders={'Content-Type':'application/pdf','Ocp-Apim-Subscription-Key':this.key};
    console.log('[invoice-recognition-trace] azure-sdk-call', { transport:'@azure-rest/ai-document-intelligence', method:'POST', endpoint:this.endpoint, apiVersion:this.apiVersion, model:this.model, requestHeaders:sanitizeRequestHeaders(requestHeaders) });
    logTrace('azure-request', { called:true, transport:'@azure-rest/ai-document-intelligence', method:'POST', endpoint:this.endpoint, apiVersion:this.apiVersion, model:this.model, mimeType:'application/pdf', bytes:document?.length||0, requestHeaders:sanitizeRequestHeaders(requestHeaders) });
    const initialResponse=await client.path('/documentModels/{modelId}:analyze', this.model).post({ contentType:'application/pdf', body:document });
    logAzureExchange({ method:requestMethod(initialResponse,'POST'), requestUrl:requestUrl(initialResponse,this.endpoint), apiVersion:this.apiVersion, model:this.model, requestHeaders:sanitizeRequestHeaders(requestHeaders), httpStatus:initialResponse.status, responseHeaders:headerObject(initialResponse.headers), responseBody:responseBody(initialResponse) });
    if(isUnexpected(initialResponse)){ const body=responseBody(initialResponse); const error=new Error(`Azure Document Intelligence request failed: ${initialResponse.status}${body?.error?.code?` ${body.error.code}`:''}${body?.error?.message?`: ${body.error.message}`:''}`); error.azureDiagnostics={called:true,endpoint:this.endpoint,requestUrl:requestUrl(initialResponse,this.endpoint),model:this.model,httpStatus:initialResponse.status,providerRequestId:initialResponse.headers?.['apim-request-id']||initialResponse.headers?.['x-ms-request-id']||'',responseEmpty:!body,errorCode:body?.error?.code||'',errorMessage:body?.error?.message||'',raw:body}; throw error; }
    const poller=getLongRunningPoller(client, initialResponse);
    const finalResponse=await poller.pollUntilDone();
    const finalBody=responseBody(finalResponse)||{};
    const analyzeResult=finalBody.analyzeResult||finalBody;
    const headers=headerObject(finalResponse.headers);
    const providerRequestId=headers['apim-request-id']||headers['x-ms-request-id']||headers['x-ms-client-request-id']||'';
    logAzureExchange({ method:requestMethod(finalResponse,'pollUntilDone'), requestUrl:requestUrl(finalResponse,this.endpoint), apiVersion:this.apiVersion, model:this.model, requestHeaders:sanitizeRequestHeaders(requestHeaders), httpStatus:finalResponse.status, providerRequestId, responseHeaders:headers, responseBody:finalBody });
    return {providerName:this.providerName,providerModel:this.model,providerEndpoint:this.endpoint,providerHttpStatus:finalResponse.status,providerRequestId,providerResponseEmpty:isEmptyAzureResult(analyzeResult),processingDurationMs:Date.now()-started,raw:finalBody,analyzeResult};
  }
  async analyzeLayout(document,mimeType){ return this.analyzeInvoice(document,mimeType); }
  async extractText(document,mimeType){ const r=await this.analyzeInvoice(document,mimeType); return { text:r.analyzeResult?.content||'', ...r }; }
}

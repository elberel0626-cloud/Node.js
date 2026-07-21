import DocumentIntelligence, { getLongRunningPoller, isUnexpected } from '@azure-rest/ai-document-intelligence';
import { DocumentAIProvider } from './DocumentAIProvider.js';

const SDK_PACKAGE_VERSION='1.1.0';
const shouldTrace=()=>['1','true','yes'].includes(String(process.env.AP_TRACE_INVOICE_RECOGNITION||'').toLowerCase());
const logTrace=(label,payload)=>{ if(shouldTrace()) console.log(`[invoice-recognition-trace] ${label}`, JSON.stringify(payload,null,2)); };
const isEmptyAzureResult=(analyzeResult)=>!analyzeResult || (!String(analyzeResult.content||'').trim() && !(analyzeResult.documents||[]).length && !(analyzeResult.pages||[]).length);
const headerObject=(headers={})=>{
  if(typeof headers.toJSON==='function') return headers.toJSON();
  if(typeof headers.entries==='function') return Object.fromEntries(headers.entries());
  return {...headers};
};
const requestUrl=(response, fallback)=>response?.request?.url || fallback;

function normalizeResourceEndpoint(endpoint=''){
  return String(endpoint||'').replace(/\/+$/,'');
}

function assertResourceEndpoint(endpoint){
  const endpointUrl=new URL(endpoint);
  const pathname=endpointUrl.pathname.toLowerCase();
  if(pathname&&pathname!=='/') throw new Error('Azure endpoint must be the base resource endpoint without an API path.');
  for(const segment of ['/documentintelligence','/formrecognizer','/documentmodels']){
    if(pathname.includes(segment)) throw new Error('Azure endpoint must be the base resource endpoint without an API path.');
  }
}

export class AzureDocumentAIProvider extends DocumentAIProvider {
  constructor({ endpoint=process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, key=process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY, model=process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL||'prebuilt-invoice' }={}) {
    super(); Object.assign(this,{endpoint:normalizeResourceEndpoint(endpoint),key,model,providerName:'azure-document-intelligence',client:null}); this.assertConfigured(); assertResourceEndpoint(this.endpoint); this.client=DocumentIntelligence(this.endpoint,{key:this.key});
  }
  assertConfigured(){ if(!this.endpoint||!this.key) throw new Error('Azure Document Intelligence endpoint and key are required.'); }
  async analyzeInvoice(document,mimeType='application/pdf'){
    this.assertConfigured(); const started=Date.now(); const base64Source=Buffer.from(document).toString('base64');
    console.log('[Azure Document Intelligence config]', { endpoint:this.endpoint, sdkPackage:'@azure-rest/ai-document-intelligence', sdkPackageVersion:SDK_PACKAGE_VERSION, model:this.model });
    logTrace('azure-request', { called:true, transport:'@azure-rest/ai-document-intelligence', sdkPackageVersion:SDK_PACKAGE_VERSION, endpoint:this.endpoint, model:this.model, bytes:document?.length||0 });
    const initialResponse=await this.client.path('/documentModels/{modelId}:analyze', this.model).post({ contentType:'application/json', body:{base64Source} });
    console.log('[Azure initial response]', { status:initialResponse.status, model:this.model, endpoint:this.endpoint });
    if(isUnexpected(initialResponse)){
      const azureError=initialResponse.body?.error;
      console.error('[Azure error]', { status:initialResponse.status, code:azureError?.code||'', message:azureError?.message||'Unknown Azure error' });
      const error=new Error(`Azure Document Intelligence request failed: ${initialResponse.status} ${azureError?.code||''}: ${azureError?.message||'Unknown Azure error'}`);
      error.azureDiagnostics={called:true,endpoint:this.endpoint,requestUrl:requestUrl(initialResponse,this.endpoint),model:this.model,httpStatus:initialResponse.status,providerRequestId:initialResponse.headers?.['apim-request-id']||initialResponse.headers?.['x-ms-request-id']||'',responseEmpty:!initialResponse.body,errorCode:azureError?.code||'',errorMessage:azureError?.message||'Unknown Azure error',raw:initialResponse.body};
      throw error;
    }
    const poller=getLongRunningPoller(this.client, initialResponse);
    const finalResponse=await poller.pollUntilDone();
    const analyzeResult=finalResponse.body?.analyzeResult;
    const headers=headerObject(finalResponse.headers);
    const providerRequestId=headers['apim-request-id']||headers['x-ms-request-id']||headers['x-ms-client-request-id']||'';
    console.log('[Azure final response]', { status:finalResponse.status, model:this.model, endpoint:this.endpoint });
    logTrace('azure-final-response', { status:finalResponse.status, model:this.model, endpoint:this.endpoint, documents:Array.isArray(analyzeResult?.documents)?analyzeResult.documents.length:0 });
    return {providerName:this.providerName,providerModel:this.model,providerEndpoint:this.endpoint,providerHttpStatus:finalResponse.status,providerRequestId,providerResponseEmpty:isEmptyAzureResult(analyzeResult),processingDurationMs:Date.now()-started,raw:finalResponse.body,analyzeResult};
  }
  async analyzeLayout(document,mimeType){ return this.analyzeInvoice(document,mimeType); }
  async extractText(document,mimeType){ const r=await this.analyzeInvoice(document,mimeType); return { text:r.analyzeResult?.content||'', ...r }; }
}

import { DocumentAIProvider } from './DocumentAIProvider.js';

const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

export class AzureDocumentAIProvider extends DocumentAIProvider {
  constructor({ endpoint=process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT, key=process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY, model=process.env.AZURE_DOCUMENT_INTELLIGENCE_MODEL||'prebuilt-invoice', apiVersion=process.env.AZURE_DOCUMENT_INTELLIGENCE_API_VERSION||'2024-11-30' }={}) {
    super(); Object.assign(this,{endpoint,key,model,apiVersion,providerName:'azure-document-intelligence'});
  }
  assertConfigured(){ if(!this.endpoint||!this.key) throw new Error('Invoice recognition provider is not configured.'); }
  async analyzeInvoice(document,mimeType='application/pdf'){
    this.assertConfigured(); const started=Date.now();
    const url=`${this.endpoint.replace(/\/$/,'')}/documentintelligence/documentModels/${encodeURIComponent(this.model)}:analyze?api-version=${encodeURIComponent(this.apiVersion)}`;
    const operation=await this.retryFetch(url,{method:'POST',headers:{'Ocp-Apim-Subscription-Key':this.key,'Content-Type':mimeType},body:document});
    if(!operation.ok) throw new Error(`Azure Document Intelligence request failed: ${operation.status}`);
    const operationLocation=operation.headers.get('operation-location'); if(!operationLocation) throw new Error('Azure Document Intelligence did not return an operation-location.');
    const providerRequestId=operation.headers.get('apim-request-id')||operation.headers.get('x-ms-request-id')||'';
    for(let i=0;i<40;i++){
      await sleep(Math.min(1000*Math.pow(1.25,i),5000));
      const poll=await this.retryFetch(operationLocation,{headers:{'Ocp-Apim-Subscription-Key':this.key}});
      const json=await poll.json();
      if(json.status==='succeeded') return {providerName:this.providerName,providerModel:this.model,providerRequestId,processingDurationMs:Date.now()-started,raw:json,analyzeResult:json.analyzeResult};
      if(json.status==='failed') throw new Error(json.error?.message||'Azure Document Intelligence analysis failed.');
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

import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { flattenRecognizedInvoice, normalizeAzureInvoiceResult } from '../services/document-ai/RecognitionNormalizer.js';
import { validateInvoiceAccounting } from '../services/document-ai/InvoiceAccountingValidator.js';

const hasCommand=(cmd)=>{try{execFileSync('which',[cmd],{stdio:'ignore'});return true;}catch{return false;}};
const b64=(s='')=>String(s).includes(',')?String(s).split(',').pop():String(s||'');

export class InvoiceRecognitionService {
  constructor({ documents, buildIncomingRecord, updateDocument, vendors, purchaseOrders, purchaseOrderLines, provider, stores = {} }) {
    Object.assign(this,{documents,buildIncomingRecord,updateDocument,vendors,purchaseOrders,purchaseOrderLines,provider,stores});
  }
  async processIncomingDocument(documentId){
    const doc=this.documents.find(d=>d.id===documentId); if(!doc) throw new Error('Incoming document not found');
    doc.status='PROCESSING'; doc.processingStatus='PROCESSING'; const started=Date.now(); const runId=`RECRUN-${Date.now()}-${documentId}`; this.recordStore('recognitionRuns',{id:runId,documentId,status:'Processing',startedAt:new Date(started).toISOString(),providerName:this.provider?.constructor?.name||'DocumentAIProvider'}); this.recordStore('documentAuditLog',{documentId,event:'Recognition Started',createdAt:new Date().toISOString()}); doc.processingDetails={...(doc.processingDetails||{}),embeddedTextDetected:false,ocrUsed:false,pagesProcessed:0,vendorMatchConfidence:0,poMatchResult:'Not processed',lineTableDetected:false,errorDetails:''};
    try{
      const bytes=await this.readDocumentBytes(doc.attachment||{}); const providerResult=await this.provider.analyzeInvoice(bytes,doc.mimeType||doc.attachment?.mimeType||'application/pdf');
      const hasProviderFields=!!providerResult?.analyzeResult?.documents?.[0]?.fields&&Object.keys(providerResult.analyzeResult.documents[0].fields||{}).length>0; const normalized=normalizeAzureInvoiceResult(providerResult); const flattened=flattenRecognizedInvoice(normalized); const accounting=validateInvoiceAccounting(flattened);
      if(!flattened.rawText?.trim()) throw new Error('Invoice recognition failed. Please review the document and enter the information manually.');
      if(accounting.fullyPrepaid) flattened.fullyPrepaidWarning=accounting.warnings[0];
      const recognized=this.buildIncomingRecord({...doc, text:flattened.rawText, recognizedData:hasProviderFields?flattened:null, source:doc.source||'PDF Upload', fileName:doc.fileName, reuseId:doc.id});
      const finalConfidence=this.calculateFinalConfidence(recognized, accounting);
      recognized.finalConfidence=finalConfidence; recognized.aiConfidence=finalConfidence; if(doc.duplicateDocumentId){recognized.status='DUPLICATE'; recognized.processingStatus='DUPLICATE'; recognized.exceptions=[...(recognized.exceptions||[]),`Duplicate upload candidate: ${doc.duplicateDocumentId}`];}
      recognized.normalizedRecognition=normalized; recognized.accountingValidation=accounting; recognized.attachment=doc.attachment; recognized.storageKey=doc.storageKey; recognized.processingStatus=recognized.status; recognized.processingDetails={...doc.processingDetails,...(recognized.processingDetails||{}),providerCalled:true,providerResponseReceived:true,providerRequestId:providerResult.providerRequestId,providerModelVersion:providerResult.providerModel,recognitionProvider:providerResult.providerName,processingDurationMs:providerResult.processingDurationMs||Date.now()-started,pageCount:normalized.pages?.length||doc.pageCount||0,pagesProcessed:normalized.pages?.length||doc.pageCount||1,embeddedTextDetected:!!flattened.rawText,ocrUsed:false,vendorMatchConfidence:recognized.vendorMatch?.confidence||0,selectedVendorScore:recognized.vendorMatch?.confidence||0,vendorCandidates:recognized.vendorMatch?.candidates||[],amountCandidates:[{label:'Gross Invoice Amount',value:flattened.grossInvoiceAmount},{label:'Amount Due',value:flattened.amountDue},{label:'Deposit Applied',value:flattened.prepaymentApplied}],selectedGrossTotal:flattened.grossInvoiceAmount,selectedGrossTotalReasoning:'Provider invoice total validated against subtotal, freight, tax, discount, and deposit arithmetic.',arithmeticValidation:accounting,poMatchResult:recognized.poMatch?.status||'PO Not Found',poCandidates:recognized.poMatch?.candidates||[],lineTableDetected:(recognized.extracted?.lines||[]).length>0,lineItemsDetected:(recognized.extracted?.lines||[]).length,finalConfidence};
      this.persistRecognitionStores({runId,documentId,doc,providerResult,normalized,recognized,accounting,started});
      this.updateDocument(documentId,recognized); return recognized;
    }catch(e){ doc.status='FAILED'; doc.processingStatus='FAILED'; doc.processingError=e.message; doc.processingDetails.errorCode='RECOGNITION_FAILED'; doc.processingDetails.errorMessage=e.message; doc.processingDetails.errorDetails=e.message; this.recordStore('recognitionRuns',{id:runId,documentId,status:'Failed',completedAt:new Date().toISOString(),failureMessage:e.message}); this.recordStore('documentAuditLog',{documentId,event:'Recognition Failed',message:e.message,createdAt:new Date().toISOString()}); return doc; }
  }


  recordStore(name, row){
    if(Array.isArray(this.stores?.[name])) this.stores[name].push(row);
  }

  calculateFinalConfidence(recognized, accounting){
    const extraction=Number(recognized?.aiConfidence||0);
    const vendor=Number(recognized?.vendorMatch?.confidence||0);
    const math=accounting?.grossValid&&accounting?.balanceValid?100:(accounting?.grossValid||accounting?.balanceValid?75:45);
    const historical=recognized?.vendorMatch?.vendorId?90:50;
    return Math.max(0,Math.min(100,Math.round(extraction*.40+vendor*.25+math*.20+historical*.15)));
  }

  persistRecognitionStores({runId,documentId,doc,providerResult,normalized,recognized,accounting,started}){
    const completedAt=new Date().toISOString();
    this.recordStore('recognitionRuns',{id:runId,documentId,status:'Succeeded',providerName:providerResult.providerName,providerModel:providerResult.providerModel,providerRequestId:providerResult.providerRequestId,startedAt:new Date(started).toISOString(),completedAt,durationMs:providerResult.processingDurationMs||Date.now()-started});
    (normalized.pages||[]).forEach(page=>this.recordStore('documentPages',{documentId,pageNumber:page.pageNumber,width:page.width||null,height:page.height||null,unit:page.unit||null,text:page.text||''}));
    (recognized.extracted?.lines||[]).forEach((line,index)=>this.recordStore('recognizedLineItems',{documentId,recognitionRunId:runId,lineNumber:index+1,rawValue:line,confidence:line.confidence||recognized.finalConfidence||0,pageNumber:line.pageNumber||1,boundingBox:line.boundingPolygon||null}));
    (recognized.vendorMatch?.candidates||[]).forEach(candidate=>this.recordStore('vendorMatchCandidates',{documentId,recognitionRunId:runId,...candidate}));
    this.recordStore('poMatchResults',{documentId,recognitionRunId:runId,status:recognized.poMatch?.status||'No PO reference found',poNumber:recognized.poMatch?.poNumber||null,candidates:recognized.poMatch?.candidates||[]});
    this.recordStore('validationResults',{documentId,recognitionRunId:runId,type:'Accounting',status:accounting.grossValid&&accounting.balanceValid?'Passed':'Needs Review',details:accounting,finalConfidence:recognized.finalConfidence});
    this.recordStore('documentAuditLog',{documentId,event:'Recognition Complete',status:recognized.status,createdAt:completedAt});
  }

  async readDocumentBytes(file={}){
    if(file.storageKey) return readFile(file.storageKey);
    if(file.dataUrl||file.base64){ const payload=String(file.dataUrl||file.base64).includes(',')?String(file.dataUrl||file.base64).split(',').pop():String(file.dataUrl||file.base64); return Buffer.from(payload,'base64'); }
    if(file.text) return Buffer.from(file.text,'utf8');
    return Buffer.alloc(0);
  }
  async extractPdfText(file={}){
    const mime=file.mimeType||''; const out={text:'',embeddedTextDetected:false,ocrUsed:false,pagesProcessed:1,wordsWithCoordinates:[]};
    if(file.text) { out.text=file.text; out.embeddedTextDetected=true; return out; }
    if(file.storageKey){ out.base64=(await readFile(file.storageKey)).toString('base64'); }
    if(!file.dataUrl && !file.base64) return out;
    const dir=await mkdtemp(path.join(os.tmpdir(),'ap-invoice-')); const pdf=path.join(dir,file.name||'invoice.pdf');
    try{
      await writeFile(pdf,Buffer.from(b64(file.dataUrl||file.base64),'base64'));
      if(mime.includes('pdf')||/\.pdf$/i.test(file.name||'')){
        if(hasCommand('pdfinfo')){try{const info=execFileSync('pdfinfo',[pdf],{encoding:'utf8'}); out.pagesProcessed=Number((info.match(/Pages:\s*(\d+)/)||[])[1]||1);}catch{}}
        if(hasCommand('pdftotext')){try{out.text=execFileSync('pdftotext',['-layout',pdf,'-'],{encoding:'utf8',maxBuffer:10*1024*1024}); out.embeddedTextDetected=out.text.trim().length>0;}catch{}}
        if(!out.text.trim() && hasCommand('pdftoppm') && hasCommand('tesseract')){
          execFileSync('pdftoppm',['-png','-r','200',pdf,path.join(dir,'page')],{stdio:'ignore'}); let text='';
          for(let i=1;i<=out.pagesProcessed;i++){const img=path.join(dir,`page-${i}.png`); try{text+=execFileSync('tesseract',[img,'stdout'],{encoding:'utf8',maxBuffer:10*1024*1024})+'\n';}catch{}}
          out.text=text; out.ocrUsed=!!text.trim();
        }
      }
      return out;
    }finally{ await rm(dir,{recursive:true,force:true}); }
  }
  extractInvoiceHeader(text, wordsWithCoordinates){ return {text, wordsWithCoordinates}; }
  extractInvoiceLines(text, tables, wordsWithCoordinates){ return {text, tables, wordsWithCoordinates}; }
  matchVendor(extractedData){ return this.vendors.find(v=>String(extractedData.vendorName||'').toLowerCase().includes(String(v.name||'').toLowerCase())); }
  matchPurchaseOrder(extractedData, vendorId){ return this.purchaseOrders.find(p=>p.vendorId===vendorId && [p.poNumber,p.id].includes(extractedData.poNumber)); }
  calculateConfidence(field){ return field?.confidence || 0; }
  storeFieldCoordinates(field){ return field?.source || null; }
}

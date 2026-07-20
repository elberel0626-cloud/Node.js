import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const hasCommand=(cmd)=>{try{execFileSync('which',[cmd],{stdio:'ignore'});return true;}catch{return false;}};
const b64=(s='')=>String(s).includes(',')?String(s).split(',').pop():String(s||'');

export class InvoiceRecognitionService {
  constructor({ documents, buildIncomingRecord, updateDocument, vendors, purchaseOrders, purchaseOrderLines }) {
    Object.assign(this,{documents,buildIncomingRecord,updateDocument,vendors,purchaseOrders,purchaseOrderLines});
  }
  async processIncomingDocument(documentId){
    const doc=this.documents.find(d=>d.id===documentId); if(!doc) throw new Error('Incoming document not found');
    doc.status='Processing'; doc.processingDetails={embeddedTextDetected:false,ocrUsed:false,pagesProcessed:0,vendorMatchConfidence:0,poMatchResult:'Not processed',lineTableDetected:false,errorDetails:''};
    try{
      const extracted=await this.extractPdfText(doc.attachment||{}); const text=extracted.text;
      doc.processingDetails.embeddedTextDetected=!!extracted.embeddedTextDetected; doc.processingDetails.ocrUsed=!!extracted.ocrUsed; doc.processingDetails.pagesProcessed=extracted.pagesProcessed||1;
      if(!text.trim()) throw new Error('Invoice recognition failed. Please review the document and enter the information manually.');
      const recognized=this.buildIncomingRecord({...doc, text, source:doc.source||'PDF Upload', fileName:doc.fileName, attachmentDataUrl:doc.attachment?.dataUrl, reuseId:doc.id});
      recognized.attachment=doc.attachment; recognized.processingDetails={...doc.processingDetails,...(recognized.processingDetails||{}),vendorMatchConfidence:recognized.vendorMatch?.confidence||0,poMatchResult:recognized.poMatch?.status||'PO Not Found',lineTableDetected:(recognized.extracted?.lines||[]).length>0};
      this.updateDocument(documentId,recognized); return recognized;
    }catch(e){ doc.status='Failed'; doc.processingDetails.errorDetails=e.message; return doc; }
  }
  async extractPdfText(file={}){
    const mime=file.mimeType||''; const out={text:'',embeddedTextDetected:false,ocrUsed:false,pagesProcessed:1,wordsWithCoordinates:[]};
    if(file.text) { out.text=file.text; out.embeddedTextDetected=true; return out; }
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

import crypto from 'node:crypto';
import path from 'node:path';
import { access, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { validatePdfUpload } from './pdfUpload.js';

export const ACCOUNTING_ENTITY_TYPES = Object.freeze({
  JournalEntry: { module: 'Finance' },
  APBill: { module: 'AP' },
  APCreditMemo: { module: 'AP' },
  APPayment: { module: 'AP' },
  ARInvoice: { module: 'AR' },
  ARCreditMemo: { module: 'AR' },
  ARPayment: { module: 'AR' }
});

const publicRecord = record => {
  const { storageReference, removedAt, removedBy, ...safe } = record;
  return { ...safe, viewUrl: `/api/attachments/${encodeURIComponent(record.attachmentId)}/file` };
};

export class AccountingAttachmentStore {
  constructor({ directory = path.resolve('data/accounting-attachments') } = {}) {
    this.directory = directory;
    this.indexPath = path.join(directory, 'index.json');
    this.auditPath = path.join(directory, 'audit.json');
    this.records = [];
    this.audit = [];
  }

  async init() {
    await mkdir(this.directory, { recursive: true });
    this.records = await readFile(this.indexPath, 'utf8').then(JSON.parse).catch(() => []);
    this.audit = await readFile(this.auditPath, 'utf8').then(JSON.parse).catch(() => []);
  }

  assertType(entityType) {
    const config = ACCOUNTING_ENTITY_TYPES[entityType];
    if (!config) throw Object.assign(new Error('Unsupported accounting attachment entity type.'), { statusCode: 400 });
    return config;
  }

  list(entityType, entityId) {
    this.assertType(entityType);
    return this.records.filter(item => item.entityType === entityType && item.entityId === entityId && !item.removedAt).map(publicRecord);
  }

  find(attachmentId) {
    return this.records.find(item => item.attachmentId === attachmentId && !item.removedAt);
  }

  async add({ entityType, entityId, documentNumber, fileName, mimeType, content, user }) {
    const { module } = this.assertType(entityType);
    validatePdfUpload({ fileName, mimeType, content });
    const attachmentId = `ATT-${crypto.randomUUID()}`;
    const storageReference = path.join(this.directory, `${attachmentId}.pdf`);
    await writeFile(storageReference, content, { flag: 'wx' });
    await access(storageReference);
    const uploadedAt = new Date().toISOString();
    const record = { attachmentId, entityType, entityId, documentNumber, fileName: path.basename(fileName), storageReference, mimeType: 'application/pdf', fileSize: content.length, uploadedBy: user.name, uploadedById: user.id, uploadedAt };
    this.records.push(record);
    this.audit.unshift({ eventId: crypto.randomUUID(), action: 'Attachment Added', user: user.name, userId: user.id, timestamp: uploadedAt, module, documentType: entityType, documentNumber, attachmentName: record.fileName });
    await this.persist();
    return publicRecord(record);
  }

  async remove(attachmentId, user) {
    const record = this.find(attachmentId);
    if (!record) throw Object.assign(new Error('Attachment not found.'), { statusCode: 404 });
    const removedAt = new Date().toISOString();
    record.removedAt = removedAt; record.removedBy = user.name;
    this.audit.unshift({ eventId: crypto.randomUUID(), action: 'Attachment Removed', user: user.name, userId: user.id, timestamp: removedAt, module: ACCOUNTING_ENTITY_TYPES[record.entityType].module, documentType: record.entityType, documentNumber: record.documentNumber, attachmentName: record.fileName });
    await this.persist();
    if (!this.records.some(item => item.storageReference === record.storageReference && !item.removedAt)) await rm(record.storageReference, { force: true });
    return { ok: true };
  }

  async persist() {
    await Promise.all([[this.indexPath, this.records], [this.auditPath, this.audit]].map(async ([target, value]) => {
      const temporary = `${target}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(value, null, 2));
      await rename(temporary, target);
    }));
  }
}

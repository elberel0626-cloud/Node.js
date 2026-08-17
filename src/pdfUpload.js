export function validatePdfUpload({ fileName, mimeType = '', content }) {
  if (!/\.pdf$/i.test(fileName || '')) throw Object.assign(new Error('Only PDF files with a .pdf extension are allowed.'), { statusCode: 415 });
  if (!Buffer.isBuffer(content) || !content.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw Object.assign(new Error('The selected file is not a valid PDF.'), { statusCode: 415 });
  const normalizedType=String(mimeType || '').toLowerCase();
  if (normalizedType && !['application/pdf', 'application/octet-stream'].includes(normalizedType)) throw Object.assign(new Error('The selected file is not a valid PDF upload.'), { statusCode: 415 });
  return { fileName, mimeType: 'application/pdf', content };
}

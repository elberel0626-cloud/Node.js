import assert from 'node:assert/strict';
import test from 'node:test';

import { MockDocumentAIProvider } from '../src/documentAIProvider.js';

for (const balanceDueLabel of ['Balance Due (USD)', 'Balance Due']) {
  test(`mock invoice parser recognizes ${balanceDueLabel}`, async () => {
    const invoice = Buffer.from(`M&R Printing\n${balanceDueLabel} 282.19`);
    const result = await new MockDocumentAIProvider().analyzeInvoice(invoice, 'text/plain');

    assert.equal(
      result.analyzeResult.documents[0].fields.AmountDue.valueCurrency.amount,
      282.19,
    );
  });
}

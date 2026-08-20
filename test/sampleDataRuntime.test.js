import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSampleUnreleasedDocuments} from '../src/sampleDataRuntime.js';

test('unreleased sample AR/AP documents always use today and payments remain unapplied',()=>{
 const ar=[
  {id:'INV-SAMPLE',type:'Invoice',terms:'NET30',date:'2026-05-01',postDate:'2026-05-01',postPeriod:'2026-05',dueDate:'2026-05-31',status:'Saved',posted:false,amount:100,balance:100,applications:[]},
  {id:'PAY-SAMPLE',type:'Payment',date:'2026-05-02',status:'Saved',posted:false,amount:100,applications:[{invoiceId:'INV-CLOSED',amount:100}]},
  {id:'INV-POSTED',type:'Invoice',date:'2026-05-03',status:'Open',posted:true,amount:50,balance:50}
 ];
 const ap=[{id:'PAY-AP-SAMPLE',type:'Payment',date:'2026-05-04',status:'Saved',posted:false,amount:75,unappliedBalance:0,applications:[{documentId:'BILL-CLOSED',amount:75}]}];
 normalizeSampleUnreleasedDocuments({arDocuments:ar,apDocuments:ap,today:'2026-08-20'});
 assert.equal(ar[0].date,'2026-08-20');assert.equal(ar[0].postDate,'2026-08-20');assert.equal(ar[0].postPeriod,'2026-08');assert.equal(ar[0].dueDate,'2026-09-19');
 assert.deepEqual(ar[1].applications,[]);assert.equal(ar[1].unappliedBalance,100);assert.equal(ar[1].postDate,'2026-08-20');
 assert.equal(ap[0].postDate,'2026-08-20');assert.deepEqual(ap[0].applications,[]);assert.equal(ap[0].unappliedBalance,75);assert.equal(ap[0].balance,75);
 assert.equal(ar[2].date,'2026-05-03');
});

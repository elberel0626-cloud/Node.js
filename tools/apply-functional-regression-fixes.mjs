import { readFile, writeFile } from 'node:fs/promises';

async function patch(path, edits){
  let text=await readFile(path,'utf8');
  for(const {name,from,to,count=1} of edits){
    const hits=text.split(from).length-1;
    if(hits!==count)throw new Error(`${path}: ${name} expected ${count} match(es), found ${hits}`);
    text=text.split(from).join(to);
  }
  await writeFile(path,text);
  console.log(`patched ${path}`);
}

await patch('public/app.js',[
  {
    name:'reload eligible AP documents when payment vendor changes',
    from:"const allDocs=await api('/api/ap/documents?vendorId='+(pay.vendorId||vendor.id||'')); const elig=allDocs.filter(d=>['Bill','Credit Adjustment','Debit Adjustment'].includes(d.type)&&d.posted&&d.status==='Open'&&Number(d.balance||0)>0);",
    to:"let allDocs=await api('/api/ap/documents?vendorId='+(pay.vendorId||vendor.id||'')); let elig=allDocs.filter(d=>['Bill','Credit Adjustment','Debit Adjustment'].includes(d.type)&&d.posted&&d.status==='Open'&&Number(d.balance||0)>0);"
  },
  {
    name:'automatically pull selected vendor open AP documents into payment applications',
    from:"const paymentVendorSelector=bindApVendorSelector({numberId:'#pVendorNumber',nameId:'#pVendorName',hiddenId:'#pVendorSearch',vendors,state});",
    to:"const paymentVendorSelector=bindApVendorSelector({numberId:'#pVendorNumber',nameId:'#pVendorName',hiddenId:'#pVendorSearch',vendors,state,onSelected:async selected=>{allDocs=await api('/api/ap/documents?vendorId='+encodeURIComponent(selected.id));elig=allDocs.filter(d=>['Bill','Credit Adjustment','Debit Adjustment'].includes(d.type)&&d.posted&&d.status==='Open'&&Number(d.balance||0)>0);state.applications=[];recalc();renderDocs();$('#pUnap').value=state.unappliedBalance.toFixed(2);$('#pApplied').value=state.appliedAmount.toFixed(2);}});"
  },
  {
    name:'show year-specific empty account activity message for COA drilldowns',
    from:"empty=rows.length===0?`<div class='panel empty-state'>No posted activity matches the selected account filters.</div>`:'';",
    to:"empty=rows.length===0?`<div class='panel empty-state'>${origin==='chart-of-accounts'?'No posted activity was found for this account and selected year.':'No posted activity matches the selected account filters.'}</div>`:'';"
  }
]);

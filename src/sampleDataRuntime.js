const periodFromDate=date=>String(date||'').slice(0,7);
const addDays=(date,days)=>{const value=new Date(`${date}T00:00:00Z`);value.setUTCDate(value.getUTCDate()+Number(days||0));return value.toISOString().slice(0,10);};
const termDays=terms=>({NET15:15,NET30:30,NET45:45,DUE:0}[String(terms||'').toUpperCase()]??0);
const isUnreleasedSample=doc=>doc&&!doc.posted&&!['Open','Closed','Posted','Voided'].includes(String(doc.status||''));

export function currentSampleDate(now=new Date()){return now.toISOString().slice(0,10);}

export function normalizeSampleUnreleasedDocuments({arDocuments=[],apDocuments=[],today=currentSampleDate()}={}){
 const postPeriod=periodFromDate(today);
 const normalize=(doc,module)=>{
  if(!isUnreleasedSample(doc))return;
  doc.date=today;
  doc.postDate=today;
  doc.postPeriod=postPeriod;
  doc.createdDate=today;
  if(['Invoice','Bill'].includes(doc.type))doc.dueDate=addDays(today,termDays(doc.terms));
  else if(doc.type==='Debit Memo'&&!doc.dueDate)doc.dueDate=today;
  if(doc.type==='Payment'){
   doc.applications=[];
   doc.appliedAmount=0;
   doc.unappliedBalance=Number(doc.amount||0);
   if(module==='AP')doc.balance=Number(doc.amount||0);
  }
 };
 arDocuments.forEach(doc=>normalize(doc,'AR'));
 apDocuments.forEach(doc=>normalize(doc,'AP'));
 return{today,postPeriod,arUpdated:arDocuments.filter(isUnreleasedSample).length,apUpdated:apDocuments.filter(isUnreleasedSample).length};
}

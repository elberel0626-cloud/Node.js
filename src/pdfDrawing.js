const PAGE_WIDTH=612;
const PAGE_HEIGHT=792;
const clamp=n=>Number.isFinite(Number(n))?Number(n):0;
const num=n=>String(Math.round(clamp(n)*1000)/1000);
const ascii=value=>String(value??'').normalize('NFKD').replace(/[^\x09\x0A\x0D\x20-\x7E]/g,'?');
const pdfEscape=value=>ascii(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)');
const color=c=>(Array.isArray(c)?c:[0,0,0]).map(v=>Math.max(0,Math.min(1,Number(v)||0)));

export const PDF_PAGE_WIDTH=PAGE_WIDTH;
export const PDF_PAGE_HEIGHT=PAGE_HEIGHT;
export const PDF_COLORS=Object.freeze({
  blue:[0.08,0.31,0.68],
  darkBlue:[0.02,0.12,0.35],
  red:[0.78,0.12,0.12],
  black:[0,0,0],
  gray:[0.45,0.45,0.45],
  lightGray:[0.92,0.92,0.92],
  white:[1,1,1]
});

export function createPdfCanvas(){
  const out=[];
  const topY=y=>PAGE_HEIGHT-clamp(y);
  const setFill=c=>{const [r,g,b]=color(c);out.push(`${num(r)} ${num(g)} ${num(b)} rg`);};
  const setStroke=c=>{const [r,g,b]=color(c);out.push(`${num(r)} ${num(g)} ${num(b)} RG`);};
  const api={
    text(x,y,text,{size=9,font='F1',fill=PDF_COLORS.black}={}){
      setFill(fill); out.push(`BT /${font} ${num(size)} Tf 1 0 0 1 ${num(x)} ${num(topY(y))} Tm (${pdfEscape(text)}) Tj ET`); return api;
    },
    textRight(right,y,text,opts={}){
      const size=Number(opts.size||9),factor=opts.font==='F2'?0.56:0.52,width=ascii(text).length*size*factor;
      return api.text(right-width,y,text,opts);
    },
    textCenter(center,y,text,opts={}){
      const size=Number(opts.size||9),factor=opts.font==='F2'?0.56:0.52,width=ascii(text).length*size*factor;
      return api.text(center-width/2,y,text,opts);
    },
    line(x1,y1,x2,y2,{stroke=PDF_COLORS.black,width=0.6}={}){
      setStroke(stroke);out.push(`${num(width)} w ${num(x1)} ${num(topY(y1))} m ${num(x2)} ${num(topY(y2))} l S`);return api;
    },
    rect(x,y,w,h,{fill=null,stroke=null,width=0.6}={}){
      if(fill)setFill(fill); if(stroke)setStroke(stroke);out.push(`${num(width)} w ${num(x)} ${num(PAGE_HEIGHT-y-h)} ${num(w)} ${num(h)} re ${fill&&stroke?'B':fill?'f':'S'}`);return api;
    },
    ellipse(cx,cy,rx,ry,{fill=null,stroke=PDF_COLORS.blue,width=1}={}){
      const k=0.5522847498, y=topY(cy); if(fill)setFill(fill); if(stroke)setStroke(stroke);
      out.push(`${num(width)} w ${num(cx+rx)} ${num(y)} m`,
        `${num(cx+rx)} ${num(y+k*ry)} ${num(cx+k*rx)} ${num(y+ry)} ${num(cx)} ${num(y+ry)} c`,
        `${num(cx-k*rx)} ${num(y+ry)} ${num(cx-rx)} ${num(y+k*ry)} ${num(cx-rx)} ${num(y)} c`,
        `${num(cx-rx)} ${num(y-k*ry)} ${num(cx-k*rx)} ${num(y-ry)} ${num(cx)} ${num(y-ry)} c`,
        `${num(cx+k*rx)} ${num(y-ry)} ${num(cx+rx)} ${num(y-k*ry)} ${num(cx+rx)} ${num(y)} c`,
        fill&&stroke?'B':fill?'f':'S');return api;
    },
    output(){return out.join('\n');}
  };
  return api;
}

export function wrapPdfText(text,maxChars=80){
  const words=ascii(text).replace(/\s+/g,' ').trim().split(' ').filter(Boolean),lines=[];let line='';
  for(const word of words){const next=line?`${line} ${word}`:word;if(next.length<=maxChars){line=next;continue;}if(line)lines.push(line);line=word;}
  if(line)lines.push(line);return lines.length?lines:[''];
}

export function pdfMoney(value){
  const n=Number(value||0);const absolute=Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});return n<0?`-${absolute}`:absolute;
}

export function pdfDate(value){
  if(!value)return'';const d=new Date(`${String(value).slice(0,10)}T12:00:00`);if(Number.isNaN(d.getTime()))return String(value);return d.toLocaleDateString('en-US',{month:'2-digit',day:'2-digit',year:'numeric'});
}

export function buildPdf(contentStreams){
  const pages=Array.isArray(contentStreams)?contentStreams:[contentStreams];
  const objects=[];
  const firstPageObj=6;
  const pageRefs=pages.map((_,i)=>`${firstPageObj+i*2} 0 R`).join(' ');
  objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
  objects[2]=`<< /Type /Pages /Kids [${pageRefs}] /Count ${pages.length} >>`;
  objects[3]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  objects[5]='<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>';
  pages.forEach((stream,i)=>{
    const pageNo=firstPageObj+i*2,contentNo=pageNo+1;
    const content=ascii(stream).replace(/\?\/F/g,'/F');
    objects[pageNo]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentNo} 0 R >>`;
    objects[contentNo]=`<< /Length ${Buffer.byteLength(content,'ascii')} >>\nstream\n${content}\nendstream`;
  });
  let pdf='%PDF-1.4\n%ERP\n';const offsets=[0];
  for(let i=1;i<objects.length;i++){offsets[i]=Buffer.byteLength(pdf,'ascii');pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf,'ascii');
  pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(let i=1;i<objects.length;i++)pdf+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf,'ascii');
}

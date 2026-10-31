/* ===== shared document renderer (used by the advisor dashboard and the student portal) ===== */
const DOCX={};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dmy=t=>{const d=new Date(t||Date.now());return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();};
const longDate=(t,lang)=>new Date(t||Date.now()).toLocaleDateString(lang==='ar'?'ar-AE-u-nu-latn':'en-GB',{day:'numeric',month:'long',year:'numeric'});
const img=(src,cls)=>src?`<img class="${cls}" src="${esc(src)}" crossorigin="anonymous" alt="">`:'';
function L(c){ const ar=c.lang==='ar'; const b=c.brand;
  return { signatory: (ar?b.signatory_ar:b.signatory_en)||b.signatory_en||'', role:(ar?b.role_ar:b.role_en)||b.role_en||'', org:(ar?b.org_ar:b.org_en)||'', ar }; }

function certPage(c){
  const b=c.brand, l=L(c), f=c.fields; const dir=l.ar?'rtl':'ltr';
  if(b.template==='modern'){
    const logo=c.extraLogo||b.logoTop;
    return `<div class="pg land m cert" dir="${dir}" style="--a:${esc(b.accent||'#1F3A5F')};--g:${esc(b.gold||'#A8843A')}"><div class="band"></div><div class="in">
      ${logo?img(logo,'logo'):''}
      <div class="kicker">${esc(l.org||b.label||'')}</div>
      <div class="t">${esc(f.title)}</div>
      <div class="pr">${l.ar?'تُمنح هذه الشهادة إلى':'This certificate is presented to'}</div>
      <div class="nm">${esc(c.name)}</div>
      <div class="ld">${esc(f.lead)} <b>${esc(f.program)}</b>${f.program&&!l.ar?'.':''}${f.body?' '+esc(f.body):''}</div>
      <div class="ft"><div>${dmy(c.date)}<br><span style="font-size:10px;color:#9a9682">Ref ${esc(c.ref)}${c.verify?' · '+esc(c.verify):''}</span></div>
        <div class="sg">${img(b.signature,'')}<b>${esc(l.signatory)}</b>${esc(l.role)}</div></div>
    </div></div>`;
  }
  return `<div class="pg land f cert" dir="${dir}" style="--fr:${esc(b.frameColor||'#4B4733')};--tc:${esc(b.titleColor||'#6FA6C0')};--ink2:${esc(b.inkColor||'#46412F')}">
    <div class="frame"></div>${img(b.logoTop,'lt')}${img(c.extraLogo,'lx')}
    <div class="center">
      <div class="t">${esc(f.title)}</div>
      <div class="ct">${l.ar?(c.gender==='f'?'تشهد هذه الوثيقة بأن الطالبة':'تشهد هذه الوثيقة بأن الطالب'):'This certifies that'}</div>
      <div class="nm">${esc(c.name)}</div>
      <div class="ld">${esc(f.lead)}<br><b>${esc(f.program)}</b>${f.program&&!l.ar?'.':''}</div>
      ${f.body?`<div class="bd">${esc(f.body)}</div>`:''}
    </div>
    <div class="sig">${b.signature?img(b.signature,''):'<div class="line"></div>'}<div>${esc(l.signatory)}</div><div>${esc(l.role)}</div><div>${dmy(c.date)}</div></div>
    ${img(b.logoBottom,'lb')}
    <div class="ref">REF ${esc(c.ref)}${c.verify?' · VERIFY: '+esc(c.verify):''}</div>
  </div>`;
}

function letterPages(host,c){
  const b=c.brand,l=L(c),dir=l.ar?'rtl':'ltr',modern=b.template==='modern';
  const paras=String(c.letter||'').split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean);
  const units=[`<div class="date">${esc(longDate(c.date,c.lang))}</div>`,...paras.map(p=>`<p>${esc(p).replace(/\n/g,'<br>')}</p>`),
    `<div class="sgb">${l.ar?'وتفضلوا بقبول فائق الاحترام والتقدير،':'Sincerely,'}${img(b.signature,'')}<b>${esc(l.signatory)}</b><br>${esc(l.role)}${l.org?'<br>'+esc(l.org):''}${b.email?'<br>'+esc(b.email):''}${b.phone?'<br>'+esc(b.phone):''}</div>`];
  const pages=[];
  const mk=(first)=>{ const d=document.createElement('div');
    if(modern){ d.className='pg port m letter'+(first?'':' cont'); d.style.cssText=`--a:${b.accent||'#1F3A5F'};--g:${b.gold||'#A8843A'}`;
      d.innerHTML=`<div class="band"></div>${first?`<div class="head"><div class="who"><b>${esc(l.signatory)}</b>${esc(l.role)}${l.org?'<br>'+esc(l.org):''}</div>${img(c.extraLogo||b.logoTop,'logo')}</div>`:''}<div class="lbody"></div><div class="pno"><span>${esc(c.ref)}${c.verify?' · '+esc(c.verify):''}</span><span class="n"></span></div>`; }
    else { d.className='pg port f letter'+(first?'':' cont'); d.style.cssText=`--fr:${b.frameColor||'#4B4733'};--tc:${b.titleColor||'#6FA6C0'}`;
      d.innerHTML=`<div class="frame"></div>${first?img(b.logoTop,'lt')+img(c.extraLogo,'lx'):''}<div class="lbody"></div>${img(b.logoBottom,'lb')}<div class="pno"><span class="n"></span> ${esc(c.ref)}${c.verify?' · '+esc(c.verify):''}</div>`; }
    d.setAttribute('dir',dir); host.appendChild(d); pages.push(d); return d.querySelector('.lbody'); };
  let body=mk(true);
  units.forEach(u=>{ const t=document.createElement('div'); t.innerHTML=u; const el=t.firstElementChild; body.appendChild(el);
    if(body.scrollHeight>body.clientHeight+1&&body.children.length>1){ body.removeChild(el); body=mk(false); body.appendChild(el);} });
  pages.forEach((p,i)=>{ const n=p.querySelector('.n'); if(n) n.textContent=pages.length>1?(i+1)+' / '+pages.length+' ·':''; });
  return pages;
}

let fontsReady=null;
function ensureFonts(){ if(!fontsReady) fontsReady=Promise.all(['27px Arimo','bold 17px Arimo','50px Tinos','17px Tinos','56px Amiri','17px "IBM Plex Sans Arabic"','52px Fraunces','18px "Source Serif 4"','44px "Reem Kufi"'].map(f=>document.fonts.load(f).catch(()=>{}))).then(()=>document.fonts.ready); return fontsReady; }
function buildPages(host,c){
  host.innerHTML='';
  if(c.type==='rec') return letterPages(host,c);
  host.innerHTML=certPage(c); return [host.firstElementChild];
}
async function drawPreviewInto(pv,c){
  await ensureFonts();
  const inner=document.createElement('div'); inner.className='pv-inner';
  pv.innerHTML=''; pv.appendChild(inner);
  const pages=buildPages(inner,c);
  const w=pages[0]?pages[0].offsetWidth:794; const sc=pv.clientWidth/w;
  inner.style.transform='scale('+sc+')';
  pv.style.height=(inner.scrollHeight*sc)+'px';
  return pages.length;
}
async function makePdf(c){
  await ensureFonts();
  const stage=document.getElementById('stage');
  const pages=buildPages(stage,c);
  await Promise.all([...stage.querySelectorAll('img')].map(im=>im.complete?0:new Promise(res=>{im.onload=im.onerror=res;})));
  const land=c.type!=='rec';
  const pdf=new window.jspdf.jsPDF({orientation:land?'landscape':'portrait',unit:'pt',format:'a4',compress:true});
  const W=pdf.internal.pageSize.getWidth(),H=pdf.internal.pageSize.getHeight();
  for(let i=0;i<pages.length;i++){
    const cv=await html2canvas(pages[i],{scale:2,useCORS:true,backgroundColor:'#ffffff',logging:false,onclone:(doc)=>{const s=doc.getElementById('stage');if(s)s.style.left='0';}});
    if(i) pdf.addPage('a4',land?'landscape':'portrait');
    pdf.addImage(cv.toDataURL('image/jpeg',0.92),'JPEG',0,0,W,H);
  }
  stage.innerHTML='';
  const fname=(c.type==='rec'?'Recommendation':'Certificate')+' - '+String(c.name).replace(/[\\/:*?"<>|]/g,'')+' - '+c.ref+'.pdf';
  return {blob:pdf.output('blob'),fname};
}

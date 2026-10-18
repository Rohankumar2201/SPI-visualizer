const $=i=>document.getElementById(i);
const{trim,fmtT,fmtF,hex,BASE,FIELDS,validate,loadSaved,build,levelAt,busAt,phaseAt,summaryText,csvText}=SPI;
const PRESETS=[
['Mode 0, 8-bit, MSB first',{cpol:0,cpha:0}],
['Mode 1, 8-bit',{cpol:0,cpha:1}],
['Mode 2, 8-bit',{cpol:1,cpha:0}],
['Mode 3, 8-bit',{cpol:1,cpha:1}],
['LSB-first transfer',{cpol:0,cpha:0,order:'lsb'}],
['Two words with inter-word delay',{words:2,delay:2,mtx:'0xA5, 0x3C',stx:'0x12, 0x34'}],
['Full-duplex, different data',{cpol:1,cpha:1,width:16,words:2,mtx:'0xBEEF, 0x1234',stx:'0xC0DE, 0xA55A'}]];
let tl=null,sel={w:0,i:0},cur=0,scale=0.1,playing=false,last=0;
const L=76,TOP=30,RH=62;

function readForm(){const raw={};FIELDS.forEach(f=>raw[f]=$(f).value);return validate(raw)}

function render(){
  if(!tl)return;
  const css=getComputedStyle(document.documentElement),col=n=>css.getPropertyValue(n).trim();
  const rows=['SCLK','MOSI','MISO','CS'],colors=[col('--clk'),col('--mosi'),col('--miso'),col('--cs')];
  const W=L+tl.total*scale+16,HH=TOP+4*RH+8,x=t=>(L+t*scale).toFixed(2);
  const yy=(r,l)=>TOP+r*RH+(l?10:46),mid=r=>TOP+r*RH+28;
  let g='<rect width="100%" height="100%" fill="'+col('--bg')+'"/>';
  const s=tl.bits.find(b=>b.w===sel.w&&b.i===sel.i);
  if(s)g+='<rect x="'+x(s.t0)+'" y="'+(TOP-4)+'" width="'+((s.t1-s.t0)*scale)+'" height="'+(4*RH)+'" fill="'+col('--hl')+'" opacity=".7"/>';
  const raw=70/scale,p=10**Math.floor(Math.log10(raw)),step=[1,2,5,10].map(k=>k*p).find(v=>v>=raw);
  for(let t=0;t<=tl.total;t+=step)g+='<line x1="'+x(t)+'" y1="'+(TOP-6)+'" x2="'+x(t)+'" y2="'+(HH-4)+'" stroke="'+col('--gr')+'"/><text x="'+x(t)+'" y="14" fill="'+col('--mu')+'" font-size="10" text-anchor="middle">'+fmtT(t)+'</text>';
  rows.forEach((r,k)=>g+='<text x="8" y="'+(mid(k)+4)+'" fill="'+colors[k]+'" font-size="12" font-weight="600">'+r+'</text>');
  const dig=(arr,r,c)=>{let d='M'+x(0)+' '+yy(r,arr[0][1]);for(let k=1;k<arr.length;k++)d+='H'+x(arr[k][0])+'V'+yy(r,arr[k][1]);return'<path d="'+d+'H'+x(tl.total)+'" fill="none" stroke="'+c+'" stroke-width="2"/>'};
  const bus=(segs,r,c)=>{
    const y0=yy(r,1),y1=yy(r,0),ym=mid(r);
    let o='<line x1="'+x(0)+'" x2="'+x(tl.total)+'" y1="'+ym+'" y2="'+ym+'" stroke="'+c+'" stroke-opacity=".4" stroke-dasharray="3 3"/>';
    for(const q of segs){
      const a=+x(q.t0),b=+x(q.t1),k=Math.min(4,(b-a)/3);
      o+='<polygon data-w="'+q.w+'" data-i="'+q.i+'" points="'+(a+k)+','+y0+' '+(b-k)+','+y0+' '+b+','+ym+' '+(b-k)+','+y1+' '+(a+k)+','+y1+' '+a+','+ym+'" fill="'+c+'" fill-opacity=".15" stroke="'+c+'" stroke-width="1.5" style="cursor:pointer"/>';
      if(b-a>12)o+='<text x="'+((a+b)/2)+'" y="'+(ym+4)+'" fill="'+col('--tx')+'" font-size="12" text-anchor="middle" pointer-events="none">'+q.v+'</text>';
      if(b-a>44)o+='<text x="'+((a+b)/2)+'" y="'+(y1+11)+'" fill="'+col('--mu')+'" font-size="9" text-anchor="middle" pointer-events="none">b'+q.b+'</text>';
    }
    return o;
  };
  g+=dig(tl.sclk,0,colors[0])+bus(tl.mosi,1,colors[1])+bus(tl.miso,2,colors[2])+dig(tl.cs,3,colors[3]);
  for(const b of tl.bits){
    const sx=x(b.sample);
    g+='<line x1="'+sx+'" y1="'+(TOP+6)+'" x2="'+sx+'" y2="'+(mid(2)+4)+'" stroke="'+col('--smp')+'" stroke-dasharray="2 3" opacity=".8"/>';
    for(const r of[0,1,2])g+='<circle cx="'+sx+'" cy="'+mid(r)+'" r="3.5" fill="'+col('--smp')+'"/>';
  }
  g+='<line id="curline" y1="'+(TOP-8)+'" y2="'+(HH-2)+'" stroke="'+col('--cur')+'" stroke-width="1.5"/>';
  $('wave').innerHTML='<svg id="svg" xmlns="http://www.w3.org/2000/svg" width="'+W+'" height="'+HH+'" font-family="ui-monospace,Menlo,Consolas,monospace">'+g+'</svg>';
  updateCursor();
}

function updateCursor(){
  const ln=$('curline');if(!ln||!tl)return;
  const px=L+cur*scale;ln.setAttribute('x1',px);ln.setAttribute('x2',px);
  const w=$('wave');
  if(playing&&(px<w.scrollLeft+L||px>w.scrollLeft+w.clientWidth-40))w.scrollLeft=px-L-40;
  const m=busAt(tl.mosi,cur),s=busAt(tl.miso,cur),cs=levelAt(tl.cs,cur),ph=phaseAt(tl,cur);
  const asserted=cs===tl.c.csAct;
  $('cursor').innerHTML='<b>Time: '+fmtT(cur)+'</b><span>SCLK = '+levelAt(tl.sclk,cur)+'</span><span>MOSI = '+(m?m.v:'—')+'</span><span>MISO = '+(s?s.v:'—')+'</span><span>CS = '+cs+(asserted?' (asserted)':' (idle)')+'</span><span>'+ph.p+(ph.b!==undefined?', bit '+ph.b:'')+'</span>';
}

function renderPanels(){
  $('sum').textContent=summaryText(tl);
  $('clk').textContent='Period '+fmtT(tl.T)+' · half-period '+fmtT(tl.H);
  $('bits').innerHTML='<tr><th>Word</th><th>Bit</th><th>MOSI</th><th>MISO</th><th>Sample edge</th></tr>'+tl.bits.map(b=>'<tr class="bt'+(b.w===sel.w&&b.i===sel.i?' sel':'')+'" data-w="'+b.w+'" data-i="'+b.i+'"><td>'+b.w+'</td><td>'+b.b+'</td><td>'+b.m+'</td><td>'+b.s+'</td><td>'+(b.rising?'Rising':'Falling')+'</td></tr>').join('');
  $('ev').textContent=tl.events.map(e=>fmtT(e.t).padStart(11)+'  '+e.text).join('\n');
  const b=tl.bits.find(b=>b.w===sel.w&&b.i===sel.i);
  $('insp').textContent=b?'Word:  '+b.w+'\nBit:   '+b.b+' (position '+b.i+' in word)\n\nMOSI:  '+b.m+'\nMISO:  '+b.s+'\n\nSampling edge: '+(b.rising?'Rising':'Falling')+' ('+(tl.c.cpha?'trailing':'leading')+')\nSample time:   '+fmtT(b.sample)+'\nShift time:    '+fmtT(b.shift)+'\nSPI mode:      '+(tl.c.cpol*2+tl.c.cpha):'';
}
function hintText(){
  return 'CPOL='+$('cpol').value+': SCLK idles '+($('cpol').value==='1'?'HIGH':'LOW')+'. CPHA='+$('cpha').value+': '+($('cpha').value==='1'?'shift on leading edge, sample on trailing edge.':'sample on leading edge, shift on trailing edge.');
}
function fit(){if(!tl)return;scale=Math.max(1e-5,($('wave').clientWidth-L-24)/tl.total);render()}
const CONTROLS=['play','pause','step','reset','zi','zo','fit','png','csv','copy','save'];
function clearView(){
  tl=null;pause();
  $('wave').innerHTML='';$('cursor').textContent='';$('clk').textContent='';
  $('bits').textContent='';$('ev').textContent='';$('insp').textContent='';
  $('sum').textContent='No transaction: fix the errors in the configuration panel.';
}
function update(){
  $('custom').style.display=$('freq').value==='custom'?'':'none';
  $('mode').value=$('cpol').value*2+ +$('cpha').value;
  $('hint').textContent=hintText();
  const r=readForm();
  $('err').textContent=r.errors.join('\n');
  CONTROLS.forEach(id=>$(id).disabled=r.errors.length>0);
  if(r.errors.length){clearView();return}
  tl=build(r.c,r.M,r.S);
  if(!tl.bits.some(b=>b.w===sel.w&&b.i===sel.i))sel={w:0,i:0};
  cur=Math.min(cur,tl.total);
  renderPanels();fit();
}
function apply(p){
  const v={...BASE,...p};
  FIELDS.forEach(f=>$(f).value=v[f]);
  if(!FIELDS.includes('mode'))$('mode').value=v.cpol*2+v.cpha;
  cur=0;sel={w:0,i:0};update();
}

function pause(){playing=false}
function tick(now){
  if(!playing)return;
  cur+=(now-last)/1000*tl.total/8*+$('speed').value;last=now;
  if(cur>=tl.total){cur=tl.total;pause()}
  updateCursor();requestAnimationFrame(tick);
}
$('play').onclick=()=>{if(!tl||playing)return;if(cur>=tl.total)cur=0;playing=true;last=performance.now();requestAnimationFrame(tick)};
$('pause').onclick=pause;
$('reset').onclick=()=>{pause();cur=0;updateCursor();$('wave').scrollLeft=0};
$('step').onclick=()=>{if(!tl)return;pause();const t=tl.sclk.slice(1).map(a=>a[0]).find(t=>t>cur+1e-6);cur=t===undefined?tl.total:t;updateCursor()};
$('zi').onclick=()=>{if(!tl)return;scale=Math.min(50,4e5/tl.total,scale*1.5);render()};
$('zo').onclick=()=>{if(!tl)return;scale=Math.max(1e-5,scale/1.5);render()};
$('fit').onclick=fit;
$('mode').onchange=()=>{const m=+$('mode').value;$('cpol').value=m>>1;$('cpha').value=m&1;update()};
FIELDS.filter(f=>f!=='cpol'&&f!=='cpha').forEach(f=>$(f).oninput=update);
$('cpol').onchange=$('cpha').onchange=update;
$('wave').addEventListener('click',e=>{
  const el=e.target.closest('[data-w]');
  if(el){sel={w:+el.dataset.w,i:+el.dataset.i};renderPanels();render();return}
  if(!tl)return;
  const r=$('svg').getBoundingClientRect();
  cur=Math.max(0,Math.min(tl.total,(e.clientX-r.left-L)/scale));updateCursor();
});
$('bits').addEventListener('click',e=>{
  const tr=e.target.closest('tr[data-w]');if(!tr)return;
  sel={w:+tr.dataset.w,i:+tr.dataset.i};renderPanels();render();
});
$('preset').innerHTML=PRESETS.map((p,i)=>'<option value="'+i+'">'+(i+1)+'. '+p[0]+'</option>').join('');
$('preset').onchange=()=>apply(PRESETS[+$('preset').value][1]);
$('theme').onclick=()=>{
  const dark=getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()==='#0f141b';
  document.documentElement.dataset.theme=dark?'light':'dark';render();
};
window.addEventListener('resize',()=>{if(tl)fit()});

function download(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
$('csv').onclick=()=>{
  if(!tl)return;
  download('spi-transaction.csv',new Blob([csvText(tl)],{type:'text/csv'}));
};
function flash(id,text){
  const b=$(id),old=b.dataset.label||(b.dataset.label=b.textContent);
  b.textContent=text;setTimeout(()=>b.textContent=old,1800);
}
$('png').onclick=()=>{
  const svg=$('svg');if(!tl||!svg)return;
  if(+svg.getAttribute('width')>8000){flash('png','Zoom out first');return}
  const img=new Image(),url=URL.createObjectURL(new Blob([svg.outerHTML],{type:'image/svg+xml'}));
  img.onerror=()=>{URL.revokeObjectURL(url);flash('png','PNG failed')};
  img.onload=()=>{
    const cv=document.createElement('canvas');cv.width=img.width*2;cv.height=img.height*2;
    const cx=cv.getContext('2d');cx.scale(2,2);cx.drawImage(img,0,0);URL.revokeObjectURL(url);
    cv.toBlob(b=>b?download('spi-waveform.png',b):flash('png','PNG failed'));
  };
  img.src=url;
};
$('copy').onclick=async()=>{
  if(!tl)return;
  try{await navigator.clipboard.writeText(summaryText(tl));$('copy').textContent='Copied'}catch(e){$('copy').textContent='Copy failed'}
  setTimeout(()=>$('copy').textContent='Copy summary',1200);
};
$('save').onclick=()=>{
  if(!tl)return;
  try{const o={};FIELDS.forEach(f=>o[f]=$(f).value);localStorage.setItem('spiviz',JSON.stringify(o));$('save').textContent='Saved'}catch(e){$('save').textContent='Not saved'}
  setTimeout(()=>$('save').textContent='Save config',1200);
};
let saved=null;
try{saved=localStorage.getItem('spiviz')}catch(e){}
const loaded=loadSaved(saved);
apply(loaded.cfg);
if(loaded.note)$('err').textContent=loaded.note;

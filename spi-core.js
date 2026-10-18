(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SPI=factory();
})(this,function(){
const trim=n=>String(+n.toFixed(3));
const fmtT=ns=>Math.abs(ns)>=1000?trim(ns/1000)+' µs':trim(ns)+' ns';
const fmtF=hz=>hz>=1e6?trim(hz/1e6)+' MHz':trim(hz/1e3)+' kHz';
const hex=(v,n)=>'0x'+v.toString(16).toUpperCase().padStart(n/4,'0');
const bitOf=(v,b)=>Math.floor(v/2**b)%2;

const BASE={cpol:0,cpha:0,freq:'1000000',custom:2000,width:8,order:'msb',words:1,delay:0,cs:0,mtx:'0xA5',stx:'0x3C'};
const FIELDS=Object.keys(BASE);
const CHOICES={cpol:['0','1'],cpha:['0','1'],freq:['100000','500000','1000000','5000000','10000000','custom'],width:['8','16','32'],order:['msb','lsb'],cs:['0','1']};
const LIMITS={minFreq:1e3,maxFreq:5e7,maxWords:16,maxDelay:1000};

const NUMBER=/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const toNum=s=>{s=String(s).trim();return NUMBER.test(s)?Number(s):NaN};

function parseList(str,w,name,n,e){
  const max=2**w-1,out=[],tokens=str.split(/[\s,;]+/).filter(Boolean);let bad=false;
  if(!tokens.length){e.push(name+' is empty.');return out}
  for(const t of tokens){
    let v=NaN;
    if(/^0x[0-9a-f]+$/i.test(t))v=parseInt(t.slice(2),16);
    else if(/^0b[01]+$/i.test(t))v=parseInt(t.slice(2),2);
    if(isNaN(v)){e.push(name+': "'+t+'" is not valid hex (0x..) or binary (0b..).');bad=true;continue}
    if(v>max){e.push(name+': '+t+' exceeds '+w+' bits (max '+hex(max,w)+'). Not truncated.');bad=true;continue}
    out.push(v);
  }
  if(!bad&&Number.isInteger(n)&&out.length!==n)e.push(name+': expected '+n+' value(s) for '+n+' word(s), got '+out.length+'.');
  return out;
}

function validate(raw){
  const e=[],g=k=>raw[k]===undefined||raw[k]===null?'':String(raw[k]);
  const c={cpol:toNum(g('cpol')),cpha:toNum(g('cpha')),width:toNum(g('width')),order:g('order'),csAct:toNum(g('cs'))};
  if(c.cpol!==0&&c.cpol!==1)e.push('CPOL must be 0 or 1.');
  if(c.cpha!==0&&c.cpha!==1)e.push('CPHA must be 0 or 1.');
  if(![8,16,32].includes(c.width))e.push('Data width must be 8, 16 or 32.');
  if(c.order!=='msb'&&c.order!=='lsb')e.push('Bit order must be MSB first or LSB first.');
  if(c.csAct!==0&&c.csAct!==1)e.push('Chip select must be active-low or active-high.');
  c.freq=g('freq')==='custom'?toNum(g('custom'))*1e3:toNum(g('freq'));
  if(!(Number.isFinite(c.freq)&&c.freq>=LIMITS.minFreq&&c.freq<=LIMITS.maxFreq))e.push('Clock must be a number between 1 kHz and 50 MHz.');
  c.words=/^\d+$/.test(g('words').trim())?Number(g('words')):NaN;
  if(!(Number.isInteger(c.words)&&c.words>=1&&c.words<=LIMITS.maxWords))e.push('Number of words must be an integer from 1 to 16.');
  c.delay=toNum(g('delay'));
  if(!(Number.isFinite(c.delay)&&c.delay>=0&&c.delay<=LIMITS.maxDelay))e.push('Inter-word delay must be a number from 0 to 1000 clock periods.');
  let M=[],S=[];
  if([8,16,32].includes(c.width)){
    M=parseList(g('mtx'),c.width,'Master TX',c.words,e);
    S=parseList(g('stx'),c.width,'Slave TX',c.words,e);
  }
  return{c,M,S,errors:e};
}

function loadSaved(text){
  const defaults={cfg:{...BASE},note:''};
  if(text===null||text===undefined)return defaults;
  const bad={cfg:{...BASE},note:'Saved configuration was unreadable or invalid; defaults loaded.'};
  let o;
  try{o=JSON.parse(text)}catch(err){return bad}
  if(!o||typeof o!=='object'||Array.isArray(o))return bad;
  const cfg={...BASE};
  for(const f of FIELDS){
    const v=o[f];
    if(typeof v!=='string'&&typeof v!=='number')continue;
    if(CHOICES[f]&&!CHOICES[f].includes(String(v)))return bad;
    cfg[f]=v;
  }
  return validate(cfg).errors.length?bad:{cfg,note:''};
}

function build(c,M,S){
  const T=1e9/c.freq,H=T/2,n=c.width,idle=c.cpol,act=c.csAct,gap=c.delay*T,wl=n*T;
  const csOn=T,go=csOn+H,bits=[],sclk=[[0,idle]],mosi=[],miso=[],events=[],mrx=[],srx=[];
  const leadRising=idle===0,sampleRising=(c.cpha===0)===(idle===0);
  for(let w=0;w<c.words;w++){
    const ws=go+w*(wl+gap);mrx[w]=0;srx[w]=0;
    for(let i=0;i<n;i++){
      const b=c.order==='msb'?n-1-i:i,t0=ws+i*T,t1=t0+T;
      const lead=c.cpha?t0:t0+H,trail=c.cpha?t0+H:t1,sample=c.cpha?trail:lead,shift=c.cpha?lead:trail;
      const m=bitOf(M[w],b),s=bitOf(S[w],b);
      mrx[w]+=s*2**b;srx[w]+=m*2**b;
      sclk.push([lead,1-idle],[trail,idle]);
      const a=(w===0&&i===0&&c.cpha===0)?csOn:t0;
      bits.push({w,i,b,m,s,t0:a,t1,lead,trail,sample,shift,rising:sampleRising});
      mosi.push({t0:a,t1,v:m,w,i,b});miso.push({t0:a,t1,v:s,w,i,b});
      const ev=(t,isLead)=>{
        const rise=isLead?leadRising:!leadRising,isSample=t===sample&&(isLead===!c.cpha);
        events.push({t,w,b,text:(isSample?'Sample':'Shift')+' edge ('+(rise?'rising':'falling')+'), word '+w+' bit '+b+(isSample?' · MOSI='+m+' MISO='+s:'')});
      };
      ev(lead,true);ev(trail,false);
    }
  }
  const csOff=go+(c.words-1)*(wl+gap)+wl+H,total=csOff+T;
  const cs=[[0,1-act],[csOn,act],[csOff,1-act]];
  events.push({t:0,text:'SCLK initialised '+(idle?'HIGH':'LOW')},{t:csOn,text:'CS asserted ('+(act?'HIGH':'LOW')+')'},{t:csOff,text:'CS deasserted'});
  events.sort((a,b)=>a.t-b.t);
  return{c,T,H,M,S,mrx,srx,bits,sclk,cs,mosi,miso,events,csOn,go,csOff,total,wl,gap};
}
const levelAt=(arr,t)=>{let v=arr[0][1];for(const[x,l]of arr){if(x<=t)v=l;else break}return v};
const busAt=(segs,t)=>segs.find(g=>t>=g.t0&&t<g.t1)||null;
function phaseAt(tl,t){
  if(t<tl.csOn)return{p:'Idle, CS deasserted'};
  if(t<tl.go)return{p:'CS setup'};
  if(t>=tl.csOff)return{p:'Idle, CS deasserted'};
  for(let w=0;w<tl.c.words;w++){
    const ws=tl.go+w*(tl.wl+tl.gap);
    if(t>=ws&&t<ws+tl.wl){const i=Math.floor((t-ws)/tl.T);return{p:'Word '+w+' transfer',w,b:tl.c.order==='msb'?tl.c.width-1-i:i}}
  }
  return{p:'Inter-word gap'};
}

function wordRows(tl){
  const n=tl.c.width;
  return tl.M.map((m,w)=>'Word '+w+':  Master TX '+hex(m,n)+'  Slave TX '+hex(tl.S[w],n)+'\n         Master RX '+hex(tl.mrx[w],n)+'  Slave RX '+hex(tl.srx[w],n)).join('\n');
}
function summaryText(tl){
  const c=tl.c;
  return 'SPI Transaction\nMode:         '+(c.cpol*2+c.cpha)+'\nCPOL:         '+c.cpol+'\nCPHA:         '+c.cpha+'\nClock:        '+fmtF(c.freq)+'\nClock Period: '+fmtT(tl.T)+'\nHalf Period:  '+fmtT(tl.H)+'\nData Width:   '+c.width+' bits\nBit Order:    '+(c.order==='msb'?'MSB':'LSB')+' first\nCS:           active-'+(c.csAct?'high':'low')+'\nWords:        '+c.words+', delay '+trim(c.delay)+' clock periods\n\n'+wordRows(tl);
}
function csvText(tl){
  const q=s=>'"'+s.replace(/"/g,'""')+'"';
  const rows=['time_ns,SCLK,MOSI,MISO,CS,event,word,bit'];
  for(const e of tl.events){
    const m=busAt(tl.mosi,e.t),s=busAt(tl.miso,e.t);
    rows.push([+e.t.toFixed(3),levelAt(tl.sclk,e.t),m?m.v:'',s?s.v:'',levelAt(tl.cs,e.t),q(e.text),e.w===undefined?'':e.w,e.b===undefined?'':e.b].join(','));
  }
  return rows.join('\n');
}

return{trim,fmtT,fmtF,hex,BASE,FIELDS,LIMITS,toNum,parseList,validate,loadSaved,build,levelAt,busAt,phaseAt,summaryText,csvText};
});

const test=require('node:test');
const assert=require('node:assert/strict');
const SPI=require('../spi-core.js');
const{BASE,validate,build,levelAt,busAt,phaseAt,summaryText,csvText,fmtT,loadSaved,parseList}=SPI;

const make=(over={})=>{
  const r=validate({...BASE,...over});
  assert.deepEqual(r.errors,[]);
  return build(r.c,r.M,r.S);
};
const errorsFor=over=>validate({...BASE,...over}).errors;
const bitsOf=(tl,sig)=>tl.bits.filter(b=>b.w===0).map(b=>b[sig]);
const times=tl=>tl.sclk.slice(1).map(x=>x[0]);

// 1 MHz: T=1000 ns, H=500 ns, CS asserts at 1000, first bit window starts at 1500 (CS setup = half period)
test('mode 0: idle low, sample on rising leading edge, shift on falling trailing edge',()=>{
  const tl=make({cpol:0,cpha:0});
  assert.deepEqual(tl.sclk.slice(0,3),[[0,0],[2000,1],[2500,0]]);
  assert.equal(tl.bits[0].sample,2000);
  assert.equal(tl.bits[0].shift,2500);
  assert.ok(tl.bits.every(b=>b.rising===true));
  assert.deepEqual(bitsOf(tl,'m'),[1,0,1,0,0,1,0,1]);
  assert.deepEqual(bitsOf(tl,'s'),[0,0,1,1,1,1,0,0]);
  assert.equal(tl.mrx[0],0x3C);
  assert.equal(tl.srx[0],0xA5);
});
test('mode 1: idle low, shift on rising leading edge, sample on falling trailing edge',()=>{
  const tl=make({cpol:0,cpha:1});
  assert.deepEqual(tl.sclk.slice(0,3),[[0,0],[1500,1],[2000,0]]);
  assert.equal(tl.bits[0].shift,1500);
  assert.equal(tl.bits[0].sample,2000);
  assert.ok(tl.bits.every(b=>b.rising===false));
  assert.equal(tl.mrx[0],0x3C);
  assert.equal(tl.srx[0],0xA5);
});
test('mode 2: idle high, sample on falling leading edge, shift on rising trailing edge',()=>{
  const tl=make({cpol:1,cpha:0});
  assert.deepEqual(tl.sclk.slice(0,3),[[0,1],[2000,0],[2500,1]]);
  assert.equal(tl.bits[0].sample,2000);
  assert.ok(tl.bits.every(b=>b.rising===false));
});
test('mode 3: idle high, shift on falling leading edge, sample on rising trailing edge',()=>{
  const tl=make({cpol:1,cpha:1});
  assert.deepEqual(tl.sclk.slice(0,3),[[0,1],[1500,0],[2000,1]]);
  assert.equal(tl.bits[0].shift,1500);
  assert.equal(tl.bits[0].sample,2000);
  assert.ok(tl.bits.every(b=>b.rising===true));
});
test('the four modes produce four different SCLK waveforms',()=>{
  const sigs=[[0,0],[0,1],[1,0],[1,1]].map(([cpol,cpha])=>JSON.stringify(make({cpol,cpha}).sclk));
  assert.equal(new Set(sigs).size,4);
});

for(const[cpol,cpha]of[[0,0],[0,1],[1,0],[1,1]]){
  test('mode '+(cpol*2+cpha)+': data is stable around the sampling edge and changes only on the shift edge',()=>{
    const tl=make({cpol,cpha,words:2,delay:1,mtx:'0xA5,0x3C',stx:'0x3C,0xA5'});
    for(const b of tl.bits){
      assert.equal(busAt(tl.mosi,b.sample-100).v,b.m);
      assert.equal(busAt(tl.mosi,b.sample).v,b.m);
      assert.equal(busAt(tl.mosi,b.sample+100).v,b.m);
      assert.equal(busAt(tl.miso,b.sample).v,b.s);
      assert.ok(b.sample-b.t0>=tl.H-1e-9,'setup of at least half a period');
      assert.ok(b.t1-b.sample>=tl.H-1e-9,'hold of at least half a period');
      if(cpha===1)assert.equal(b.t0,b.shift);
      else assert.equal(b.t1,b.shift);
    }
    const firstWord=tl.bits.filter(b=>b.w===0);
    firstWord.slice(1).forEach((b,k)=>assert.equal(b.t0,firstWord[k].t1));
  });
}

test('clock period, half period and total time for common frequencies',()=>{
  const at=freq=>make({freq:String(freq)});
  assert.equal(at(1e6).T,1000);   assert.equal(at(1e6).H,500);
  assert.equal(at(1e5).T,10000);  assert.equal(at(1e5).H,5000);
  assert.equal(at(5e5).T,2000);
  assert.equal(at(5e6).T,200);
  assert.equal(at(1e7).T,100);
  const tl=at(1e6);
  assert.equal(tl.csOn,1000);assert.equal(tl.go,1500);assert.equal(tl.csOff,10000);assert.equal(tl.total,11000);
  const s=summaryText(make({freq:'100000'}));
  assert.match(s,/Clock:\s+100 kHz/);assert.match(s,/Clock Period: 10 µs/);assert.match(s,/Half Period:\s+5 µs/);
  assert.equal(make({freq:'custom',custom:3000}).T.toFixed(3),'333.333');
  assert.equal(make({freq:'custom',custom:50000}).T,20);
});
test('time formatting',()=>{
  assert.equal(fmtT(500),'500 ns');assert.equal(fmtT(1000),'1 µs');assert.equal(fmtT(1500),'1.5 µs');
});

test('MSB-first versus LSB-first order and reconstruction',()=>{
  const msb=make({order:'msb',mtx:'0x01',stx:'0x80'}),lsb=make({order:'lsb',mtx:'0x01',stx:'0x80'});
  assert.deepEqual(bitsOf(msb,'m'),[0,0,0,0,0,0,0,1]);
  assert.deepEqual(bitsOf(lsb,'m'),[1,0,0,0,0,0,0,0]);
  assert.deepEqual(bitsOf(lsb,'b'),[0,1,2,3,4,5,6,7]);
  assert.deepEqual(bitsOf(msb,'b'),[7,6,5,4,3,2,1,0]);
  assert.equal(msb.srx[0],0x01);assert.equal(msb.mrx[0],0x80);
  assert.equal(lsb.srx[0],0x01);assert.equal(lsb.mrx[0],0x80);
});
test('full duplex: each side receives exactly what the other transmitted',()=>{
  const tl=make({width:16,words:2,mtx:'0xBEEF,0x1234',stx:'0xC0DE,0xA55A',cpol:1,cpha:1,order:'lsb'});
  assert.deepEqual(tl.srx,[0xBEEF,0x1234]);
  assert.deepEqual(tl.mrx,[0xC0DE,0xA55A]);
});
test('32-bit words, including all ones',()=>{
  const tl=make({width:32,mtx:'0xFFFFFFFF',stx:'0xDEADBEEF'});
  assert.equal(tl.bits.length,32);
  assert.equal(tl.srx[0],0xFFFFFFFF);assert.equal(tl.mrx[0],0xDEADBEEF);
  assert.match(summaryText(tl),/Master RX 0xDEADBEEF/);
});

test('two words with inter-word delay: timing, idle clock, gap behaviour',()=>{
  const tl=make({words:2,delay:2,mtx:'0xA5,0x3C',stx:'0x12,0x34'});
  assert.deepEqual(tl.mrx,[0x12,0x34]);assert.deepEqual(tl.srx,[0xA5,0x3C]);
  const w1=tl.bits.find(b=>b.w===1&&b.i===0);
  assert.equal(w1.t0,1500+8000+2000);
  assert.equal(w1.sample,12000);
  assert.equal(tl.csOff,1500+8000+2000+8000+500);
  assert.equal(levelAt(tl.sclk,10500),0,'clock idles low in the gap');
  assert.equal(busAt(tl.mosi,10500),null,'data lines are shown idle (not driven) in the gap');
  assert.equal(levelAt(tl.cs,10500),0,'CS stays asserted between words');
  assert.equal(phaseAt(tl,10500).p,'Inter-word gap');
});
test('zero inter-word delay: words are back to back and edges never overlap',()=>{
  const tl=make({words:2,delay:0,mtx:'0xFF,0x00',stx:'0x00,0xFF'});
  const t=times(tl);
  assert.equal(t.length,32);
  for(let k=1;k<t.length;k++)assert.ok(t[k]>t[k-1],'edge times strictly increase');
  assert.equal(tl.bits.find(b=>b.w===1&&b.i===0).t0,tl.bits.find(b=>b.w===0&&b.i===7).t1);
  assert.deepEqual(tl.mrx,[0x00,0xFF]);
});
test('shortest and longest transactions',()=>{
  const small=make({freq:'10000000'});
  assert.equal(small.T,100);assert.equal(small.csOff,1000);assert.equal(small.total,1100);
  const w=Array(16).fill('0xFFFFFFFF').join(',');
  const big=make({width:32,words:16,delay:1000,mtx:w,stx:w,freq:'custom',custom:1});
  assert.equal(big.bits.length,512);
  assert.equal(big.sclk.length,1+2*512);
  assert.ok(Number.isFinite(big.total)&&big.total>0);
  assert.ok(big.mrx.every(v=>v===0xFFFFFFFF));
  assert.equal(big.csOff,big.bits[511].t1+big.H+(big.bits[511].trail===big.bits[511].t1?0:big.H));
});

test('chip select polarity and timing',()=>{
  for(const[cs,idle,on]of[[0,1,0],[1,0,1]]){
    const tl=make({cs});
    assert.deepEqual(tl.cs,[[0,idle],[1000,on],[10000,idle]]);
    assert.ok(tl.csOn<tl.bits[0].sample&&tl.csOn<tl.sclk[1][0],'CS asserts before the first clock edge');
    assert.ok(tl.csOff>tl.sclk[tl.sclk.length-1][0],'CS deasserts after the last clock edge');
    assert.equal(levelAt(tl.cs,5000),on);
    assert.equal(levelAt(tl.cs,10500),idle);
  }
});

test('cursor lookups: signal levels at specific times (mode 0, 0xA5 / 0x3C)',()=>{
  const tl=make();
  assert.equal(levelAt(tl.sclk,1999),0);assert.equal(levelAt(tl.sclk,2000),1);assert.equal(levelAt(tl.sclk,2499),1);assert.equal(levelAt(tl.sclk,2500),0);
  assert.equal(busAt(tl.mosi,2100).v,1);assert.equal(busAt(tl.miso,2100).v,0);
  assert.equal(busAt(tl.mosi,3100).v,0);assert.equal(busAt(tl.miso,4100).v,1);
  assert.equal(busAt(tl.mosi,500),null);
  assert.equal(phaseAt(tl,500).p,'Idle, CS deasserted');
  assert.equal(phaseAt(tl,1200).p,'CS setup');
  assert.deepEqual(phaseAt(tl,2100),{p:'Word 0 transfer',w:0,b:7});
  assert.equal(phaseAt(tl,10500).p,'Idle, CS deasserted');
  assert.equal(phaseAt(make({order:'lsb'}),2100).b,0);
});

test('event list comes from the waveform: sorted, one sample edge per bit',()=>{
  for(const[cpol,cpha]of[[0,0],[0,1],[1,0],[1,1]]){
    const tl=make({cpol,cpha});
    for(let k=1;k<tl.events.length;k++)assert.ok(tl.events[k].t>=tl.events[k-1].t);
    const samples=tl.events.filter(e=>e.text.startsWith('Sample'));
    assert.equal(samples.length,8);
    assert.deepEqual(samples.map(e=>e.t),tl.bits.map(b=>b.sample));
    assert.ok(samples.every(e=>e.text.includes(tl.bits[0].rising?'rising':'falling')));
    assert.equal(tl.events[0].text,'SCLK initialised '+(cpol?'HIGH':'LOW'));
    assert.match(tl.events.find(e=>e.text.startsWith('CS asserted')).text,/LOW/);
    assert.equal(tl.events.filter(e=>e.text.startsWith('Shift')).length,8);
  }
});

test('CSV matches the generated waveform',()=>{
  const tl=make();
  const lines=csvText(tl).split('\n');
  assert.equal(lines[0],'time_ns,SCLK,MOSI,MISO,CS,event,word,bit');
  assert.equal(lines.length,tl.events.length+1);
  const re=/^(\d+(?:\.\d+)?),([01]),([01]?),([01]?),([01]),"(.*)",(\d*),(\d*)$/;
  const rows=lines.slice(1).map(l=>{const m=re.exec(l);assert.ok(m,l);return m});
  const first=rows.find(m=>m[6].startsWith('Sample'));
  assert.deepEqual(first.slice(1,6),['2000','1','1','0','0']);
  assert.equal(first[7],'0');assert.equal(first[8],'7');
  for(const m of rows){
    const t=+m[1];
    assert.equal(+m[2],levelAt(tl.sclk,t));assert.equal(+m[5],levelAt(tl.cs,t));
  }
  assert.equal(rows[0][1],'0');assert.equal(rows[0][6],'SCLK initialised LOW');
  assert.equal(rows[rows.length-1][6],'CS deasserted');
});

test('input parsing: accepted formats',()=>{
  const ok=(s,w,n)=>{const e=[];const v=parseList(s,w,'X',n,e);assert.deepEqual(e,[]);return v};
  assert.deepEqual(ok('0xA5',8,1),[0xA5]);
  assert.deepEqual(ok('0Xa5',8,1),[0xA5]);
  assert.deepEqual(ok('0b10100101',8,1),[0xA5]);
  assert.deepEqual(ok('0b101',8,1),[5]);
  assert.deepEqual(ok('0xA5, 0x3C  0xF0;0x00',8,4),[0xA5,0x3C,0xF0,0]);
  assert.deepEqual(ok('0xFF',8,1),[255]);
  assert.deepEqual(ok('0xFFFFFFFF',32,1),[4294967295]);
  assert.deepEqual(ok('0xA5,',8,1),[0xA5]);
});
test('input validation: data values',()=>{
  const bad=(over,re)=>{const e=errorsFor(over);assert.ok(e.length>0,'expected an error for '+JSON.stringify(over));if(re)assert.match(e.join('\n'),re)};
  bad({mtx:''},/Master TX is empty/);
  bad({stx:'   '},/Slave TX is empty/);
  bad({mtx:'0xZZ'},/not valid hex/);
  bad({mtx:'0x'},/not valid/);
  bad({mtx:'A5'},/not valid/);
  bad({mtx:'165'},/not valid/);
  bad({mtx:'-0x1'},/not valid/);
  bad({mtx:'0b102'},/not valid/);
  bad({mtx:'0b'},/not valid/);
  bad({mtx:'0x100'},/exceeds 8 bits/);
  bad({mtx:'0b111111111'},/exceeds 8 bits/);
  bad({width:32,mtx:'0x100000000'},/exceeds 32 bits/);
  bad({width:16,mtx:'0x10000'},/exceeds 16 bits/);
  bad({words:2},/expected 2 value\(s\)/);
  bad({mtx:'0xA5,0x3C'},/expected 1 value\(s\)/);
  bad({words:2,mtx:'0xA5,0x3C',stx:'0x12'},/Slave TX: expected 2/);
  assert.deepEqual(errorsFor({width:16,mtx:'0x1FF',stx:'0xFFFF'}),[]);
});
test('input validation: configuration values',()=>{
  const bad=(over,re)=>{const e=errorsFor(over);assert.ok(e.length>0,'expected an error for '+JSON.stringify(over));assert.match(e.join('\n'),re)};
  for(const w of[0,12,64,'',' ','x','NaN'])bad({width:w},/Data width/);
  for(const f of[0,999,50000001,-5,'abc','','Infinity','1e999','0x10'])bad({freq:String(f)},/Clock/);
  for(const f of['',0,0.5,50001,'abc','1e99','Infinity'])bad({freq:'custom',custom:f},/Clock/);
  for(const n of[0,17,-1,1.5,'','abc','0x2','1e1','Infinity','NaN'])bad({words:n,mtx:'0xA5',stx:'0x3C'},/Number of words/);
  for(const d of[-1,-0.5,1001,'','abc','NaN','Infinity','-Infinity','1e999','0x10'])bad({delay:d},/delay/);
  bad({order:'middle'},/Bit order/);
  bad({cs:2},/Chip select/);bad({cpol:2},/CPOL/);bad({cpha:'x'},/CPHA/);
});
test('input validation: boundaries that must be accepted',()=>{
  assert.deepEqual(errorsFor({freq:'custom',custom:1}),[]);
  assert.deepEqual(errorsFor({freq:'custom',custom:50000}),[]);
  assert.deepEqual(errorsFor({delay:0}),[]);assert.deepEqual(errorsFor({delay:1000}),[]);assert.deepEqual(errorsFor({delay:'0.5'}),[]);
  const w=Array(16).fill('0xA5').join(',');
  assert.deepEqual(errorsFor({words:16,mtx:w,stx:w}),[]);
});
test('regression: an invalid configuration yields errors and no usable transaction inputs',()=>{
  const r=validate({...BASE,mtx:'0xZZ'});
  assert.ok(r.errors.length>0);
  assert.deepEqual(r.M,[]);
});
test('regression: words entered as hex (0x2) used to be accepted as 2',()=>{
  assert.match(errorsFor({words:'0x2',mtx:'0xA5,0x3C',stx:'0x12,0x34'}).join(),/Number of words/);
});
test('regression: an invalid width no longer reports "exceeds 0 bits"',()=>{
  const e=errorsFor({width:12}).join('\n');
  assert.match(e,/Data width/);assert.doesNotMatch(e,/exceeds/);
});

test('saved configuration loading',()=>{
  const defaults=loadSaved(null);
  assert.deepEqual(defaults,{cfg:BASE,note:''});
  for(const text of['{bad','"abc"','[1,2]','null','42','{"width":"12"}','{"freq":"7"}','{"cpol":"5"}','{"words":"3"}','{"mtx":"0xZZ"}','{"order":"x"}','']){
    const r=loadSaved(text);
    assert.deepEqual(r.cfg,BASE,text);
    assert.match(r.note,/defaults loaded/,text);
  }
  const good=JSON.stringify({cpol:'1',cpha:'0',freq:'custom',custom:'2500',width:'16',order:'lsb',words:'2',delay:'1.5',cs:'1',mtx:'0xBEEF,0x1234',stx:'0xC0DE,0xA55A'});
  const r=loadSaved(good);
  assert.equal(r.note,'');assert.equal(r.cfg.width,'16');assert.equal(r.cfg.order,'lsb');
  const partial=loadSaved('{"mtx":"0x01","stx":"0x02","extra":"ignored"}');
  assert.equal(partial.note,'');assert.equal(partial.cfg.mtx,'0x01');assert.equal(partial.cfg.freq,BASE.freq);assert.equal('extra' in partial.cfg,false);
});

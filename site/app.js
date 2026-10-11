// Approach debrief front end. Loads data/<TAIL>.json (precomputed) or /api/debrief/<TAIL> (server mode).
let D=null, FLEET=null, vref=81, sel=null;
const $=id=>document.getElementById(id);
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmtD=t=>new Date(t*1000).toLocaleDateString('en-US',{month:'short',day:'numeric'});
const fmtT=t=>new Date(t*1000).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZoneName:'short'});
const fmtM=t=>new Date(t*1000).toLocaleDateString('en-US',{month:'long',year:'numeric'});
const vc=v=>'c-'+v.split(' ')[0];
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function weightFor(v){const a=D.meta.vref; if(!a.weights) return null;
 const [v0,v1]=a.vref,[w0,w1]=a.weights; return Math.round((w0+(v-v0)/(v1-v0)*(w1-w0))/50)*50}
function currentOwner(){return D.meta.owners.length?D.meta.owners[D.meta.owners.length-1]:null}
function set(){const all=$('own').checked, o=currentOwner();
 return D.landings.filter(l=>all||!o||l.owner===o).slice().reverse()}

// ---------------------------------------------------------------- loading
async function getJSON(url){const r=await fetch(url,{cache:'no-cache'}); if(!r.ok) throw new Error(r.status); return r.json()}
async function load(tail){
 tail=tail.trim().toUpperCase(); if(!tail) return;
 $('tail').value=tail; $('go').disabled=true;
 status(`<h2>Loading ${esc(tail)}…</h2><p>Pulling ADS-B history, weather and runways. A first lookup on the server can take a few minutes.</p>`);
 let data=null;
 try{data=await getJSON(`data/${encodeURIComponent(tail)}.json`)}catch(e){
  try{data=await getJSON(`api/debrief/${encodeURIComponent(tail)}`)}catch(e2){}
 }
 $('go').disabled=false;
 if(!data){showEmpty(`<h2>${esc(tail)} isn't tracked here yet</h2><p>This site scores the tail numbers listed in the repository's <code>tails.txt</code>, refreshed nightly. Add it there, or run the server version to look up any tail on demand.</p>`);return}
 D=data; FLEET=null; history.replaceState(null,'',`?tail=${encodeURIComponent(tail)}`);
 const v=D.meta.vref; vref=v.default; Object.assign($('vref'),{min:v.vref[0],max:v.vref[1],value:vref});
 $('ownwrap').hidden=D.meta.owners.length<2; $('own').checked=false;
 const L=set(); sel=L.length?L[0].id:null;
 if(D.meta.type){try{FLEET=await getJSON(`data/fleet/${encodeURIComponent(D.meta.type)}.json`)}catch(e){FLEET=null}}
 if(!D.landings.length){showEmpty(`<h2>No landings found for ${esc(D.meta.tail)}</h2><p>${D.meta.days_with_data} days of ADS-B data between ${D.meta.from} and ${D.meta.to}, but no complete arrival at a paved runway.</p>`);return}
 status(''); $('report').hidden=false; $('ctl').hidden=false;
 renderUn(); renderMethod(); renderAll();
}
function status(h){$('status').innerHTML=h}
async function showEmpty(h){
 $('report').hidden=true; $('ctl').hidden=true;
 let chips='';
 try{const idx=await getJSON('data/index.json'); if(idx.length) chips=`<p>Tracked tails:</p><div class="tracked">${idx.map(e=>`<button class="chip" data-t="${esc(e.tail)}">${esc(e.tail)}${e.type?' · '+esc(e.type):''}</button>`).join('')}</div>`}catch(e){}
 status(h+chips);
 $('status').querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>load(b.dataset.t));
}

// ---------------------------------------------------------------- list + header
function renderList(){
 const L=set(), el=$('list'); el.innerHTML=''; let m='';
 const o=currentOwner();
 for(const l of L){const s=scoreLanding(l,vref); const mm=fmtM(l.t);
  if(mm!==m){m=mm;const h=document.createElement('div');h.className='mon';h.textContent=mm;el.appendChild(h)}
  const b=document.createElement('button');b.className='row';b.setAttribute('aria-current',l.id===sel);
  b.innerHTML=`<b>${esc(l.apt)} ${esc(l.rwy)}</b><span class="sc ${vc(s.verdict)}">${s.score}</span><span class="meta">${fmtD(l.t)}, ${l.align>=3?'straight-in':'pattern'}${o&&l.owner!==o?', prior owner':''}${l.lowcov?', partial':''}</span><span class="vd ${vc(s.verdict)}">${s.verdict}</span>`;
  b.onclick=()=>{sel=l.id;renderAll()};el.appendChild(b)}
 const sc=L.map(l=>scoreLanding(l,vref)); const st=sc.filter(s=>s.stable).length;
 $('title').firstChild.textContent=`${D.meta.tail} approach debrief`;
 $('sum').textContent=`${D.meta.desc||D.meta.type||'Aircraft'}. ${L.length} landings scored, ${st} stable at 500 ft, average score ${L.length?Math.round(sc.reduce((a,s)=>a+s.score,0)/L.length):'–'}.${D.unscored.length?` ${D.unscored.length} more arrivals lost coverage before touchdown.`:''}`;
}

// ---------------------------------------------------------------- charts
const NS='http://www.w3.org/2000/svg';
function svg(w,h){const s=document.createElementNS(NS,'svg');s.setAttribute('viewBox',`0 0 ${w} ${h}`);s.setAttribute('width','100%');s.style.display='block';return s}
function el(t,a,p){const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);p&&p.appendChild(e);return e}
function txt(p,x,y,s,a={}){const e=el('text',Object.assign({x,y},a),p);e.textContent=s;return e}
function profile(l){
 const W=900,H=330,m={l:54,r:18,t:16,b:40},X0=6,X1=-0.5,Y1=2200;
 const sx=x=>m.l+(X0-x)/(X0-X1)*(W-m.l-m.r), sy=y=>H-m.b-(Math.max(0,y)/Y1)*(H-m.t-m.b);
 const s=svg(W,H); s.setAttribute('role','img'); s.setAttribute('aria-label','Vertical profile of the approach against a 3 degree path');
 for(let y=0;y<=2000;y+=500){el('line',{x1:m.l,x2:W-m.r,y1:sy(y),y2:sy(y),stroke:css('--grid')},s);txt(s,m.l-8,sy(y)+4,y?y.toLocaleString():'0',{'text-anchor':'end'})}
 for(let x=6;x>=0;x--){el('line',{x1:sx(x),x2:sx(x),y1:m.t,y2:H-m.b,stroke:css('--grid')},s);txt(s,sx(x),H-m.b+18,x+' nm',{'text-anchor':'middle'})}
 txt(s,W/2,H-4,'track miles to threshold',{'text-anchor':'middle'});
 for(const g of [1000,500]){el('line',{x1:m.l,x2:W-m.r,y1:sy(g),y2:sy(g),stroke:css('--ink2'),'stroke-dasharray':'2 4'},s);txt(s,W-m.r-4,sy(g)-5,g.toLocaleString()+' ft gate',{'text-anchor':'end'})}
 el('line',{x1:sx(0),x2:sx(X0),y1:sy(50),y2:sy(50+X0*318.4),stroke:css('--mag'),'stroke-width':2.5},s);
 txt(s,sx(4.6),sy(50+4.6*318.4)-10,'3.0° path',{fill:css('--mag'),'text-anchor':'middle'});
 el('rect',{x:sx(0),y:sy(0)-3,width:sx(X1)-sx(0),height:6,fill:css('--ink')},s);
 const P=l.prof.filter(p=>p[0]<=X0&&p[0]>=X1);
 for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i];const turn=Math.abs(b[6])>12&&b[0]>0;
  el('line',{x1:sx(a[0]),y1:sy(a[1]),x2:sx(b[0]),y2:sy(b[1]),stroke:turn?css('--warn'):css('--path'),'stroke-width':3.5,'stroke-linecap':'round'},s)}
 for(const k of ['1000ft','500ft']){const g=l.gates[k];if(!g||g.dtg==null)continue;
  el('circle',{cx:sx(g.dtg),cy:sy(g.hat),r:5,fill:css('--panel'),stroke:css('--ink'),'stroke-width':2},s)}
 if(l.td&&l.td.ft!=null){el('circle',{cx:sx(-l.td.ft/6076),cy:sy(0),r:6,fill:css('--good')},s)}
 return s}
function plan(l){
 const W=440,H=360,s=svg(W,H); s.setAttribute('role','img'); s.setAttribute('aria-label','Top-down track relative to the runway');
 const C=2.6,XA=5.5,XB=-1.2, sx=c=>W/2+c/C*(W/2-14), sy=x=>14+(XA-x)/(XA-XB)*(H-28);
 for(let x=0;x<=5;x++){el('line',{x1:14,x2:W-14,y1:sy(x),y2:sy(x),stroke:css('--grid')},s);txt(s,18,sy(x)-4,x?x+' nm':'threshold')}
 el('line',{x1:sx(0),x2:sx(0),y1:sy(XA),y2:sy(0),stroke:css('--mag'),'stroke-dasharray':'6 5','stroke-width':1.5},s);
 el('rect',{x:sx(0)-4,y:sy(0),width:8,height:sy(-l.rlen/6076)-sy(0),fill:css('--ink')},s);
 const P=l.plan.filter(p=>p[0]<=XA&&p[0]>=XB&&Math.abs(p[1])<=C);
 el('path',{d:P.map((p,i)=>(i?'L':'M')+sx(p[1]).toFixed(1)+' '+sy(p[0]).toFixed(1)).join(' '),fill:'none',stroke:css('--path'),'stroke-width':3,'stroke-linejoin':'round','stroke-linecap':'round'},s);
 for(const k of ['1000ft','500ft']){const g=l.gates[k];if(g&&g.x<=XA&&Math.abs(g.c/6076)<C)el('circle',{cx:sx(g.c/6076),cy:sy(g.x),r:5,fill:css('--panel'),stroke:css('--ink'),'stroke-width':2},s)}
 return s}
function speed(l,sc){
 const P=l.prof.filter(p=>p[0]<=6&&p[0]>=0);
 const W=440,H=360,m={l:44,r:12,t:14,b:36},X0=6,X1=0,Y0=vref-15,Y1=Math.max(vref+80,...P.map(p=>p[2]))+5;
 const s=svg(W,H); s.setAttribute('role','img'); s.setAttribute('aria-label','Estimated indicated airspeed against distance');
 const sx=x=>m.l+(X0-x)/(X0-X1)*(W-m.l-m.r), sy=y=>H-m.b-(y-Y0)/(Y1-Y0)*(H-m.t-m.b);
 el('rect',{x:m.l,width:W-m.l-m.r,y:sy(sc.va+10),height:sy(vref-5)-sy(sc.va+10),fill:css('--good'),opacity:.13},s);
 el('rect',{x:m.l,width:W-m.l-m.r,y:sy(sc.va+20),height:sy(sc.va+10)-sy(sc.va+20),fill:css('--warn'),opacity:.13},s);
 for(let y=Math.ceil(Y0/20)*20;y<=Y1;y+=20){el('line',{x1:m.l,x2:W-m.r,y1:sy(y),y2:sy(y),stroke:css('--grid')},s);txt(s,m.l-6,sy(y)+4,y,{'text-anchor':'end'})}
 el('line',{x1:m.l,x2:W-m.r,y1:sy(vref),y2:sy(vref),stroke:css('--mag'),'stroke-width':1.5},s);txt(s,m.l+6,sy(vref)-5,'Vref '+vref,{fill:css('--mag')});
 for(let x=6;x>=0;x-=2)txt(s,sx(x),H-m.b+18,x+' nm',{'text-anchor':'middle'});
 el('path',{d:P.map((p,i)=>(i?'L':'M')+sx(p[0]).toFixed(1)+' '+sy(p[2]).toFixed(1)).join(' '),fill:'none',stroke:css('--path'),'stroke-width':3,'stroke-linejoin':'round'},s);
 for(const k of ['1000ft','500ft']){const g=l.gates[k];if(g&&g.dtg!=null&&g.dtg<=X0)el('circle',{cx:sx(g.dtg),cy:sy(g.ias),r:5,fill:css('--panel'),stroke:css('--ink'),'stroke-width':2},s)}
 return s}

// ---------------------------------------------------------------- landing card
function cell(v,cls=''){return `<td class="${cls}">${v}</td>`}
function renderCard(){
 const l=D.landings.find(x=>x.id===sel); if(!l) return; const s=scoreLanding(l,vref); const c=$('card');
 const w=l.wind; const wtxt=w.spd?`${String(Math.round(w.dir)).padStart(3,'0')}° at ${w.spd}${w.gust?' G'+w.gust:''} kt`:'calm';
 c.innerHTML=`<div class="ttl"><div><h2>${esc(l.apt)} runway ${esc(l.rwy)}</h2><div class="sub">${esc(l.apt_name||'')}. ${fmtD(l.t)}, ${fmtT(l.t)}. ${l.align>=3?`Straight-in, established ${l.align} nm out`:`Visual pattern, rolled out on final ${l.align} nm out`}. Wind ${wtxt}, ${Math.round(w.hw)>=0?Math.round(w.hw)+' kt head':Math.round(-w.hw)+' kt tail'}, ${Math.round(Math.abs(w.xw))} kt cross. Runway ${l.rlen.toLocaleString()} ft.</div></div>
 <div class="big"><div class="n ${vc(s.verdict)}">${s.score}</div><div class="v ${vc(s.verdict)}">${s.verdict}</div></div></div>
 <div class="fig"><h3>Vertical profile</h3><div id="pf"></div><p class="cap">Blue is the flown path, amber where the airplane was still turning onto final. Circles mark the 1,000 and 500 ft gates; the green dot is the estimated touchdown.</p></div>
 <div class="two"><div class="fig"><h3>From above</h3><div id="pl"></div><p class="cap">Runway points up. Dashed magenta is the extended centerline.</p></div>
 <div class="fig"><h3>Estimated airspeed</h3><div id="sp"></div><p class="cap">Green band: Vref−5 to target+10. Amber: up to target+20, the stable limit. Target here is ${s.va} KIAS.</p></div></div>
 <div class="tbl"><table><thead><tr><th>Gate</th><th>Height</th><th>Path</th><th>Est. IAS</th><th>vs Vref</th><th>Sink fpm</th><th>Track off</th><th>Off centerline</th></tr></thead><tbody id="gt"></tbody></table></div>
 <div class="two"><div class="sec" style="margin-top:22px"><h3>Findings</h3><ul class="fd">${s.findings.map(f=>`<li class="${f.k}">${f.t}</li>`).join('')}</ul></div>
 <div class="sec" style="margin-top:22px"><h3>Conditions</h3><ul class="fd cx">${(s.context.length?s.context:['No extenuating conditions found.']).map(t=>`<li>${t}</li>`).join('')}</ul>
 <div class="metar">${esc(l.metar||'')}</div></div></div>`;
 $('pf').appendChild(profile(l));$('pl').appendChild(plan(l));$('sp').appendChild(speed(l,s));
 const rows=[['5 nm','5nm'],['3 nm','3nm'],['1,000 ft','1000ft'],['1 nm','1nm'],['500 ft','500ft']];
 let h='';
 for(const [n,k] of rows){const g=l.gates[k]; if(!g){h+=`<tr>${cell(n)}<td colspan="7" style="text-align:left;color:var(--ink2)">not on final this far out</td></tr>`;continue}
  const turning=Math.abs(g.trkdev)>12; const pd=g.ang!=null&&!turning?(g.ang-3):null; const dv=g.ias-vref;
  h+=`<tr>${cell(n)}${cell(Math.round(g.hat).toLocaleString()+' ft')}${cell(pd==null?(turning?'turning':''):(pd>=0?'+':'')+pd.toFixed(1)+'°',pd!=null&&Math.abs(pd)>1?'o':pd!=null&&Math.abs(pd)>.5?'w':'')}${cell(Math.round(g.ias))}${cell((dv>=0?'+':'')+Math.round(dv),k==='500ft'&&g.ias>s.va+20?'o':k==='500ft'&&g.ias>s.va+10?'w':'')}${cell(Math.round(-(g.vs||0)),-(g.vs||0)>1000?'o':'')}${cell(Math.round(Math.abs(g.trkdev))+'°',k==='500ft'&&Math.abs(g.trkdev)>10?'o':turning?'w':'')}${cell(Math.round(Math.abs(g.c)).toLocaleString()+' ft')}</tr>`}
 const t=l.thr; if(t) h+=`<tr>${cell('Threshold')}${cell(Math.round(t.hat)+' ft',t.hat>75||t.hat<20?'w':'')}${cell('')}${cell(Math.round(t.ias))}${cell((t.ias-vref>=0?'+':'')+Math.round(t.ias-vref),t.ias>s.va+12?'w':'')}${cell(Math.round(-(t.vs||0)))}${cell('')}${cell(Math.round(Math.abs(t.c))+' ft')}</tr>`;
 h+= l.td&&l.td.ft!=null?`<tr>${cell('Touchdown')}<td colspan="7" style="text-align:left">about ${l.td.ft.toLocaleString()} ft past the threshold${l.td.float!=null?` after ${l.td.float} s of flare`:''}${l.stop&&l.stop.remain?`. Down to taxi speed by ${l.stop.ft.toLocaleString()} ft, ${l.stop.remain.toLocaleString()} ft of runway left`:''}.</td></tr>`:`<tr>${cell('Touchdown')}<td colspan="7" style="text-align:left;color:var(--ink2)">coverage lost before touchdown</td></tr>`;
 $('gt').innerHTML=h;
}

// ---------------------------------------------------------------- insights, fleet, tables
function goTo(id){sel=id;renderAll();$('card').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}
function renderIns(){
 const I=insights(set(),vref,{dragTip:D.meta.vref.drag_tip}), e=$('ins'); e.innerHTML='';
 for(const o of I.out){const d=document.createElement('div');d.className='in';
  d.innerHTML=`<h3>${o.h}</h3><p>${o.b}</p><p class="r">${o.r}</p><div class="chips"></div>`;
  const ch=d.querySelector('.chips');
  for(const id of o.ids){const l=D.landings.find(x=>x.id===id); if(!l) continue; const b=document.createElement('button');b.className='chip';b.textContent=`${l.apt} ${l.rwy}, ${fmtD(l.t)}`;b.onclick=()=>goTo(id);ch.appendChild(b)}
  e.appendChild(d)}
}
function renderFleet(){
 const sec=$('fleetsec'); if(!FLEET||!FLEET.landings.length){sec.hidden=true;return}
 const F=fleetStats(FLEET,set(),vref); if(F.aircraft<5){sec.hidden=true;return}
 sec.hidden=false;
 const ord=n=>{const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0])};
 $('fleet').innerHTML=`<div class="fleet"><div><div class="pct">${ord(F.pctScore)}<small> percentile</small></div>
  <p>Your average score is <b>${Math.round(F.me.avg)}</b> against a fleet average of <b>${Math.round(F.fleetAvg)}</b>, across ${F.aircraft} other ${esc(FLEET.model)}s with 3 or more landings in the last ${FLEET.days} days (${F.landings} landings).</p>
  <p>Stable at 500 ft: you ${Math.round(100*F.me.stab)}%, fleet ${Math.round(100*F.fleetStable)}% (${ord(F.pctStable)} percentile).</p></div>
  <div id="fleetplot"></div></div>
  <p class="note">The fleet is a random sample of US-registered ${esc(FLEET.model)}s, anonymized: no tail numbers, dates or airports are stored. Everyone is scored at the same Vref you set above, so weight differences are not accounted for. The sample includes charter and fractional operators, who fly more straight-in IFR arrivals.</p>`;
 const W=760,H=150,m={l:20,r:20},lo=Math.min(40,...F.dist,F.me.avg)-2,hi=100;
 const sx=v=>m.l+(v-lo)/(hi-lo)*(W-m.l-m.r);
 const s=svg(W,H); s.setAttribute('role','img'); s.setAttribute('aria-label',`Average score for each aircraft in the fleet sample, with yours marked at ${Math.round(F.me.avg)}`);
 el('line',{x1:m.l,x2:W-m.r,y1:96,y2:96,stroke:css('--rule')},s);
 for(let v=Math.ceil(lo/10)*10;v<=100;v+=10){el('line',{x1:sx(v),x2:sx(v),y1:92,y2:100,stroke:css('--ink2')},s);txt(s,sx(v),118,v,{'text-anchor':'middle'})}
 txt(s,W/2,142,'average approach score per aircraft',{'text-anchor':'middle'});
 const bins={}; for(const v of F.dist){const b=Math.round(v);const k=bins[b]=(bins[b]||0)+1;el('circle',{cx:sx(v),cy:96-k*9,r:4,fill:css('--ink2'),opacity:.7},s)}
 el('line',{x1:sx(F.me.avg),x2:sx(F.me.avg),y1:14,y2:100,stroke:css('--mag'),'stroke-width':2.5},s);
 txt(s,sx(F.me.avg),10,`${D.meta.tail} ${Math.round(F.me.avg)}`,{'text-anchor':sx(F.me.avg)>W-80?'end':'middle',fill:css('--mag'),'font-weight':600});
 $('fleetplot').appendChild(s);
}
function renderUn(){
 $('unsec').hidden=!D.unscored.length;
 $('un').innerHTML='<thead><tr><th>Date</th><th>Airport</th><th>What happened</th></tr></thead><tbody>'+D.unscored.map(u=>`<tr><td>${fmtD(u.t)}</td><td>${esc(u.apt)}, ${esc(u.name)}</td><td>${esc(u.why)}</td></tr>`).join('')+'</tbody>';
}
function renderMethod(){
 const m=D.meta, v=m.vref, fixes=m.runway_fixes||[];
 $('method').innerHTML=`
 <p>Source: ${m.source==='adsbx'?'ADS-B Exchange history':esc(m.source)} for ICAO ${esc(m.hex.toUpperCase())}, ${m.from} to ${m.to} (${m.days_with_data} days with data), generated ${new Date(m.generated*1000).toLocaleString()}. Winds: the nearest METAR at the surface and model winds aloft (Open-Meteo) at each gate. Runways: OurAirports${fixes.length?`, with lateral corrections where this aircraft's crossings showed the database threshold is off: ${fixes.map(f=>`${esc(f.apt)} ${esc(f.rwy)} (${Math.abs(f.ft)} ft)`).join(', ')}`:''}.</p>
 <p>Airspeed is estimated: groundspeed minus the wind vector, converted to indicated with density. Expect about ±5 kt. ADS-B carries no flap, gear, power or true IAS data. Heights come from GPS altitude in 25 ft steps, referenced to the airplane's own touchdown height on each runway.</p>
 <p>Stable at 500 ft means all four: track within 10° and 300 ft of centerline, path within 1.0° of 3°, sink no more than 1,000 fpm, speed from Vref−5 to target+20. Target is Vref plus half the gust factor. Unstable landings are capped at 69. Points: 500 ft gate 40, 1,000 ft gate 15, final setup 5, threshold 15, touchdown and float 20, rollout margin 5.</p>
 <p>${v.known?`Default Vref range for the ${esc(m.type)} is ${v.vref[0]} to ${v.vref[1]} KIAS${v.weights?` (${v.weights[0].toLocaleString()} to ${v.weights[1].toLocaleString()} lb)`:''}, approximate.`:'No Vref table for this type yet, so the slider covers a wide range.'} Set the slider to your own AFM Vref for your usual landing weight and every score updates.</p>`;
}
function renderAll(){
 $('vo').textContent=vref; const wt=weightFor(vref); $('wt').textContent=wt?`(~${wt.toLocaleString()} lb)`:'';
 renderList();renderCard();renderIns();renderFleet();
}

$('vref').oninput=e=>{vref=+e.target.value;renderAll()};
$('own').onchange=()=>{const L=set();if(!L.find(l=>l.id===sel))sel=L[0]&&L[0].id;renderAll()};
$('search').onsubmit=e=>{e.preventDefault();load($('tail').value)};
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>D&&renderAll());
const q=new URLSearchParams(location.search).get('tail');
if(q) load(q); else showEmpty('<h2>Enter a tail number</h2><p>Every landing gets a stabilized-approach score at the 1,000 and 500 ft gates, with the wind and runway conditions that might explain a fast or high arrival.</p>');

// Score my landing: fleet leaderboard + per-aircraft debrief.
// Data: data/fleet.json, data/ac/<pid>.json (public), data/ac/<pid>.bin and data/names.bin (owner-only, AES-GCM).
// Server mode (Docker) also answers api/debrief/<tail> with full, non-anonymized data.
let FLEET=null, NAMES=null, KEY=null, D=null, vref=81, sel=null, sortBy='score', sortDir=-1, trendWin=90;
const $=id=>document.getElementById(id);
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const vc=v=>'c-'+v.split(' ')[0];
const ord=n=>{const s=['th','st','nd','rd'],v=n%100;return n+(s[(v-20)%10]||s[v]||s[0])};
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}},del(k){try{localStorage.removeItem(k)}catch(e){}}};
const dateOf=l=>l.t?new Date(l.t*1000):new Date(l.d+'T12:00:00Z');
const fmtD=l=>dateOf(l).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:l.t?undefined:'UTC'});
const fmtM=l=>dateOf(l).toLocaleDateString('en-US',{month:'long',year:'numeric',timeZone:l.t?undefined:'UTC'});
const fmtT=l=>l.t?new Date(l.t*1000).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZoneName:'short'}):null;
const nameOf=pid=>NAMES&&NAMES[pid]?NAMES[pid]:null;
async function getJSON(url){const r=await fetch(url,{cache:'no-cache'}); if(!r.ok) throw new Error(r.status); return r.json()}
async function getText(url){const r=await fetch(url,{cache:'no-cache'}); if(!r.ok) throw new Error(r.status); return r.text()}

// ---------------------------------------------------------------- owner unlock (WebCrypto)
async function deriveKey(secret){
 const enc=new TextEncoder();
 const h=await crypto.subtle.importKey('raw',enc.encode(secret.trim()),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const raw=await crypto.subtle.sign('HMAC',h,enc.encode('enc'));
 return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['decrypt']);
}
async function unseal(text,key=KEY){
 const b=Uint8Array.from(atob(text.trim()),c=>c.charCodeAt(0));
 const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:b.slice(0,12)},key,b.slice(12));
 const s=new Blob([pt]).stream().pipeThrough(new DecompressionStream('gzip'));
 return new Response(s).json();
}
async function unlock(secret,quiet){
 try{
  const key=await deriveKey(secret);
  const ok=await unseal(await getText('data/keycheck.bin'),key);
  if(!ok||!ok.ok) throw new Error('bad');
  KEY=key; NAMES=await unseal(await getText('data/names.bin'));
  store.set('sml_secret',secret.trim()); lockUI(); return true;
 }catch(e){ if(!quiet) $('unlockmsg').textContent='That secret does not open this site.'; return false }
}
function lock(){KEY=null;NAMES=null;store.del('sml_secret');lockUI();route()}
function lockUI(){
 $('lockbtn').textContent=KEY?'Lock':'Owner unlock';
 $('q').placeholder=KEY?'sf50-… or N31SF':'sf50-…';
 if(KEY){$('unlock').hidden=true}
}

// ---------------------------------------------------------------- home: leaderboard
function vi(){return FLEET.vrefs.indexOf(vref)}
function ranked(){
 const i=vi();
 return FLEET.aircraft.filter(a=>a.n>=3&&a.s).sort((a,b)=>b.s[i]-a.s[i]);
}
function renderHome(){
 const i=vi(), R=ranked(), rank=new Map(R.map((a,k)=>[a.pid,k+1]));
 const m=FLEET.meta;
 $('sum').textContent=`${m.desc||m.type} fleet. ${FLEET.aircraft.filter(a=>a.n).length} aircraft with landings in the last 12 months, ${m.scored_landings_12mo.toLocaleString()} landings scored, from ${m.days} day${m.days===1?'':'s'} of open ADS-B data (${m.first_day} to ${m.last_day}).`;
 // distribution
 const vals=R.map(a=>a.s[i]); const W=900,H=150,mL=24,mR=24,lo=Math.min(40,...vals)-2,hi=100;
 const sx=v=>mL+(v-lo)/(hi-lo)*(W-mL-mR);
 const s=svg(W,H); s.setAttribute('role','img'); s.setAttribute('aria-label',`Average approach score for each of ${R.length} ranked aircraft`);
 el('line',{x1:mL,x2:W-mR,y1:100,y2:100,stroke:css('--rule')},s);
 for(let v=Math.ceil(lo/10)*10;v<=100;v+=10){el('line',{x1:sx(v),x2:sx(v),y1:96,y2:104,stroke:css('--ink2')},s);txt(s,sx(v),122,v,{'text-anchor':'middle'})}
 txt(s,W/2,145,'average approach score per aircraft',{'text-anchor':'middle'});
 const bins={};
 for(const a of R){const v=a.s[i],b=Math.round(v);const k=bins[b]=(bins[b]||0)+1;
  const c=el('circle',{cx:sx(v),cy:100-k*8,r:3.6,fill:css('--path'),opacity:.75},s);
  const t=document.createElementNS(NS,'title');t.textContent=`${nameOf(a.pid)||a.pid}: ${v}`;c.appendChild(t)}
 const med=vals.length?vals.slice().sort((a,b)=>a-b)[vals.length>>1]:null;
 if(med!=null){el('line',{x1:sx(med),x2:sx(med),y1:12,y2:104,stroke:css('--mag'),'stroke-width':2},s);txt(s,sx(med),9,`median ${med}`,{'text-anchor':'middle',fill:css('--mag'),'font-weight':600})}
 $('dist').innerHTML='';$('dist').appendChild(s); renderFleetTrend(); renderBestWorst(); renderTab();
 const st=R.map(a=>a.st[i]).filter(x=>x!=null);
 $('distnote').textContent=R.length?`${R.length} aircraft with 3 or more landings. The typical airplane is stable at 500 ft on ${Math.round(100*st.sort((a,b)=>a-b)[st.length>>1])}% of approaches.`:'';
 // table
 const rows=FLEET.aircraft.filter(a=>a.n>0).map(a=>({a,rank:rank.get(a.pid)||null,score:a.s?a.s[i]:null,stab:a.st?a.st[i]:null,trend:a.tr?a.tr[i]:null}));
 const key={score:r=>r.score??-1,stab:r=>r.stab??-1,n:r=>r.a.n,last:r=>r.a.last||'',pid:r=>nameOf(r.a.pid)||r.a.pid,pattern:r=>r.a.pattern??-1,trend:r=>r.trend??-99}[sortBy];
 if(sortBy==='score') rows.sort((x,y)=>((x.rank==null)-(y.rank==null)) || (sortDir<0?x.rank-y.rank:y.rank-x.rank) || y.a.n-x.a.n);
 else rows.sort((x,y)=>{const a=key(x),b=key(y);return (a<b?-1:a>b?1:0)*sortDir || (y.a.n-x.a.n)});
 const th=(k,l,cls='')=>`<th class="${cls}"><button class="sort" data-k="${k}" aria-sort="${sortBy===k?(sortDir<0?'descending':'ascending'):'none'}">${l}${sortBy===k?(sortDir<0?' ▾':' ▴'):''}</button></th>`;
 $('lb').innerHTML=`<thead><tr><th>Rank</th>${th('pid','Aircraft','l')}${th('n','Landings')}${th('score','Avg score')}${th('stab','Stable at 500 ft')}${th('trend','3-month trend')}${th('pattern','Pattern arrivals')}${th('last','Last landing')}</tr></thead><tbody>`+
  rows.map(r=>{const v=r.score==null?null:Math.round(r.score); const nm=nameOf(r.a.pid);
   return `<tr data-pid="${r.a.pid}" tabindex="0"><td>${r.rank??'–'}</td><td class="l"><span class="pid">${r.a.pid}</span>${nm?` <b class="tail">${esc(nm)}</b>`:''}</td><td>${r.a.n}</td><td class="${v==null?'':v>=80?'c-Good':v>=65?'c-Fair':'c-Needs'}">${v??''}</td><td>${r.stab==null?'':Math.round(100*r.stab)+'%'}</td><td>${trendCell(r.trend)}</td><td>${r.a.pattern==null?'':r.a.pattern+'%'}</td><td>${r.a.last||''}</td></tr>`}).join('')+'</tbody>';
 $('lb').querySelectorAll('button.sort').forEach(b=>b.onclick=()=>{const k=b.dataset.k; if(sortBy===k) sortDir=-sortDir; else {sortBy=k; sortDir=(k==='pid')?1:-1} renderHome()});
 $('lb').querySelectorAll('tr[data-pid]').forEach(tr=>{const go=()=>open(tr.dataset.pid); tr.onclick=go; tr.onkeydown=e=>{if(e.key==='Enter')go()}});
}

function bwList(title,cls,items,showAc){
 const li=items.map(e=>`<li><button type="button" class="bwrow" data-pid="${e.pid}" data-id="${e.id}"><span class="bwsc ${vc(e.verdict)}">${e.score}</span><span class="bwbody"><b>${showAc?`<span class="pid">${nameOf(e.pid)?esc(nameOf(e.pid)):e.pid}</span> `:''}${e.apt?esc(e.apt)+' '+esc(e.rwy):'Airport withheld'}</b><span class="meta">${esc(e.when||e.d)}${e.why?'. '+esc(e.why):''}</span></span></button></li>`).join('');
 return `<div class="bwcol"><h3 class="${cls}">${title}</h3>${items.length?`<ol>${li}</ol>`:'<p class="note">Not enough landings yet.</p>'}</div>`;
}
function wireBw(box){box.querySelectorAll('.bwrow').forEach(b=>b.onclick=()=>{
 if(D&&b.dataset.pid===D.pid){goTo(b.dataset.id);return}
 history.pushState(null,'',`?ac=${encodeURIComponent(b.dataset.pid)}&l=${encodeURIComponent(b.dataset.id)}`); route().then(()=>window.scrollTo(0,0))})}
let bwWin=30, homeTab='board', gaSort='g', gaDir=-1;
function setTab(t,push){homeTab=t;
 document.querySelectorAll('.tabs button').forEach(b=>b.setAttribute('aria-selected',b.dataset.tab===t));
 for(const k of ['board','ga','gust']) $('tab-'+k).hidden=k!==t;
 if(push){const u=new URL(location.href); if(t==='board') u.searchParams.delete('tab'); else u.searchParams.set('tab',t); history.replaceState(null,'',u)}
 renderTab()}
function renderTab(){if(homeTab==='ga') renderGa(); else if(homeTab==='gust') renderGust()}
const pct=x=>x==null?'–':(Math.round(x*10)/10)+'%';
function renderGa(){
 const G=FLEET.goarounds, m=FLEET.meta;
 if(!G||!G.days){$('ganote').textContent='Go-arounds are measured as each day of data is reprocessed. None are ready yet; check back in a few hours.';
  for(const id of ['gatiles','gabands','gawhy','galb','gacats']) $(id).innerHTML=''; return}
 const P=G.per[vi()];
 $('ganote').textContent=`Measured on ${G.days} of ${m.days} days so far${G.days<m.days?' (older days are being reprocessed)':''}, last 12 months. Practice instrument approaches and touch-and-goes are left out of the rates. Unstable means the 500 ft definition at the Vref above.`;
 const tile=(k,n,sub)=>`<div class="tile"><div class="k">${k}</div><div class="n">${n}</div><div class="s">${sub}</div></div>`;
 $('gatiles').innerHTML=
  tile('Go-around rate',pct(P.rate),`${P.ga.toLocaleString()} go-arounds in ${(P.ga+P.land).toLocaleString()} approaches`)+
  tile('Unstable at 500 ft that went around',pct(P.unstable_went),`${P.ga_unstable} went around, ${P.land_unstable.toLocaleString()} continued to land. Another ${P.ga_before_500} climbed away before reaching 500 ft.`)+
  tile('Average score of the approach',P.avg_ga??'–',`when it ended in a go-around. Unstable approaches that landed averaged ${P.avg_pushed??'–'}; stable ones ${P.avg_stable??'–'}.`)+
  tile('Aircraft that went around',`${G.with_ga} of ${G.aircraft}`,'at least once on measured days');
 // where the climb began
 {const W=760,row=34,mL=150,mR=60,H=G.bands.length*row+8,max=Math.max(1,...G.bands);
  const s=svg(W,H); s.setAttribute('role','img'); s.setAttribute('aria-label','Go-arounds by height where the climb began');
  G.band_names.forEach((nm,k)=>{const y=k*row+6,w=(W-mL-mR)*G.bands[k]/max;
   txt(s,mL-10,y+row/2,nm,{'text-anchor':'end','dominant-baseline':'middle'});
   const r=el('rect',{x:mL,y:y+6,width:Math.max(w,1),height:row-14,rx:3,fill:css('--path')},s);
   const t=document.createElementNS(NS,'title');t.textContent=`${nm}: ${G.bands[k]}`;r.appendChild(t);
   txt(s,mL+w+8,y+row/2,G.bands[k],{'dominant-baseline':'middle',fill:css('--ink')})});
  $('gabands').innerHTML='';$('gabands').appendChild(s)}
 // what was wrong at 500 ft
 {const names=['Not lined up','Off the 3° path','Sink over 1,000 fpm','Speed out of range'],W=760,row=56,mL=150,mR=60,H=names.length*row+8;
  const s=svg(W,H); s.setAttribute('role','img'); s.setAttribute('aria-label','Failed checks at 500 ft, went around versus continued to land');
  const ser=[['Went around',P.why_ga,css('--path')],['Continued to land',P.why_pushed,css('--mag')]];
  names.forEach((nm,k)=>{const y=k*row+4; txt(s,mL-10,y+row/2-2,nm,{'text-anchor':'end','dominant-baseline':'middle'});
   ser.forEach(([lab,v,c],j)=>{const val=v[k]; if(val==null) return; const w=(W-mL-mR)*val/100, yy=y+6+j*22;
    const r=el('rect',{x:mL,y:yy,width:Math.max(w,1),height:18,rx:3,fill:c},s);
    const t=document.createElementNS(NS,'title');t.textContent=`${nm}, ${lab.toLowerCase()}: ${val}%`;r.appendChild(t);
    txt(s,mL+w+8,yy+9,val+'%',{'dominant-baseline':'middle',fill:css('--ink')})})});
  $('gawhy').innerHTML=`<div class="legend"><span><i style="background:${css('--path')}"></i>Went around (${P.ga_unstable})</span><span><i style="background:${css('--mag')}"></i>Continued to land (${P.land_unstable.toLocaleString()})</span></div>`;
  $('gawhy').appendChild(s)}
 // who goes around
 const i=vi();
 const rows=FLEET.aircraft.filter(a=>a.a>=5).map(a=>{const u=a.gu[i]+a.lu[i];return {a,g:a.g,n:a.a,rate:100*a.g/a.a,u,went:u?100*a.gu[i]/u:null}});
 const key={pid:r=>nameOf(r.a.pid)||r.a.pid,n:r=>r.n,g:r=>r.g,rate:r=>r.rate,u:r=>r.u,went:r=>r.went??-1}[gaSort];
 rows.sort((x,y)=>{const a=key(x),b=key(y);return (a<b?-1:a>b?1:0)*gaDir||(y.n-x.n)});
 const th=(k,l,cls='')=>`<th class="${cls}"><button class="sort" data-k="${k}" aria-sort="${gaSort===k?(gaDir<0?'descending':'ascending'):'none'}">${l}${gaSort===k?(gaDir<0?' ▾':' ▴'):''}</button></th>`;
 $('galb').innerHTML=`<thead><tr>${th('pid','Aircraft','l')}${th('n','Approaches')}${th('g','Go-arounds')}${th('rate','Rate')}${th('u','Unstable at 500 ft')}${th('went','Went around when unstable')}</tr></thead><tbody>`+
  rows.map(r=>{const nm=nameOf(r.a.pid);return `<tr data-pid="${r.a.pid}" tabindex="0"><td class="l"><span class="pid">${r.a.pid}</span>${nm?` <b class="tail">${esc(nm)}</b>`:''}</td><td>${r.n}</td><td>${r.g}</td><td>${pct(r.rate)}</td><td>${r.u}</td><td>${r.went==null?'<span class="dim">none unstable</span>':pct(r.went)}</td></tr>`}).join('')+'</tbody>';
 $('galb').querySelectorAll('button.sort').forEach(b=>b.onclick=()=>{const k=b.dataset.k; if(gaSort===k) gaDir=-gaDir; else {gaSort=k; gaDir=k==='pid'?1:-1} renderGa()});
 $('galb').querySelectorAll('tr[data-pid]').forEach(tr=>{const go=()=>open(tr.dataset.pid); tr.onclick=go; tr.onkeydown=e=>{if(e.key==='Enter')go()}});
 const C=G.cats, c=k=>(C[k]||0).toLocaleString();
 $('gacats').innerHTML=`<p>ADS-B shows a descent toward a runway and a climb away without touching down. It can't show intent, so each one is sorted by where it happened and the weather:</p>
 <ul class="fd">
 <li><b>Go-around</b> (${c('goaround')}): climbed away before the threshold, in weather good enough to land, and not at a typical decision height on a straight-in. Counted.</li>
 <li><b>Over the runway</b> (${c('runway')}): the climb began past the threshold, a late go-around or a low pass. Counted.</li>
 <li><b>Missed approach, low weather</b> (${c('weather')}): ceiling under 1,000 ft or visibility under 3 miles. Counted.</li>
 <li><b>Likely practice approach</b> (${c('practice')}): a straight-in in good weather that climbed away between 150 and 500 ft, where a decision height or MDA usually sits. Left out of the rates, since most are planned missed approaches.</li>
 <li><b>Touch-and-go</b> (${c('touch')}): bottomed out on the runway; the ground flag was missed. Left out.</li></ul>`;
}
function renderGust(){
 const G=FLEET.gusts; if(!G){$('gusthead').textContent='No data yet.';return}
 const v=vref;
 $('gusthead').innerHTML=G.slopeThr==null?'Not enough gusty landings yet.':`<b>Partly.</b> For every knot the gust rule calls for (half the gust factor), pilots carry about ${G.slopeThr} kt more over the threshold and ${G.slope500} kt more at 500 ft.`;
 const W=860,row=64,mL=170,mR=24,mT=10,H=G.bins.length*row+mT+40,lo=-10,hi=35;
 const sx=k=>mL+(k-lo)/(hi-lo)*(W-mL-mR);
 const s=svg(W,H); s.setAttribute('role','img'); s.setAttribute('aria-label','Estimated speed over Vref at 500 ft and at the threshold, by gust factor');
 for(let k=lo;k<=hi;k+=5){el('line',{x1:sx(k),x2:sx(k),y1:mT,y2:H-34,stroke:k===0?css('--ink2'):css('--grid')},s);txt(s,sx(k),H-16,(k>0?'+':'')+k,{'text-anchor':'middle'})}
 txt(s,(mL+W-mR)/2,H-1,`knots over Vref ${v} (estimated)`,{'text-anchor':'middle'});
 G.bins.forEach((b,j)=>{const y=mT+j*row; txt(s,mL-12,y+row/2-8,b.label,{'text-anchor':'end','dominant-baseline':'middle',fill:css('--ink')});
  txt(s,mL-12,y+row/2+10,`${b.n.toLocaleString()} landings`,{'text-anchor':'end','dominant-baseline':'middle'});
  const tip=(e,t)=>{const x=document.createElementNS(NS,'title');x.textContent=t;e.appendChild(x)};
  // target band: Vref to Vref + gust add, the rule's target
  const tg=el('line',{x1:sx(b.book),x2:sx(b.book),y1:y+8,y2:y+row-8,stroke:css('--good'),'stroke-width':3},s); tip(tg,`Gust rule target: Vref+${b.book}`);
  const ya=y+row/2-9, yb=y+row/2+9;
  const [a0,a1,a2]=b.ias500.map(x=>x-v), [t0,t1,t2]=b.iasThr.map(x=>x-v);
  el('line',{x1:sx(a0),x2:sx(a2),y1:ya,y2:ya,stroke:css('--path'),'stroke-width':2,opacity:.55},s);
  tip(el('circle',{cx:sx(a1),cy:ya,r:6,fill:css('--path'),stroke:css('--paper'),'stroke-width':2},s),`500 ft: median Vref${a1>=0?'+':''}${a1} (middle half ${a0} to ${a2})`);
  el('line',{x1:sx(t0),x2:sx(t2),y1:yb,y2:yb,stroke:css('--mag'),'stroke-width':2,opacity:.55},s);
  tip(el('rect',{x:sx(t1)-6,y:yb-6,width:12,height:12,rx:2,fill:css('--mag'),stroke:css('--paper'),'stroke-width':2},s),`Threshold: median Vref${t1>=0?'+':''}${t1} (middle half ${t0} to ${t2})`);
 });
 $('gustplot').innerHTML=`<div class="legend"><span><i style="background:${css('--path')};border-radius:50%"></i>At 500 ft</span><span><i style="background:${css('--mag')}"></i>Over the threshold</span><span><i style="background:${css('--good')};width:4px"></i>Gust rule target (Vref + half the gust factor)</span><span>Lines span the middle half of landings</span></div>`;
 $('gustplot').appendChild(s);
 const fl=G.flips[vi()];
 $('gustnote').textContent=`${G.gusty.toLocaleString()} of ${G.total.toLocaleString()} landings in the last 12 months had gusts in the METAR. The score widens the speed band by half the gust factor, up to 10 kt; at Vref ${v} that allowance kept ${fl} approaches from being marked unstable on speed. Speeds are estimated from groundspeed and the wind, and everyone is held to the same Vref, so a heavy airplane flying its own Vref reads a few knots fast. Compare the spacing between rows rather than the absolute numbers.`;
}
function renderBestWorst(){
 const B=FLEET.bestworst, box=$('bw'); if(!B){box.innerHTML='';$('bwwin').innerHTML='';return}
 // older fleet.json had a single 90-day set
 const W=B.windows||[{days:B.days,best:B.best,worst:B.worst}];
 if(!W.find(w=>w.days===bwWin)) bwWin=W[0].days;
 $('bwwin').innerHTML=W.map(w=>`<button type="button" data-d="${w.days}" aria-pressed="${w.days===bwWin}">Last ${w.days} days</button>`).join('');
 $('bwwin').querySelectorAll('button').forEach(b=>b.onclick=()=>{bwWin=+b.dataset.d;renderBestWorst()});
 const S=W.find(w=>w.days===bwWin), i=vi();
 $('bwnote').textContent=`Across the fleet in the last ${S.days} days, at the Vref above, no more than 2 per airplane. A best landing needs a scored touchdown. Most of the worst are arrivals still turning at 500 ft: low base legs and circling approaches.`;
 box.innerHTML=bwList('Best','c-Good',S.best[i],true)+bwList('Worst','c-Needs',S.worst[i],true);
 wireBw(box);
}
function trendCell(x){
 if(x==null) return '<span class="dim">not enough</span>';
 if(Math.abs(x)<1.5) return `<span class="dim">steady</span>`;
 return x>0?`<span class="c-Good">▲ +${x.toFixed(1)}/mo</span>`:`<span class="c-Needs">▼ ${x.toFixed(1)}/mo</span>`;
}
function renderFleetTrend(){
 const box=$('fleettrend'); box.innerHTML=''; const W=FLEET.weekly; if(!W||W.week.length<3) return;
 const i=vi(), xs=W.week, ys=W.med.map(m=>m[i]);
 const Wd=900,H=200,m={l:44,r:16,t:16,b:34}, x0=xs[0], x1=xs[xs.length-1]+6;
 const lo=Math.max(0,Math.floor((Math.min(...ys)-8)/10)*10), hi=Math.min(100,Math.ceil((Math.max(...ys)+8)/10)*10);
 const sx=d=>m.l+(d-x0)/(x1-x0||1)*(Wd-m.l-m.r), sy=v=>H-m.b-(v-lo)/(hi-lo)*(H-m.t-m.b);
 const s=svg(Wd,H); s.setAttribute('role','img'); s.setAttribute('aria-label','Fleet median approach score by week');
 for(let v=lo;v<=hi;v+=10){el('line',{x1:m.l,x2:Wd-m.r,y1:sy(v),y2:sy(v),stroke:css('--grid')},s);txt(s,m.l-6,sy(v)+4,v,{'text-anchor':'end'})}
 const step=Math.max(1,Math.ceil(xs.length/8));
 xs.forEach((d,k)=>{if(k%step===0) txt(s,sx(d),H-m.b+18,new Date(d*864e5).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}),{'text-anchor':'middle'})});
 el('path',{d:xs.map((d,k)=>(k?'L':'M')+sx(d+3).toFixed(1)+' '+sy(ys[k]).toFixed(1)).join(' '),fill:'none',stroke:css('--mag'),'stroke-width':2.5,'stroke-linejoin':'round'},s);
 xs.forEach((d,k)=>{const c=el('circle',{cx:sx(d+3),cy:sy(ys[k]),r:3.5,fill:css('--mag')},s);const t=document.createElementNS(NS,'title');t.textContent=`Week of ${new Date(d*864e5).toISOString().slice(0,10)}: median ${ys[k]} (${W.n[k]} landings)`;c.appendChild(t)});
 const T=trendOf(xs.map((d,k)=>({day:d,score:ys[k]})),3,14);
 const h=document.createElement('p'); h.className='trendhead';
 h.innerHTML=`<b class="${T.slope==null?'':T.slope>=1.5?'c-Good':T.slope<=-1.5?'c-Needs':''}">Fleet: ${T.slope==null?'too early to call':T.label.toLowerCase()}</b>${T.slope==null?'':`, ${T.slope>0?'+':''}${T.slope} points per month in the weekly median`}.`;
 box.appendChild(h); box.appendChild(s);
}

// ---------------------------------------------------------------- detail: one aircraft
function weightFor(v){const a=FLEET.meta.vref; if(!a.weights) return null;
 const [v0,v1]=a.vref,[w0,w1]=a.weights; return Math.round((w0+(v-v0)/(v1-v0)*(w1-w0))/50)*50}
function set(){const all=$('own').checked; return D.landings.filter(l=>all||l.og===D.current_owner).slice().reverse()}
function label(l){return l.apt?`${l.apt} ${l.rwy}`:'Airport withheld'}
async function loadAircraft(pid){
 const doc=await getJSON(`data/ac/${encodeURIComponent(pid)}.json`);
 if(KEY){try{const p=await unseal(await getText(`data/ac/${encodeURIComponent(pid)}.bin`)); mergePrivate(doc,p)}catch(e){}}
 return doc;
}
function mergePrivate(doc,p){
 doc.tail=p.tail;
 for(const l of doc.landings){const x=p.landings[l.id]; if(x) Object.assign(l,x)}
 const pg=p.go_arounds; if(pg&&!Array.isArray(pg)) for(const g of doc.go_arounds||[]){const x=pg[g.id]; if(x) Object.assign(g,x)}
 doc.unscored=p.unscored.slice().sort((a,b)=>a.t-b.t).map(u=>Object.assign({d:new Date(u.t*1000).toISOString().slice(0,10)},u));
}
function fromApi(r){ // server mode: full data for a tail
 const owners=r.meta.owners||[];
 return {pid:r.meta.tail,tail:r.meta.tail,type:r.meta.type,restricted:false,current_owner:Math.max(0,owners.length-1),
  landings:r.landings.map(l=>Object.assign({},l,{d:new Date(l.t*1000).toISOString().slice(0,10),og:Math.max(0,owners.indexOf(l.owner))})),
  unscored:r.unscored.map(u=>Object.assign({d:new Date(u.t*1000).toISOString().slice(0,10)},u)),go_arounds:r.go_arounds};
}
async function open(q){
 history.pushState(null,'',`?ac=${encodeURIComponent(q)}`); await route();
}
async function showAircraft(q){
 q=q.trim(); let pid=q.toLowerCase(), doc=null;
 if(NAMES&&!/^[a-z0-9]+-[0-9a-f]{8}$/.test(pid)){const hit=Object.entries(NAMES).find(([p,t])=>t&&t.toUpperCase()===q.toUpperCase()); if(hit) pid=hit[0]}
 status(`<h2>Loading ${esc(q)}…</h2>`);
 try{doc=await loadAircraft(pid)}catch(e){
  try{doc=fromApi(await getJSON(`api/debrief/${encodeURIComponent(q)}`))}catch(e2){}
 }
 if(!doc){status(`<h2>No aircraft called ${esc(q)}</h2><p>Search by the aircraft's ID (like <span class="pid">sf50-1a2b3c4d</span>)${KEY?' or its tail number':''}, or pick one from <a href="./">the list</a>.</p>`);return}
 D=doc; const L0=set(); sel=L0.length?L0[0].id:(D.landings.length?D.landings[D.landings.length-1].id:null);
 const want=new URLSearchParams(location.search).get('l'); if(want&&D.landings.find(x=>x.id===want)){ if(!L0.find(x=>x.id===want)) $('own').checked=true; sel=want }
 $('ownwrap').hidden=!(D.current_owner>0); $('own').checked=false;
 status(''); $('home').hidden=true; $('report').hidden=false;
 if(!D.landings.length){status(`<h2>${esc(D.tail||D.pid)}: no complete landings yet</h2>`);$('report').hidden=true;return}
 renderUn(); renderAll();
}
function renderList(){
 const L=set(), el=$('list'); el.innerHTML=''; let m='';
 for(const l of L){const s=scoreLanding(l,vref); const mm=fmtM(l);
  if(mm!==m){m=mm;const h=document.createElement('div');h.className='mon';h.textContent=mm;el.appendChild(h)}
  const b=document.createElement('button');b.className='row';b.setAttribute('aria-current',l.id===sel);
  b.innerHTML=`<b>${esc(label(l))}</b><span class="sc ${vc(s.verdict)}">${s.score}</span><span class="meta">${fmtD(l)}, ${l.align>=3?'straight-in':'pattern'}${l.og!==D.current_owner?', prior owner':''}${l.lowcov?', partial':''}</span><span class="vd ${vc(s.verdict)}">${s.verdict}</span>`;
  b.onclick=()=>{sel=l.id;renderAll()};el.appendChild(b)}
 const sc=L.map(l=>scoreLanding(l,vref)); const st=sc.filter(s=>s.stable).length;
 $('title').firstChild.textContent=D.tail&&KEY?`${D.tail}`:D.pid;
 $('sum').textContent=`${D.tail&&D.tail!==D.pid?D.pid+'. ':''}${D.restricted?'Owner requested limited tracking (LADD/PIA), so airports are withheld. ':''}${L.length} landing${L.length===1?'':'s'} scored, ${st} stable at 500 ft, average score ${L.length?Math.round(sc.reduce((a,s)=>a+s.score,0)/L.length):'–'}.`;
}

const NS='http://www.w3.org/2000/svg';
function svg(w,h){const s=document.createElementNS(NS,'svg');s.setAttribute('viewBox',`0 0 ${w} ${h}`);s.setAttribute('width','100%');s.style.display='block';return s}
function el(t,a,p){const e=document.createElementNS(NS,t);for(const k in a)e.setAttribute(k,a[k]);p&&p.appendChild(e);return e}
function txt(p,x,y,s,a={}){const e=el('text',Object.assign({x,y},a),p);e.textContent=s;return e}
// prof rows: [track nm to threshold, height ft, est IAS, cross-track ft, track error deg, along-track nm]
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
 const P=(l.prof||[]).filter(p=>p[0]<=X0&&p[0]>=X1);
 for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i];const turn=Math.abs(b[4])>12&&b[0]>0;
  el('line',{x1:sx(a[0]),y1:sy(a[1]),x2:sx(b[0]),y2:sy(b[1]),stroke:turn?css('--warn'):css('--path'),'stroke-width':3.5,'stroke-linecap':'round'},s)}
 for(const k of ['1000ft','500ft']){const g=l.gates[k];if(!g||g.dtg==null)continue;
  el('circle',{cx:sx(g.dtg),cy:sy(g.hat),r:5,fill:css('--panel'),stroke:css('--ink'),'stroke-width':2},s)}
 if(l.td&&l.td.ft!=null){el('circle',{cx:sx(-l.td.ft/6076),cy:sy(0),r:6,fill:css('--good')},s)}
 if(!P.length) txt(s,W/2,H/2,'Profile archived for landings over 400 days old',{'text-anchor':'middle'});
 return s}
function plan(l){
 const W=440,H=360,s=svg(W,H); s.setAttribute('role','img'); s.setAttribute('aria-label','Top-down track relative to the runway');
 const C=2.6,XA=5.5,XB=-1.2, sx=c=>W/2+c/C*(W/2-14), sy=x=>14+(XA-x)/(XA-XB)*(H-28);
 for(let x=0;x<=5;x++){el('line',{x1:14,x2:W-14,y1:sy(x),y2:sy(x),stroke:css('--grid')},s);txt(s,18,sy(x)-4,x?x+' nm':'threshold')}
 el('line',{x1:sx(0),x2:sx(0),y1:sy(XA),y2:sy(0),stroke:css('--mag'),'stroke-dasharray':'6 5','stroke-width':1.5},s);
 el('rect',{x:sx(0)-4,y:sy(0),width:8,height:sy(-(l.rlen||6000)/6076)-sy(0),fill:css('--ink')},s);
 const P=(l.prof||[]).map(p=>[p[5],p[3]/6076]).filter(p=>p[0]<=XA&&p[0]>=XB&&Math.abs(p[1])<=C);
 el('path',{d:P.map((p,i)=>(i?'L':'M')+sx(p[1]).toFixed(1)+' '+sy(p[0]).toFixed(1)).join(' '),fill:'none',stroke:css('--path'),'stroke-width':3,'stroke-linejoin':'round','stroke-linecap':'round'},s);
 for(const k of ['1000ft','500ft']){const g=l.gates[k];if(g&&g.x<=XA&&Math.abs(g.c/6076)<C)el('circle',{cx:sx(g.c/6076),cy:sy(g.x),r:5,fill:css('--panel'),stroke:css('--ink'),'stroke-width':2},s)}
 return s}
function speed(l,sc){
 const P=(l.prof||[]).filter(p=>p[0]<=6&&p[0]>=0);
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
function cell(v,cls=''){return `<td class="${cls}">${v}</td>`}
function renderCard(){
 const l=D.landings.find(x=>x.id===sel)||(D.go_arounds||[]).find(x=>x.id===sel); if(!l) return; const s=scoreLanding(l,vref); const c=$('card'); const GA=l.ga?gaInfo(l):null;
 const w=l.wind||{}; const wtxt=w.spd?`${String(Math.round(w.dir)).padStart(3,'0')}° at ${w.spd}${w.gust?' G'+w.gust:''} kt`:'calm';
 const where=l.apt?`${esc(l.apt)} runway ${esc(l.rwy)}`:'Airport withheld';
 const when=[fmtD(l),fmtT(l)].filter(Boolean).join(', ');
 c.innerHTML=`<div class="ttl"><div><h2>${where}</h2><div class="sub">${GA?`<b>${GA.cat}.</b> ${GA.where}. `:''}${l.apt_name?esc(l.apt_name)+'. ':''}${when}. ${l.align>=3?`Straight-in, established ${l.align} nm out`:`Visual pattern, rolled out on final ${l.align} nm out`}. Wind ${wtxt}, ${Math.round(w.hw||0)>=0?Math.round(w.hw||0)+' kt head':Math.round(-w.hw)+' kt tail'}, ${Math.round(Math.abs(w.xw||0))} kt cross. Runway ${l.apt?'':'about '}${(l.rlen||0).toLocaleString()} ft.</div></div>
 <div class="big"><div class="n ${vc(s.verdict)}">${s.score}</div><div class="v ${vc(s.verdict)}">${GA?'Go-around, ':''}${s.verdict}</div></div></div>
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
 h+= GA?`<tr>${cell('Climb began')}<td colspan="7" style="text-align:left">${GA.where}</td></tr>`:l.td&&l.td.ft!=null?`<tr>${cell('Touchdown')}<td colspan="7" style="text-align:left">about ${l.td.ft.toLocaleString()} ft past the threshold${l.td.float!=null?` after ${l.td.float} s of flare`:''}${l.stop&&l.stop.remain?`. Down to taxi speed by ${l.stop.ft.toLocaleString()} ft, ${l.stop.remain.toLocaleString()} ft of runway left`:''}.</td></tr>`:`<tr>${cell('Touchdown')}<td colspan="7" style="text-align:left;color:var(--ink2)">coverage lost before touchdown</td></tr>`;
 $('gt').innerHTML=h;
}
function gaInfo(g){const a=g.ga||{}; const cat=GA_CATS[gaCategory(g)];
 const pos=a.low_x==null?'':a.low_x<0?`${Math.round(-a.low_x*6076).toLocaleString()} ft past the threshold`:`${a.low_x.toFixed(1)} nm before the threshold`;
 return {cat, where:a.low_ft==null?'Height not measured':`Climb began at ${Math.max(0,a.low_ft).toLocaleString()} ft above the field${pos?', '+pos:''}`}}
function renderGaList(){
 const G=(D.go_arounds||[]).slice().reverse(); $('gasec').hidden=!G.length; if(!G.length) return;
 $('gat').innerHTML='<thead><tr><th>Date</th><th>Airport</th><th>Kind</th><th>Climb began</th><th>At 500 ft</th><th>Score</th></tr></thead><tbody>'+G.map(g=>{
  if(g.legacy) return `<tr><td>${esc(g.d)}</td><td>${g.apt?esc(g.apt)+' '+esc(g.rwy):'withheld'}</td><td class="dim">Not yet measured</td><td>${g.ga&&g.ga.low_ft!=null?Math.max(0,g.ga.low_ft)+' ft':''}</td><td></td><td></td></tr>`;
  const s=scoreLanding(g,vref), a=g.ga, at=g.gates&&g.gates['500ft']?(s.stable?'Stable':'Unstable'):'Not reached';
  return `<tr data-id="${g.id}" tabindex="0"><td>${esc(fmtD(g))}</td><td>${g.apt?esc(g.apt)+' '+esc(g.rwy):'withheld'}</td><td>${GA_CATS[gaCategory(g)]}</td><td>${a.low_x!=null&&a.low_x<0?'over the runway':Math.max(0,a.low_ft).toLocaleString()+' ft'}</td><td class="${at==='Unstable'?'c-Needs':''}">${at}</td><td class="${vc(s.verdict)}">${s.score}</td></tr>`}).join('')+'</tbody>';
 $('gat').querySelectorAll('tr[data-id]').forEach(tr=>{const go=()=>goTo(tr.dataset.id);tr.onclick=go;tr.onkeydown=e=>{if(e.key==='Enter')go()}});
}
function goTo(id){sel=id;renderAll();$('card').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})}
function renderIns(){
 const I=insights(set(),vref,{dragTip:FLEET&&FLEET.meta.vref.drag_tip}), e=$('ins'); e.innerHTML='';
 for(const o of I.out){const d=document.createElement('div');d.className='in';
  d.innerHTML=`<h3>${o.h}</h3><p>${o.b}</p><p class="r">${o.r}</p><div class="chips"></div>`;
  const ch=d.querySelector('.chips');
  for(const id of o.ids){const l=D.landings.find(x=>x.id===id); if(!l) continue; const b=document.createElement('button');b.className='chip';b.textContent=`${l.apt?l.apt+' '+l.rwy+', ':''}${fmtD(l)}`;b.onclick=()=>goTo(id);ch.appendChild(b)}
  e.appendChild(d)}
}
function renderFleet(){
 const sec=$('fleetsec'); if(!FLEET){sec.hidden=true;return}
 const L=D.landings.filter(l=>l.og===D.current_owner&&Date.now()-dateOf(l)<365*864e5);
 const F=fleetCompare(FLEET,L,vref,D.pid); if(!F||F.aircraft<5||!L.length){sec.hidden=true;return}
 sec.hidden=false;
 $('fleet').innerHTML=`<div class="fleet"><div><div class="pct">${ord(F.pctScore)}<small> percentile</small></div>
  <p>Average score <b>${Math.round(F.me.avg)}</b> against a fleet average of <b>${Math.round(F.fleetAvg)}</b>, across ${F.aircraft} other ${esc(FLEET.meta.type)}s with 3 or more landings in the last 12 months.</p>
  <p>Stable at 500 ft: ${Math.round(100*F.me.stab)}% versus ${Math.round(100*F.fleetStable)}% for the fleet (${ord(F.pctStable)} percentile).</p></div>
  <div id="fleetplot"></div></div>
  <p class="note">Current owner's landings in the last 12 months, everyone scored at the same Vref (set above), so weight differences are not accounted for.</p>`;
 const W=760,H=150,mL=20,mR=20,lo=Math.min(40,...F.dist,F.me.avg)-2,hi=100;
 const sx=v=>mL+(v-lo)/(hi-lo)*(W-mL-mR);
 const s=svg(W,H); s.setAttribute('role','img'); s.setAttribute('aria-label',`Average score for each aircraft in the fleet, with this one marked at ${Math.round(F.me.avg)}`);
 el('line',{x1:mL,x2:W-mR,y1:96,y2:96,stroke:css('--rule')},s);
 for(let v=Math.ceil(lo/10)*10;v<=100;v+=10){el('line',{x1:sx(v),x2:sx(v),y1:92,y2:100,stroke:css('--ink2')},s);txt(s,sx(v),118,v,{'text-anchor':'middle'})}
 txt(s,W/2,142,'average approach score per aircraft',{'text-anchor':'middle'});
 const bins={}; for(const v of F.dist){const b=Math.round(v);const k=bins[b]=(bins[b]||0)+1;el('circle',{cx:sx(v),cy:96-k*8,r:3.6,fill:css('--ink2'),opacity:.6},s)}
 el('line',{x1:sx(F.me.avg),x2:sx(F.me.avg),y1:14,y2:100,stroke:css('--mag'),'stroke-width':2.5},s);
 txt(s,sx(F.me.avg),10,`${D.tail&&KEY?D.tail:D.pid} ${Math.round(F.me.avg)}`,{'text-anchor':sx(F.me.avg)>W-100?'end':sx(F.me.avg)<100?'start':'middle',fill:css('--mag'),'font-weight':600});
 $('fleetplot').appendChild(s);
}
function renderTrend(){
 const wins=[[30,'1 month'],[90,'3 months'],[180,'6 months'],[365,'12 months']];
 $('trendwin').innerHTML=wins.map(([d,l])=>`<button type="button" data-d="${d}" aria-pressed="${d===trendWin}">${l}</button>`).join('');
 $('trendwin').querySelectorAll('button').forEach(b=>b.onclick=()=>{trendWin=+b.dataset.d;renderTrend()});
 const today=Math.floor(Date.now()/864e5), from=today-trendWin;
 const L=set().filter(l=>dayOf(l)>=from).reverse();
 const pts=L.map(l=>{const s=scoreLanding(l,vref);return {day:dayOf(l),score:s.score,verdict:s.verdict,id:l.id}});
 const T=trendOf(pts);
 const span=wins.find(w=>w[0]===trendWin)[1];
 const cls=T.slope==null?'':T.slope>=1.5?'c-Good':T.slope<=-1.5?'c-Needs':'';
 $('trendhead').innerHTML=T.slope==null
  ?`<b>${T.label}</b> for the last ${span}: ${pts.length} landing${pts.length===1?'':'s'}${pts.length?'':''}. A trend needs 4 or more landings spread over at least 3 weeks.`
  :`<b class="${cls}">${T.label}</b>: ${T.slope>0?'+':''}${T.slope} points per month over the last ${span}, across ${T.n} landings averaging ${Math.round(T.mean)}.`;
 const W=900,H=300,m={l:44,r:16,t:16,b:36};
 const lo=30,hi=100, sx=d=>m.l+(d-from)/(trendWin||1)*(W-m.l-m.r), sy=v=>H-m.b-(Math.max(lo,v)-lo)/(hi-lo)*(H-m.t-m.b);
 const s=svg(W,H); s.setAttribute('role','img'); s.setAttribute('aria-label',`Landing scores over the last ${span}`);
 for(let v=40;v<=100;v+=20){el('line',{x1:m.l,x2:W-m.r,y1:sy(v),y2:sy(v),stroke:css('--grid')},s);txt(s,m.l-6,sy(v)+4,v,{'text-anchor':'end'})}
 el('line',{x1:m.l,x2:W-m.r,y1:sy(69.5),y2:sy(69.5),stroke:css('--bad'),'stroke-dasharray':'2 4',opacity:.6},s); txt(s,W-m.r-2,sy(69.5)-5,'unstable cap',{'text-anchor':'end'});
 const ticks=trendWin<=30?7:trendWin<=90?14:trendWin<=180?30:60;
 for(let d=today;d>=from;d-=ticks) txt(s,sx(d),H-m.b+18,new Date(d*864e5).toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}),{'text-anchor':'middle'});
 // fleet weekly median
 if(FLEET&&FLEET.weekly){const i=vi(); const F=FLEET.weekly.week.map((w,k)=>[w+3,FLEET.weekly.med[k][i]]).filter(p=>p[0]>=from);
  if(F.length>1) el('path',{d:F.map((p,k)=>(k?'L':'M')+sx(p[0]).toFixed(1)+' '+sy(p[1]).toFixed(1)).join(' '),fill:'none',stroke:css('--mag'),'stroke-width':1.8,'stroke-dasharray':'6 5'},s)}
 // rolling mean of last 5
 if(pts.length>=3){const r=pts.map((p,k)=>{const w=pts.slice(Math.max(0,k-4),k+1);return [p.day,w.reduce((a,b)=>a+b.score,0)/w.length]});
  el('path',{d:r.map((p,k)=>(k?'L':'M')+sx(p[0]).toFixed(1)+' '+sy(p[1]).toFixed(1)).join(' '),fill:'none',stroke:css('--path'),'stroke-width':3,'stroke-linejoin':'round'},s)}
 const col={Good:css('--good'),Fair:css('--warn'),Needs:css('--bad'),Unstable:css('--bad')};
 for(const p of pts){const c=el('circle',{cx:sx(p.day),cy:sy(p.score),r:5,fill:col[p.verdict.split(' ')[0]],stroke:css('--panel'),'stroke-width':1.5,style:'cursor:pointer'},s);
  const t=document.createElementNS(NS,'title');t.textContent=`${new Date(p.day*864e5).toISOString().slice(0,10)}: ${p.score} (${p.verdict})`;c.appendChild(t);c.onclick=()=>goTo(p.id)}
 $('trend').innerHTML='';$('trend').appendChild(s);
}
function renderAcBestWorst(){
 const L=set().filter(rankable).map(l=>{const s=scoreLanding(l,vref);return {pid:D.pid,id:l.id,apt:l.apt,rwy:l.rwy,d:l.d,when:fmtD(l),score:s.score,verdict:s.verdict,td:!!(l.td&&l.td.ft!=null),why:whyLine(l,s,vref)}});
 const sec=$('bwsec'); if(L.length<4){sec.hidden=true;return} sec.hidden=false;
 const best=L.filter(x=>x.td).sort((a,b)=>b.score-a.score).slice(0,3);
 const worst=L.slice().sort((a,b)=>a.score-b.score).slice(0,3);
 $('bwac').innerHTML=bwList('Best 3','c-Good',best,false)+bwList('Worst 3','c-Needs',worst,false);
 wireBw($('bwac'));
}
function renderUn(){
 const U=D.unscored||[]; $('unsec').hidden=!U.length;
 $('un').innerHTML='<thead><tr><th>Date</th><th>Airport</th><th>What happened</th></tr></thead><tbody>'+U.map(u=>`<tr><td>${esc(u.d)}</td><td>${u.apt?esc(u.apt)+(u.name?', '+esc(u.name):''):'withheld'}</td><td>${esc(u.why||'')}</td></tr>`).join('')+'</tbody>';
}
function renderAll(){
 if(D&&!$('report').hidden){renderList();renderCard();renderTrend();renderAcBestWorst();renderIns();renderFleet();renderGaList()}
 else if(FLEET&&!$('home').hidden) renderHome();
 $('vo').textContent=vref; const wt=FLEET?weightFor(vref):null; $('wt').textContent=wt?`(~${wt.toLocaleString()} lb)`:'';
}
function renderMethod(){
 const m=FLEET?FLEET.meta:null;
 $('method').innerHTML=`
 <p>Tracks: <a href="https://adsb.lol">adsb.lol</a> open data, licensed <a href="https://opendatacommons.org/licenses/odbl/1-0/">ODbL 1.0</a>, read one full day at a time and filtered to US-registered ${m?esc(m.type):'aircraft'} from the FAA registry. The scored data on this site is shared under the same license. Surface weather: Iowa Environmental Mesonet METAR archive. Winds aloft: Open-Meteo model data when available. Runways: OurAirports, with a lateral correction where many crossings show a database threshold is off.</p>
 <p>Privacy: aircraft are listed under a keyed pseudonym, not a tail number. Exact times and raw weather reports are not published. For aircraft whose owners asked for limited tracking (FAA LADD or PIA), airports and runways are withheld too.</p>
 <p>Airspeed is estimated: groundspeed minus the wind vector, converted to indicated with density. Expect about ±5 kt. ADS-B carries no flap, gear, power or indicated airspeed. Heights come from GPS altitude in 25 ft steps, referenced to the airplane's own touchdown height. Arrivals where coverage stops before touchdown get gate scores but no touchdown score.</p>
 <p>Stable at 500 ft means all four: track within 10° and 300 ft of centerline, path within 1.0° of 3°, sink no more than 1,000 fpm, speed from Vref−5 to target+20. Target is Vref plus half the gust factor. Unstable landings are capped at 69. Points: 500 ft gate 40, 1,000 ft gate 15, final setup 5, threshold 15, touchdown and float 20, rollout margin 5.</p>
 ${m?`<p>Default Vref for the ${esc(m.type)} is ${m.vref.default} KIAS (range ${m.vref.vref[0]} to ${m.vref.vref[1]}${m.vref.weights?`, ${m.vref.weights[0].toLocaleString()} to ${m.vref.weights[1].toLocaleString()} lb`:''}). Data updated ${new Date(m.generated*1000).toLocaleString()}.</p>`:''}`;
}
function status(h){$('status').innerHTML=h}

// ---------------------------------------------------------------- routing
async function route(){
 const p=new URLSearchParams(location.search), ac=p.get('ac')||p.get('tail');
 if(ac){await showAircraft(ac)}
 else{ $('report').hidden=true; D=null; $('ownwrap').hidden=true; $('title').firstChild.textContent='Score my landing';
  if(FLEET){status('');$('home').hidden=false;const t=p.get('tab');setTab(['ga','gust'].includes(t)?t:'board',false);renderHome()}
  else status('<h2>No fleet data yet</h2><p>The collector publishes here after its first run.</p>') }
 renderAll();
}
async function init(){
 try{FLEET=await getJSON('data/fleet.json')}catch(e){FLEET=null}
 if(FLEET){const v=FLEET.meta.vref; vref=+(store.get('sml_vref')||v.default); if(!FLEET.vrefs.includes(vref)) vref=v.default;
  Object.assign($('vref'),{min:v.vref[0],max:v.vref[1],value:vref})}
 const sec=store.get('sml_secret'); if(sec) await unlock(sec,true);
 renderMethod(); await route();
}
$('vref').oninput=e=>{vref=+e.target.value;store.set('sml_vref',vref);renderAll()};
$('own').onchange=()=>{const L=set();if(!L.find(l=>l.id===sel))sel=L[0]&&L[0].id;renderAll()};
$('search').onsubmit=e=>{e.preventDefault();const q=$('q').value.trim(); if(q) open(q)};
$('lockbtn').onclick=()=>{if(KEY) lock(); else {$('unlock').hidden=!$('unlock').hidden; if(!$('unlock').hidden) $('secret').focus()}};
$('unlock').onsubmit=async e=>{e.preventDefault(); $('unlockmsg').textContent=''; if(await unlock($('secret').value)){$('secret').value=''; await route()}};
window.onpopstate=()=>route();
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>setTab(b.dataset.tab,true));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>renderAll());
init();

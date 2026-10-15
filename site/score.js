// Approach scoring. Shared by the page, the fleet benchmark and the Node tests.
// A landing is the JSON the Python pipeline writes; vref is the pilot's chosen Vref (KIAS).

function gustAdd(w){return (w&&w.gust&&w.gust>w.spd)?Math.min(10,Math.round((w.gust-w.spd)/2)):0}

function scoreLanding(L,vref){
  const va=vref+gustAdd(L.wind), f=[], g5=L.gates['500ft'], g1=L.gates['1000ft'];
  let pts=0,max=0; const add=(got,of)=>{pts+=got;max+=of};
  const crit={};
  // 500 ft gate: the stabilization gate (40 points)
  if(g5){
    const off=Math.abs(g5.trkdev), lat=Math.abs(g5.c);
    crit.align=off<=10&&lat<=300; add(crit.align?10:(off<=20?5:0),10);
    if(!crit.align) f.push({k:'bad',t:`Not lined up at 500 ft: track ${Math.round(off)}° off the runway, ${Math.round(lat)} ft from centerline.`});
    const pd=g5.ang!=null?Math.abs(g5.ang-3):null;
    crit.path=pd==null||pd<=1.0; add(pd==null?10:pd<=0.5?10:pd<=1.0?5:0,10);
    if(pd!=null&&pd>0.5) f.push({k:pd>1?'bad':'warn',t:`${g5.ang>3?'High':'Low'} at 500 ft: path angle ${g5.ang.toFixed(1)}° vs 3.0°.`});
    const sk=-(g5.vs||0); crit.sink=sk<=1000; add(sk<=1000?10:sk<=1200?5:0,10);
    if(sk>1000) f.push({k:'bad',t:`Sink rate ${Math.round(sk)} fpm at 500 ft (limit 1,000).`});
    const dv=g5.ias-vref; crit.speed=g5.ias>=vref-5&&g5.ias<=va+20;
    add(g5.ias>=vref-5&&g5.ias<=va+10?10:crit.speed?5:0,10);
    if(g5.ias>va+10) f.push({k:crit.speed?'warn':'bad',t:`Fast at 500 ft: about Vref+${Math.round(dv)} (est. ${Math.round(g5.ias)} KIAS).`});
    if(g5.ias<vref-5) f.push({k:'bad',t:`Slow at 500 ft: est. ${Math.round(g5.ias)} KIAS, below Vref.`});
  }
  // 1,000 ft gate (15 points)
  if(g1){
    const off=Math.abs(g1.trkdev); add(off<=15?5:0,5);
    if(off>15) f.push({k:'warn',t:`Still turning at 1,000 ft (${Math.round(off)}° off final).`});
    const pd=g1.ang!=null&&off<=15?Math.abs(g1.ang-3):null; add(pd==null?(off<=15?5:2):pd<=1?5:2,5);
    add(g1.ias<=va+30?5:g1.ias<=va+45?2:0,5);
    if(g1.ias>va+30) f.push({k:'warn',t:`Carrying est. ${Math.round(g1.ias)} KIAS at 1,000 ft, then slowing late.`});
  }
  // final setup (5)
  add(L.align>=3?5:L.align>=1.5?2:0,5);
  // threshold (15)
  const th=L.thr;
  if(th){
    add(th.hat>=30&&th.hat<=75?8:th.hat>=20&&th.hat<=100?4:0,8);
    if(th.hat>75) f.push({k:th.hat>100?'bad':'warn',t:`High over the threshold: ${Math.round(th.hat)} ft (target about 50).`});
    if(th.hat<30) f.push({k:th.hat<20?'bad':'warn',t:`Low over the threshold: ${Math.round(th.hat)} ft.`});
    add(th.ias>=vref-3&&th.ias<=va+12?7:th.ias<=va+18?3:0,7);
    if(th.ias>va+12) f.push({k:'warn',t:`Fast over the fence: about Vref+${Math.round(th.ias-vref)}.`});
  }
  // touchdown and float (20), rollout margin (5)
  if(L.td&&L.td.ft!=null){
    const d=L.td.ft; add(d>=500&&d<=1500?12:d>=300&&d<=2000?7:d<=2500?3:0,12);
    if(d>2000) f.push({k:d>2500?'bad':'warn',t:`Long touchdown: about ${d.toLocaleString()} ft past the threshold.`});
    if(d<300) f.push({k:'warn',t:`Very early touchdown: about ${d} ft past the threshold.`});
    if(L.td.float!=null){add(L.td.float<=8?8:L.td.float<=12?4:0,8); if(L.td.float>10) f.push({k:'warn',t:`Floated ${L.td.float} s from threshold to touchdown.`});}
  }
  if(L.stop&&L.stop.remain!=null){add(L.stop.remain>=2000?5:L.stop.remain>=1000?2:0,5)}
  const raw=max?Math.round(100*pts/max):0;
  const stable=g5?(crit.align&&crit.path&&crit.sink&&crit.speed):null;
  const score=stable===false?Math.min(raw,69):raw;
  const verdict=stable===false?'Unstable':score>=80?'Good':score>=65?'Fair':'Needs work';
  if(!f.length) f.push({k:'good',t:'Stable through every gate, on speed, touchdown in the zone.'});
  // conditions that can justify extra speed or a different picture
  const c=[]; const w=L.wind||{};
  if(gustAdd(w)) c.push(`Gusts ${w.spd}G${w.gust}: target raised to Vref+${gustAdd(w)}.`);
  if(Math.abs(w.xw||0)>=10) c.push(`Crosswind ${Math.round(Math.abs(w.xw))} kt.`);
  if((w.hw||0)<=-3) c.push(`Tailwind ${Math.round(-w.hw)} kt.`);
  const light=L.light||(L.sun==null?null:L.sun<-6?'night':L.sun<0?'dusk':'day');
  if(light==='night') c.push('Night landing.'); else if(light==='dusk') c.push('Dusk landing.');
  if(L.ceil<1500||(L.vis!=null&&L.vis<3)) c.push(`IMC or low ceiling (ceiling ${L.ceil<99999?L.ceil.toLocaleString()+' ft':'none'}, vis ${L.vis} sm).`);
  if(L.airline) c.push('Airline field: ATC speed requests are likely (not visible in ADS-B).');
  if(L.rlen<5000) c.push(`Shorter runway (${L.rlen.toLocaleString()} ft).`);
  if(L.lowcov) c.push('ADS-B coverage dropped below about 250 ft; touchdown not scored.');
  return {score,raw,stable,verdict,findings:f,context:c,va,crit};
}

const _avg=(a,f)=>a.length?a.reduce((s,x)=>s+f(x),0)/a.length:0;
const _label=L=>L.apt?`${L.apt} ${L.rwy}`:(L.d?`Landing on ${L.d}`:'landing');

function insights(Ls,vref,opts={}){
  const S=Ls.map(L=>({L,s:scoreLanding(L,vref)}));
  const n=S.length, out=[];
  if(!n) return {S,out};
  const stab=a=>a.filter(x=>x.s.stable).length;
  const pat=S.filter(x=>x.L.align<3), str=S.filter(x=>x.L.align>=3);
  if(pat.length&&str.length){
    const pa=_avg(pat,x=>x.s.score), sa=_avg(str,x=>x.s.score);
    const worse=pa<sa-5;
    out.push({h:worse?'Tight visual patterns are your weak spot':'Patterns and straight-ins score about the same',
      b:`${stab(str)} of ${str.length} straight-in approaches were stable at 500 ft (average score ${Math.round(sa)}). Arrivals that rolled out on final inside 3 nm: ${stab(pat)} of ${pat.length} stable (average ${Math.round(pa)}).${worse?' The usual cause is still turning at 1,000 ft and finishing the turn near 500 ft.':''}`,
      r:worse?'On visual arrivals, extend so you roll out on final by 2 nm and 650 ft, or ask for the RNAV straight-in. Make "wings level by 500 ft or go around" the hard rule.':'Keep doing what you are doing on short finals; the gains are elsewhere.',
      ids:pat.filter(x=>!x.s.stable).map(x=>x.L.id)});
  }
  const w5=S.filter(x=>x.L.gates['500ft']);
  if(w5.length){
    const m5=_avg(w5,x=>x.L.gates['500ft'].ias-x.s.va);
    const fast=w5.filter(x=>x.L.gates['500ft'].ias>x.s.va+10);
    const thrS=S.filter(x=>x.L.thr);
    out.push({h:`Speed at 500 ft averages about Vref${m5>=0?'+':''}${Math.round(m5)}`,
      b:`Estimated from groundspeed and model winds (±5 kt). ${fast.length} of ${w5.length} landings were more than 10 kt over target at 500 ft.${thrS.length?` Threshold speeds average Vref+${Math.round(_avg(thrS,x=>x.L.thr.ias-vref))}.`:''}`,
      r:fast.length>w5.length/3?"Have speed within Vref+10 by 500 ft. If you're consistently +15, the fix is usually earlier: landing configuration and target speed set by the 1,000 ft call rather than in the flare.":'Speed control at the gate is solid.',
      ids:fast.map(x=>x.L.id)});
  }
  const late=S.filter(x=>x.L.gates['1000ft']&&x.L.gates['500ft']&&x.L.gates['1000ft'].ias-x.L.gates['500ft'].ias>18);
  if(late.length) out.push({h:`${late.length} approach${late.length>1?'es':''} slowed late`,b:'Speed dropped more than 18 kt between 1,000 and 500 ft, so power and configuration were still changing inside the stabilization gate.',r:`${opts.dragTip||'Configure earlier when ATC keeps you fast'}, so the speed is gone before 1,000 ft.`,ids:late.map(x=>x.L.id)});
  const long=S.filter(x=>x.L.td&&x.L.td.ft>2000);
  if(long.length){
    const fl=S.filter(x=>x.L.td&&x.L.td.float!=null).map(x=>x.L.td.float).sort((a,b)=>a-b);
    out.push({h:`${long.length} long touchdown${long.length>1?'s':''}`,
      b:long.map(x=>`${_label(x.L)}: ${x.L.td.ft.toLocaleString()} ft${x.L.thr?`, crossed at ${Math.round(x.L.thr.hat)} ft and Vref+${Math.round(x.L.thr.ias-vref)}`:''}`).join('. ')+'.',
      r:`The long ones floated ${Math.min(...long.map(x=>x.L.td.float??99))} s or more, against a typical ${fl[Math.floor(fl.length/2)]} s. Float is extra energy at the fence: aim for 50 ft and Vref crossing, and treat a float past the 2,000 ft markers as a go-around trigger on shorter runways.`,
      ids:long.map(x=>x.L.id)});
  }
  const lowx=S.filter(x=>x.L.thr&&x.L.thr.hat<20);
  if(lowx.length) out.push({h:`${lowx.length} low threshold crossing${lowx.length>1?'s':''}`,b:'Crossed under 20 ft. With 25 ft altitude steps in ADS-B this is borderline, but worth watching.',r:'Keep the PAPI at two white, two red through the threshold.',ids:lowx.map(x=>x.L.id)});
  const best=[...S].filter(x=>x.L.td&&x.L.gates['500ft']).sort((a,b)=>b.s.score-a.s.score).slice(0,3);
  if(best.length) out.push({h:'What good looks like',b:best.map(x=>`${_label(x.L)} scored ${x.s.score}: ${x.L.align>=3?'straight-in from '+x.L.align+' nm':'rolled out at '+x.L.align+' nm'}, Vref+${Math.round(x.L.gates['500ft'].ias-vref)} at 500 ft, touchdown ${x.L.td.ft.toLocaleString()} ft`).join('. ')+'.',r:'These are the ones to repeat.',ids:best.map(x=>x.L.id)});
  return {S,out};
}

// Fleet comparison from fleet.json: each aircraft's average score at this Vref (current owner, last 12 months).
function fleetCompare(fleet,myLandings,vref,myPid,minLandings=3){
  const i=fleet.vrefs.indexOf(vref); if(i<0) return null;
  const others=fleet.aircraft.filter(a=>a.n>=minLandings&&a.pid!==myPid&&a.s);
  const mine=myLandings.map(L=>scoreLanding(L,vref)); if(!mine.length) return null;
  const judged=mine.filter(s=>s.stable!==null);
  const me={avg:_avg(mine,s=>s.score),stab:judged.length?judged.filter(s=>s.stable).length/judged.length:0,n:mine.length};
  const avgs=others.map(a=>a.s[i]), stabs=others.map(a=>a.st[i]).filter(x=>x!==null);
  const pct=(arr,v)=>arr.length?Math.round(100*(arr.filter(x=>x<v).length+0.5*arr.filter(x=>x===v).length)/arr.length):null;
  return {aircraft:others.length,me,pctScore:pct(avgs,me.avg),pctStable:pct(stabs,me.stab),
    fleetAvg:_avg(avgs,x=>x),fleetStable:_avg(stabs,x=>x),dist:avgs.slice().sort((a,b)=>a-b)};
}

// Trend: least-squares slope of score against date, in points per 30 days.
// pts: [{day: days since epoch, score}]. Needs 4+ landings spread over 3+ weeks.
function trendOf(pts,minN=4,minSpan=21){
  const n=pts.length; if(n<minN) return {n,slope:null,label:'Not enough landings yet'};
  const xs=pts.map(p=>p.day), ys=pts.map(p=>p.score);
  const span=Math.max(...xs)-Math.min(...xs); if(span<minSpan) return {n,span,slope:null,label:'Not enough time yet'};
  const mx=_avg(xs,x=>x), my=_avg(ys,y=>y);
  let sxy=0,sxx=0; for(let i=0;i<n;i++){sxy+=(xs[i]-mx)*(ys[i]-my);sxx+=(xs[i]-mx)**2}
  const slope=30*sxy/sxx;
  const label=Math.abs(slope)<1.5?'Holding steady':slope>0?'Trending better':'Trending worse';
  return {n,span,slope:Math.round(slope*10)/10,label,first:my-slope/30*(mx-Math.min(...xs)),mean:my};
}
const dayOf=L=>Math.floor((L.t?L.t*1000:Date.parse(L.d+'T12:00:00Z'))/864e5);

// Best/worst: which landings qualify, and a one-line reason for each.
function rankable(L){return !!(L.gates&&L.gates['500ft']&&L.thr)}
function whyLine(L,s,vref){
  if(s.score>=80){
    const g=L.gates['500ft'], bits=[];
    bits.push(L.align>=3?`stable from ${L.align} nm`:`rolled out at ${L.align} nm`);
    bits.push(`Vref${g.ias-vref>=0?'+':''}${Math.round(g.ias-vref)} at 500 ft`);
    if(L.td&&L.td.ft!=null) bits.push(`touchdown ${L.td.ft.toLocaleString()} ft`);
    return bits.join(', ');
  }
  const f=s.findings.find(x=>x.k==='bad')||s.findings.find(x=>x.k==='warn');
  const t=f?f.t.replace(/\.$/,''):'';
  return (L.align<1&&/Not lined up/.test(t))?`Circling or tight pattern. ${t}`:t;
}

// Go-arounds. ADS-B can't see intent, so each one is sorted by where it happened and the
// weather. Planned missed approaches on practice instrument approaches look like a stable
// approach that climbs away near a decision height in good weather.
const GA_CATS={goaround:'Go-around',runway:'Over the runway',weather:'Missed approach, low weather',practice:'Likely practice approach',touch:'Touch-and-go',legacy:'Not yet measured'};
function gaCategory(G){
  if(G.legacy||!G.ga) return 'legacy';
  const g=G.ga; if(g.kind==='touch') return 'touch';
  if(g.low_x!=null&&g.low_x<0) return 'runway';
  if((G.ceil!=null&&G.ceil<1000)||(G.vis!=null&&G.vis<3)) return 'weather';
  const vmc=(G.ceil==null||G.ceil>=3000)&&(G.vis==null||G.vis>=5);
  if(vmc&&G.align>=3&&g.low_ft>=150&&g.low_ft<=500) return 'practice';
  return 'goaround';
}
// counts toward go-around rates: real decisions, not practice or missed ground contact
const gaReal=G=>['goaround','runway','weather'].includes(gaCategory(G));
const GA_BANDS=['Above 1,000 ft','500 to 1,000 ft','200 to 500 ft','Below 200 ft','Over the runway'];
function gaBand(G){const g=G.ga||{}; if(g.low_x!=null&&g.low_x<0) return 4; const h=g.low_ft;
  return h==null?null:h>1000?0:h>500?1:h>200?2:3}

if(typeof module!=='undefined') module.exports={scoreLanding,insights,gustAdd,fleetCompare,trendOf,dayOf,rankable,whyLine,gaCategory,gaReal,gaBand,GA_CATS,GA_BANDS};

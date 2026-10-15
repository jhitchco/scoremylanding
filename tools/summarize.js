// node tools/summarize.js <public dir>
// Scores every aircraft at every Vref in its type's range with site/score.js, so the
// leaderboard and percentiles use exactly the same rules as the detail view.
const fs = require('fs'), path = require('path');
const {scoreLanding, trendOf, dayOf, rankable, whyLine, gustAdd, gaCategory, gaReal, gaBand, GA_BANDS, closeCall} = require('../site/score.js');

const pub = process.argv[2] || 'data/public';
const idx = JSON.parse(fs.readFileSync(path.join(pub, 'index.json')));
const [v0, v1] = idx.meta.vref.vref;
const vrefs = []; for (let v = v0; v <= v1; v++) vrefs.push(v);
const YEAR = 365 * 86400 * 1000, now = Date.now();

const rows = [];
let scored = 0;
const today = Math.floor(now / 864e5);
const weekOf = d => d - ((d + 3) % 7);           // Monday of the week (days since epoch)
const weekly = {};                                // week -> [scores per vref]
const cand = vrefs.map(() => []);                // per vref: rankable landings in the longest window
const BW_WINDOWS = [30, 90], BW_N = 10, BW_PER_AC = 2, BW_MAX = Math.max(...BW_WINDOWS);
// ---- go-arounds: only days whose go-arounds have been measured (meta.current_days)
const CUR = new Set(idx.meta.current_days || []);
const inYear = l => now - Date.parse(l.d) < YEAR;
const GA = {cats: {}, bands: GA_BANDS.map(() => 0), why: vrefs.map(() => ({ga: [0, 0, 0, 0], pushed: [0, 0, 0, 0], gaN: 0, pushedN: 0})),
  n: vrefs.map(() => ({land: 0, ga: 0, landU: 0, gaU: 0, gaS: 0, gaPre: 0, sumGa: 0, sumU: 0, sumS: 0, nS: 0})), aircraft: 0, withGa: 0};
const CRIT = ['align', 'path', 'sink', 'speed'];
const gaCache = new Map();
function gaAircraft(a, doc) {
  const Ld = doc.landings.filter(l => CUR.has(l.d) && inYear(l));
  const Gd = (doc.go_arounds || []).filter(g => CUR.has(g.d) && inYear(g));
  for (const g of Gd) { const c = gaCategory(g); GA.cats[c] = (GA.cats[c] || 0) + 1; }
  const real = Gd.filter(gaReal);
  for (const g of real) { const b = gaBand(g); if (b != null) GA.bands[b]++; }
  if (Ld.length + real.length) { GA.aircraft++; if (real.length) GA.withGa++; }
  const gu = [], lu = [];
  vrefs.forEach((v, k) => {
    const N = GA.n[k], W = GA.why[k];
    let u = 0, l2 = 0;
    for (const l of Ld) { const sc = scoreLanding(l, v); N.land++;
      if (sc.stable === false) { N.landU++; l2++; N.sumU += sc.score; W.pushedN++; CRIT.forEach((c, j) => { if (!sc.crit[c]) W.pushed[j]++; }); }
      else if (sc.stable) { N.sumS += sc.score; N.nS++; } }
    for (const g of real) { const sc = scoreLanding(g, v); N.ga++; N.sumGa += sc.score;
      if (!g.gates || !g.gates['500ft']) N.gaPre++;
      else if (sc.stable === false) { N.gaU++; u++; W.gaN++; CRIT.forEach((c, j) => { if (!sc.crit[c]) W.ga[j]++; }); }
      else if (sc.stable) N.gaS++; }
    gu.push(u); lu.push(l2);
  });
  gaCache.set(a.pid, {g: real.length, a: Ld.length + real.length, gu, lu, gp: Gd.filter(g => gaCategory(g) === 'practice').length});
}
const gaRow = doc => gaCache.get(doc.pid) || {};
// ---- runways: every landing with a known runway (LADD/PIA aircraft have none published)
const RW = new Map();
const AFTER = {kinds: {}, next: vrefs.map(() => ({n: 0, sum: 0})), min: []};
function runwayAircraft(doc) {
  for (const l of doc.landings) {
    if (!l.apt || !inYear(l)) continue;
    const k = l.apt + ' ' + l.rwy;
    const r = RW.get(k) || {apt: l.apt, rwy: l.rwy, rlen: l.rlen, n: 0, ac: new Set(), sum: vrefs.map(() => 0), uns: vrefs.map(() => 0), cc: vrefs.map(() => 0), left: [], ga: 0};
    r.n++; r.ac.add(doc.pid); if (l.td && l.td.ft != null && l.td.ft >= 0 && l.rlen) r.left.push(l.rlen - l.td.ft);
    vrefs.forEach((v, j) => { const sc = scoreLanding(l, v); r.sum[j] += sc.score; if (sc.stable === false) r.uns[j]++; if (closeCall(l, v).length) r.cc[j]++; });
    RW.set(k, r);
  }
  const byId = new Map(doc.landings.map(l => [l.id, l]));
  for (const g of doc.go_arounds || []) {
    if (!CUR.has(g.d) || !inYear(g) || !gaReal(g)) continue;
    if (g.apt) { const r = RW.get(g.apt + ' ' + g.rwy); if (r) r.ga++; else RW.set(g.apt + ' ' + g.rwy, {apt: g.apt, rwy: g.rwy, rlen: g.rlen, n: 0, ac: new Set(), sum: vrefs.map(() => 0), uns: vrefs.map(() => 0), cc: vrefs.map(() => 0), left: [], ga: 1}); }
    const a = g.after || {kind: 'unseen'}; AFTER.kinds[a.kind] = (AFTER.kinds[a.kind] || 0) + 1;
    if (a.min != null) AFTER.min.push(a.min);
    const nx = a.kind === 'landed' && byId.get(a.id);
    if (nx) vrefs.forEach((v, j) => { AFTER.next[j].n++; AFTER.next[j].sum += scoreLanding(nx, v).score; });
  }
}
// ---- gusts: how much speed pilots carry against the gust factor
const gustRows = [];

for (const a of idx.aircraft) {
  const doc = JSON.parse(fs.readFileSync(path.join(pub, 'ac', a.pid + '.json')));
  // current owner only, last 12 months: the leaderboard is about how the airplane is flown now
  const L = doc.landings.filter(l => l.og === doc.current_owner && now - Date.parse(l.d) < YEAR);
  gaAircraft(a, doc); runwayAircraft(doc);
  if (!L.length) { rows.push(Object.assign({pid: a.pid, n: 0, last: a.last}, gaRow(doc))); continue; }
  const s = [], st = [], tr = [];
  for (const v of vrefs) {
    const sc = L.map(l => scoreLanding(l, v));
    const pts = L.map((l, k) => ({day: dayOf(l), score: sc[k].score}));
    const t = trendOf(pts.filter(p => today - p.day <= 90));
    L.forEach((l, k) => {
      if (today - pts[k].day > BW_MAX || !rankable(l)) return;
      cand[vrefs.indexOf(v)].push({pid: a.pid, id: l.id, d: l.d, age: today - pts[k].day, apt: l.apt, rwy: l.rwy, score: sc[k].score,
        verdict: sc[k].verdict, td: !!(l.td && l.td.ft != null), why: whyLine(l, sc[k], v)});
    });
    tr.push(t.slope);
    pts.forEach(p => { const w = weekOf(p.day); (weekly[w] = weekly[w] || vrefs.map(() => []))[vrefs.indexOf(v)].push(p.score); });
    s.push(Math.round(10 * sc.reduce((x, y) => x + y.score, 0) / sc.length) / 10);
    const judged = sc.filter(x => x.stable !== null);
    st.push(judged.length ? Math.round(1000 * judged.filter(x => x.stable).length / judged.length) / 1000 : null);
  }
  scored += L.length;
  for (const l of L) if (l.wind && l.wind.spd != null && l.gates && l.gates['500ft']) gustRows.push(l);
  rows.push(Object.assign({pid: a.pid, n: L.length, last: a.last, s, st, tr, pattern: Math.round(100 * L.filter(l => l.align < 3).length / L.length)}, gaRow(doc)));
}
const qt = (a, p) => { a = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor(p * (a.length - 1))] : null; };
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
const weeks = Object.keys(weekly).map(Number).sort((a, b) => a - b).filter(w => weekly[w][0].length >= 5);
const fleetWeekly = {week: weeks, med: weeks.map(w => weekly[w].map(med)), n: weeks.map(w => weekly[w][0].length)};
function pick(list, better) {
  const out = [], per = {};
  for (const c of list.slice().sort((x, y) => better ? y.score - x.score : x.score - y.score)) {
    if (better && !c.td) continue;                 // a best landing needs a scored touchdown
    if ((per[c.pid] = (per[c.pid] || 0) + 1) > BW_PER_AC) continue;
    const {td, age, ...e} = c; out.push(e);
    if (out.length >= BW_N) break;
  }
  return out;
}
// one set per window: {days, best[vref][], worst[vref][]}
const bestworst = {windows: BW_WINDOWS.map(days => {
  const inWin = cand.map(c => c.filter(x => x.age <= days));
  return {days, best: inWin.map(c => pick(c, true)), worst: inWin.map(c => pick(c, false))};
})};
// go-around summary per Vref
const r1 = x => Math.round(10 * x) / 10;
const goarounds = {days: CUR.size, cats: GA.cats, bands: GA.bands, band_names: GA_BANDS, aircraft: GA.aircraft, with_ga: GA.withGa, crit: CRIT,
  per: GA.n.map((N, k) => ({land: N.land, ga: N.ga, rate: N.land + N.ga ? r1(100 * N.ga / (N.land + N.ga)) : null,
    unstable_went: N.gaU + N.landU ? r1(100 * N.gaU / (N.gaU + N.landU)) : null, ga_unstable: N.gaU, ga_stable: N.gaS, ga_before_500: N.gaPre, land_unstable: N.landU,
    avg_ga: N.ga ? r1(N.sumGa / N.ga) : null, avg_pushed: N.landU ? r1(N.sumU / N.landU) : null, avg_stable: N.nS ? r1(N.sumS / N.nS) : null,
    why_ga: GA.why[k].ga.map(x => GA.why[k].gaN ? Math.round(100 * x / GA.why[k].gaN) : null),
    why_pushed: GA.why[k].pushed.map(x => GA.why[k].pushedN ? Math.round(100 * x / GA.why[k].pushedN) : null)}))};
goarounds.after = {kinds: AFTER.kinds, min_median: qt(AFTER.min, .5), next_avg: AFTER.next.map(x => x.n ? r1(x.sum / x.n) : null), next_n: AFTER.next[0].n};
// runways with 5+ landings; aircraft count only, never which aircraft
// 2+ aircraft keeps this a fleet view rather than one owner's home strip
const runways = [...RW.values()].filter(r => r.n >= 5 && r.ac.size >= 2).map(r => ({apt: r.apt, rwy: r.rwy, rlen: r.rlen, n: r.n, ac: r.ac.size, ga: r.ga,
  avg: r.sum.map(x => r1(x / r.n)), uns: r.uns, cc: r.cc, left: qt(r.left, .5)})).sort((a, b) => b.n - a.n);
// gust additive: median estimated IAS at 500 ft and the threshold, by gust factor
const gf = l => (l.wind.gust && l.wind.gust > l.wind.spd) ? l.wind.gust - l.wind.spd : 0;
const slope = (xs, ys) => { const n = xs.length; if (n < 10) return null; const mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0; for (let k = 0; k < n; k++) { sxy += (xs[k] - mx) * (ys[k] - my); sxx += (xs[k] - mx) ** 2; } return sxx ? Math.round(100 * sxy / sxx) / 100 : null; };
const GBINS = [[0, 0, 'No gusts'], [1, 7, 'Gusting 1 to 7 kt'], [8, 11, 'Gusting 8 to 11 kt'], [12, 99, 'Gusting 12 kt or more']];
const thrRows = gustRows.filter(l => l.thr && l.thr.ias);
const gusts = {
  bins: GBINS.map(([a, b, label]) => { const g = gustRows.filter(l => gf(l) >= a && gf(l) <= b), t = g.filter(l => l.thr && l.thr.ias);
    return {label, n: g.length, book: qt(g.map(l => gustAdd(l.wind)), .5),
      ias500: [qt(g.map(l => l.gates['500ft'].ias), .25), qt(g.map(l => l.gates['500ft'].ias), .5), qt(g.map(l => l.gates['500ft'].ias), .75)],
      iasThr: [qt(t.map(l => l.thr.ias), .25), qt(t.map(l => l.thr.ias), .5), qt(t.map(l => l.thr.ias), .75)]}; }),
  slope500: slope(gustRows.map(l => gustAdd(l.wind)), gustRows.map(l => l.gates['500ft'].ias)),
  slopeThr: slope(thrRows.map(l => gustAdd(l.wind)), thrRows.map(l => l.thr.ias)),
  gusty: gustRows.filter(l => gf(l) > 0).length, total: gustRows.length,
  flips: vrefs.map(v => gustRows.filter(l => gf(l) > 0).reduce((n, l) => {
    const a = scoreLanding(l, v).stable, b = scoreLanding(Object.assign({}, l, {wind: Object.assign({}, l.wind, {gust: null})}), v).stable;
    return n + (a === true && b === false); }, 0)),
};
const out = {meta: Object.assign({}, idx.meta, {scored_landings_12mo: scored, current_days: undefined}), vrefs, aircraft: rows, weekly: fleetWeekly, bestworst, goarounds, gusts, runways};
fs.writeFileSync(path.join(pub, 'fleet.json'), JSON.stringify(out));
console.log(`fleet.json: ${rows.filter(r => r.n).length} aircraft with landings, ${scored} landings in the last 12 months; go-arounds measured on ${CUR.size} days`);

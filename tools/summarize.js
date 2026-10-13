// node tools/summarize.js <public dir>
// Scores every aircraft at every Vref in its type's range with site/score.js, so the
// leaderboard and percentiles use exactly the same rules as the detail view.
const fs = require('fs'), path = require('path');
const {scoreLanding, trendOf, dayOf, rankable, whyLine} = require('../site/score.js');

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
const cand = vrefs.map(() => []);                // per vref: rankable landings in the last 90 days
const BW_DAYS = 90, BW_N = 10, BW_PER_AC = 2;
for (const a of idx.aircraft) {
  const doc = JSON.parse(fs.readFileSync(path.join(pub, 'ac', a.pid + '.json')));
  // current owner only, last 12 months: the leaderboard is about how the airplane is flown now
  const L = doc.landings.filter(l => l.og === doc.current_owner && now - Date.parse(l.d) < YEAR);
  if (!L.length) { rows.push({pid: a.pid, n: 0, last: a.last}); continue; }
  const s = [], st = [], tr = [];
  for (const v of vrefs) {
    const sc = L.map(l => scoreLanding(l, v));
    const pts = L.map((l, k) => ({day: dayOf(l), score: sc[k].score}));
    const t = trendOf(pts.filter(p => today - p.day <= 90));
    L.forEach((l, k) => {
      if (today - pts[k].day > BW_DAYS || !rankable(l)) return;
      cand[vrefs.indexOf(v)].push({pid: a.pid, id: l.id, d: l.d, apt: l.apt, rwy: l.rwy, score: sc[k].score,
        verdict: sc[k].verdict, td: !!(l.td && l.td.ft != null), why: whyLine(l, sc[k], v)});
    });
    tr.push(t.slope);
    pts.forEach(p => { const w = weekOf(p.day); (weekly[w] = weekly[w] || vrefs.map(() => []))[vrefs.indexOf(v)].push(p.score); });
    s.push(Math.round(10 * sc.reduce((x, y) => x + y.score, 0) / sc.length) / 10);
    const judged = sc.filter(x => x.stable !== null);
    st.push(judged.length ? Math.round(1000 * judged.filter(x => x.stable).length / judged.length) / 1000 : null);
  }
  scored += L.length;
  rows.push({pid: a.pid, n: L.length, last: a.last, s, st, tr, pattern: Math.round(100 * L.filter(l => l.align < 3).length / L.length)});
}
const med = a => { const b = a.slice().sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
const weeks = Object.keys(weekly).map(Number).sort((a, b) => a - b).filter(w => weekly[w][0].length >= 5);
const fleetWeekly = {week: weeks, med: weeks.map(w => weekly[w].map(med)), n: weeks.map(w => weekly[w][0].length)};
function pick(list, better) {
  const out = [], per = {};
  for (const c of list.slice().sort((x, y) => better ? y.score - x.score : x.score - y.score)) {
    if (better && !c.td) continue;                 // a best landing needs a scored touchdown
    if ((per[c.pid] = (per[c.pid] || 0) + 1) > BW_PER_AC) continue;
    const {td, ...e} = c; out.push(e);
    if (out.length >= BW_N) break;
  }
  return out;
}
const bestworst = {days: BW_DAYS, best: cand.map(c => pick(c, true)), worst: cand.map(c => pick(c, false))};
const out = {meta: Object.assign({}, idx.meta, {scored_landings_12mo: scored}), vrefs, aircraft: rows, weekly: fleetWeekly, bestworst};
fs.writeFileSync(path.join(pub, 'fleet.json'), JSON.stringify(out));
console.log(`fleet.json: ${rows.filter(r => r.n).length} aircraft with landings, ${scored} landings in the last 12 months`);

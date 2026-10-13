// node tools/summarize.js <public dir>
// Scores every aircraft at every Vref in its type's range with site/score.js, so the
// leaderboard and percentiles use exactly the same rules as the detail view.
const fs = require('fs'), path = require('path');
const {scoreLanding} = require('../site/score.js');

const pub = process.argv[2] || 'data/public';
const idx = JSON.parse(fs.readFileSync(path.join(pub, 'index.json')));
const [v0, v1] = idx.meta.vref.vref;
const vrefs = []; for (let v = v0; v <= v1; v++) vrefs.push(v);
const YEAR = 365 * 86400 * 1000, now = Date.now();

const rows = [];
let scored = 0;
for (const a of idx.aircraft) {
  const doc = JSON.parse(fs.readFileSync(path.join(pub, 'ac', a.pid + '.json')));
  // current owner only, last 12 months: the leaderboard is about how the airplane is flown now
  const L = doc.landings.filter(l => l.og === doc.current_owner && now - Date.parse(l.d) < YEAR);
  if (!L.length) { rows.push({pid: a.pid, n: 0, last: a.last}); continue; }
  const s = [], st = [];
  for (const v of vrefs) {
    const sc = L.map(l => scoreLanding(l, v));
    s.push(Math.round(10 * sc.reduce((x, y) => x + y.score, 0) / sc.length) / 10);
    const judged = sc.filter(x => x.stable !== null);
    st.push(judged.length ? Math.round(1000 * judged.filter(x => x.stable).length / judged.length) / 1000 : null);
  }
  scored += L.length;
  rows.push({pid: a.pid, n: L.length, last: a.last, s, st, pattern: Math.round(100 * L.filter(l => l.align < 3).length / L.length)});
}
const out = {meta: Object.assign({}, idx.meta, {scored_landings_12mo: scored}), vrefs, aircraft: rows};
fs.writeFileSync(path.join(pub, 'fleet.json'), JSON.stringify(out));
console.log(`fleet.json: ${rows.filter(r => r.n).length} aircraft with landings, ${scored} landings in the last 12 months`);

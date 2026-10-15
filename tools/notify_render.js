// node tools/notify_render.js <input.json>
// Renders the post-flight email for one aircraft. Input comes from debrief/notify.py:
// {tail, pid, vref, tz, site, events: [full landing / go-around records], recent: [landings], fleet: path}
// Prints {subject, html, text}. Scoring uses site/score.js, the only scoring implementation.
const fs = require('fs');
const {scoreLanding, closeCall, whyLine, fleetCompare, trendOf, dayOf, gaCategory, GA_CATS} = require('../site/score.js');

const inp = JSON.parse(fs.readFileSync(process.argv[2]));
const {tail, pid, vref, tz, site} = inp;
let fleet = null;
try { fleet = JSON.parse(fs.readFileSync(inp.fleet)); } catch (e) { /* no comparison then */ }

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const when = t => new Date(t * 1000).toLocaleString('en-US', {timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
const day = t => new Date(t * 1000).toLocaleDateString('en-US', {timeZone: tz, month: 'short', day: 'numeric'});
const sgn = x => (x >= 0 ? '+' : '') + Math.round(x);
const color = v => v === 'Good' ? '#2D7A4C' : v === 'Fair' ? '#B57B00' : '#BE3A21';
const link = id => `${site}?ac=${encodeURIComponent(pid)}&l=${encodeURIComponent(id)}`;

const ev = inp.events.slice().sort((a, b) => a.t - b.t);
const blocks = [], lines = [];
for (const L of ev) {
  const s = scoreLanding(L, vref), isGa = !!L.ga;
  const where = `${L.apt || 'Airport'} runway ${L.rwy || ''}`.trim();
  const facts = [];
  const g5 = L.gates && L.gates['500ft'];
  if (g5) facts.push(`500 ft: Vref${sgn(g5.ias - vref)}, ${g5.ang != null && Math.abs(g5.trkdev) <= 12 ? g5.ang.toFixed(1) + '° path, ' : ''}${Math.round(-(g5.vs || 0))} fpm`);
  if (L.thr) facts.push(`Threshold: ${Math.round(L.thr.hat)} ft at Vref${sgn(L.thr.ias - vref)}`);
  if (L.td && L.td.ft != null) facts.push(`Touchdown: ${L.td.ft.toLocaleString()} ft${L.rlen ? `, ${(L.rlen - L.td.ft).toLocaleString()} ft of runway left` : ''}`);
  const cat = isGa ? gaCategory(L) : null;
  if (isGa) facts.push(`${cat === 'goaround' ? 'Go-around' : 'Go-around, ' + GA_CATS[cat].toLowerCase()}: climb began at ${Math.max(0, L.ga.low_ft)} ft${L.ga.low_x != null && L.ga.low_x < 0 ? ' over the runway' : `, ${L.ga.low_x} nm out`}`);
  const cc = isGa ? [] : closeCall(L, vref);
  const finds = s.findings.filter(f => f.k !== 'good').slice(0, 4).map(f => f.t);
  if (cc.length) finds.unshift('Close call: ' + cc.join('; ') + '.');
  let why = isGa ? '' : whyLine(L, s, vref);
  if (why && finds.some(f => f.startsWith(why))) why = '';
  if (why) why = why[0].toUpperCase() + why.slice(1);
  const verdict = (isGa ? 'Go-around, ' : '') + s.verdict;
  blocks.push(`<tr><td style="padding:16px 0;border-bottom:1px solid #D5DCE1">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:top"><div style="font-size:20px;font-weight:700;color:#17212C">${esc(where)}</div>
        <div style="font-size:14px;color:#4B5866">${esc(when(L.t))}${L.wind && L.wind.spd ? `, wind ${String(Math.round(L.wind.dir)).padStart(3, '0')}° at ${L.wind.spd}${L.wind.gust ? 'G' + L.wind.gust : ''} kt` : ''}</div></td>
      <td style="vertical-align:top;text-align:right;white-space:nowrap"><div style="font-size:36px;font-weight:700;line-height:1;color:${color(s.verdict)}">${s.score}</div>
        <div style="font-size:13px;font-weight:600;color:${color(s.verdict)}">${esc(verdict)}</div></td></tr></table>
    ${why ? `<p style="margin:8px 0 4px;font-size:15px;color:#17212C">${esc(why)}.</p>` : ''}
    <p style="margin:4px 0;font-size:14px;color:#4B5866">${facts.map(esc).join('<br>')}</p>
    ${finds.length ? `<ul style="margin:6px 0 0 18px;padding:0;font-size:14px;color:#17212C">${finds.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : `<p style="margin:6px 0 0;font-size:14px;color:#2D7A4C">Stable through every gate, on speed, touchdown in the zone.</p>`}
    ${L.metar ? `<p style="margin:6px 0 0;font-size:12px;color:#4B5866;font-family:monospace">${esc(L.metar)}</p>` : ''}
    <p style="margin:8px 0 0;font-size:14px"><a href="${esc(link(L.id))}" style="color:#1D5DA8;font-weight:600">Open this ${isGa ? 'approach' : 'landing'} on the site</a></p>
  </td></tr>`);
  lines.push(`${where}, ${when(L.t)}: ${s.score} (${verdict})${why ? '. ' + why : ''}${finds.length ? '\n  - ' + finds.join('\n  - ') : ''}\n  ${link(L.id)}`);
}

// last 90 days and the fleet
const today = Math.floor(Date.now() / 864e5);
const recent = (inp.recent || []).filter(l => today - dayOf(l) <= 90);
const sc = recent.map(l => scoreLanding(l, vref));
const T = trendOf(recent.map((l, k) => ({day: dayOf(l), score: sc[k].score})));
const avg = sc.length ? Math.round(sc.reduce((a, s) => a + s.score, 0) / sc.length) : null;
const F = fleet ? fleetCompare(fleet, inp.recent || [], vref, pid) : null;
const summary = [
  sc.length ? `Last 90 days: ${sc.length} landing${sc.length === 1 ? '' : 's'}, average ${avg}, ${sc.filter(s => s.stable).length} stable at 500 ft. ${T.slope == null ? T.label : `${T.label} (${T.slope > 0 ? '+' : ''}${T.slope} points a month)`}.` : '',
  F && F.aircraft >= 5 ? `Fleet: ${F.pctScore}th percentile of ${F.aircraft} SF50s on average score.` : '',
].filter(Boolean);

const landings = ev.filter(e => !e.ga), gas = ev.filter(e => e.ga);
const scored = landings.map(l => ({l, s: scoreLanding(l, vref)}));
let subject;
if (ev.length === 1) {
  const s = scoreLanding(ev[0], vref);
  subject = `${tail}: ${ev[0].apt || 'landing'}${ev[0].rwy ? ' ' + ev[0].rwy : ''} scored ${s.score} (${ev[0].ga ? 'go-around' : s.verdict})`;
} else {
  const best = scored.length ? Math.max(...scored.map(x => x.s.score)) : null;
  subject = `${tail}: ${landings.length} landing${landings.length === 1 ? '' : 's'}${gas.length ? `, ${gas.length} go-around${gas.length === 1 ? '' : 's'}` : ''} on ${day(ev[ev.length - 1].t)}${best != null ? `, best ${best}` : ''}`;
}

const html = `<!doctype html><html><body style="margin:0;background:#F5F7F6;font-family:-apple-system,'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F7F6"><tr><td align="center" style="padding:20px 12px">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid #D5DCE1"><tr><td style="padding:20px 22px">
<div style="font-size:13px;color:#4B5866;font-weight:600;letter-spacing:.04em">SCORE MY LANDING</div>
<div style="font-size:26px;font-weight:700;color:#17212C;margin-top:2px">${esc(tail)}</div>
<table width="100%" cellpadding="0" cellspacing="0">${blocks.join('')}</table>
${summary.length ? `<p style="margin:16px 0 0;font-size:14px;color:#17212C">${summary.map(esc).join('<br>')}</p>` : ''}
<p style="margin:16px 0 0;font-size:12px;color:#4B5866">Scored at Vref ${vref} from open ADS-B data, the morning after the flight. Speeds are estimated from groundspeed and wind, about ±5 kt. Use Owner unlock on the site to see airports and times.</p>
</td></tr></table></td></tr></table></body></html>`;
const text = `${tail}\n\n${lines.join('\n\n')}\n\n${summary.join('\n')}\n\nScored at Vref ${vref} from open ADS-B data. Speeds are estimated, about ±5 kt.`;
process.stdout.write(JSON.stringify({subject, html, text}));

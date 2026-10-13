// node tests/score.test.js
const assert = require('assert');
const {scoreLanding, insights, fleetCompare} = require('../site/score.js');

const gate = (o) => Object.assign({x: 1, r: 1, c: 0, hat: 500, gs: 90, ias: 85, vs: -600, trkdev: 0, gp: 0, ang: 3.0, t: -30, dtg: 1}, o);
const base = () => ({
  id: 'T-1', apt: 'KTST', rwy: '01', t: 1790000000, rlen: 6000, align: 6,
  wind: {dir: 10, spd: 5, gust: null, hw: 5, xw: 0}, sun: 30, ceil: 99999, vis: 10, airline: false, lowcov: false,
  gates: {'5nm': gate({hat: 1600}), '3nm': gate({hat: 950}), '1000ft': gate({hat: 1000}), '1nm': gate({hat: 320}), '500ft': gate({})},
  thr: gate({x: 0, hat: 50, ias: 83}), td: {ft: 900, float: 5, gs: 75}, stop: {ft: 3000, remain: 3000},
  prof: [], plan: [],
});

// a textbook approach scores 100 and is stable
let s = scoreLanding(base(), 81);
assert.strictEqual(s.score, 100); assert.strictEqual(s.stable, true); assert.strictEqual(s.verdict, 'Good');

// still turning at 500 ft is unstable and capped at 69
let L = base(); L.gates['500ft'].trkdev = 30;
s = scoreLanding(L, 81);
assert.strictEqual(s.stable, false); assert.ok(s.score <= 69); assert.strictEqual(s.verdict, 'Unstable');

// gusts raise the target speed
L = base(); L.wind = {dir: 10, spd: 12, gust: 22, hw: 12, xw: 0}; L.gates['500ft'].ias = 96;
s = scoreLanding(L, 81);
assert.strictEqual(s.va, 86); assert.ok(s.context.some(c => c.startsWith('Gusts')));

// sink over 1,000 fpm at 500 ft is unstable
L = base(); L.gates['500ft'].vs = -1200;
assert.strictEqual(scoreLanding(L, 81).stable, false);

// no 500 ft gate (coverage) does not crash and is not called stable
L = base(); delete L.gates['500ft'];
s = scoreLanding(L, 81); assert.strictEqual(s.stable, null);

// insights run on a mixed set
const set = [base(), Object.assign(base(), {id: 'T-2', align: 1})];
set[1].gates['500ft'].trkdev = 25;
const I = insights(set, 81, {});
assert.ok(I.out.find(o => o.h.startsWith('Tight visual patterns')));

// fleet percentile: a perfect pilot beats a fleet of unstable ones
const bad = base(); bad.gates['500ft'].trkdev = 30;
const badScore = scoreLanding(bad, 81).score;
const fleet = {vrefs: [80, 81, 82], aircraft: [0, 1, 2, 3, 4].map(k => ({pid: 'sf50-' + k, n: 5, s: [badScore, badScore, badScore], st: [0, 0, 0]}))};
const F = fleetCompare(fleet, [base(), base(), base()], 81, 'sf50-me');
assert.strictEqual(F.aircraft, 5); assert.strictEqual(F.pctScore, 100); assert.strictEqual(F.pctStable, 100);

// withheld airports and light category are handled
L = base(); L.apt = null; L.rwy = null; delete L.sun; L.light = 'night';
s = scoreLanding(L, 81); assert.ok(s.context.includes('Night landing.'));

console.log('score.js: all tests passed');

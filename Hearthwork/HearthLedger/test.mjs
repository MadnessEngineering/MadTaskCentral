// Smoke test, no deps:  node test.mjs
// Runs ledger.js plus the real Tasker JavaScriptlets (storage/reminder/ack) in vm contexts with
// global()/setGlobal() stubbed over one in-memory variable store, and a pinned clock.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const src = name => readFileSync(new URL(name, import.meta.url), 'utf8');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok  ' + name); };

// Local-time timestamps so quiet hours and 08:00 mornings line up in any TZ.
const at = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NOW = at(2026, 11, 24, 12, 0);

function ledger(now = NOW) {
  const ctx = vm.createContext({console});
  vm.runInContext(`Date.now = () => ${now};`, ctx);
  vm.runInContext(src('ledger.js'), ctx);
  return code => vm.runInContext(code, ctx);
}
// Run one JavaScriptlet with Tasker globals in `vars` and locals in `locals`; returns its context.
function tasker(file, vars, locals = {}, now = NOW) {
  const ctx = vm.createContext({
    global: k => (k in vars ? vars[k] : ''),
    setGlobal: (k, v) => { vars[k] = String(v); },
    ...locals,
  });
  vm.runInContext(`Date.now = () => ${now};`, ctx);
  vm.runInContext(src(file), ctx);
  return ctx;
}
const pack = t => encodeURIComponent(t).replace(/~/g, '%7E').replace(/%/g, '~');
const unpackReply = r => JSON.parse(decodeURIComponent(r.replace(/~/g, '%')));
const item = (o) => ({id: o.id || 'i' + Math.random().toString(36).slice(2, 7), tab: 'pantry', label: 'milk', due: NOW, every: null, ...o});
const book = items => JSON.stringify({version: 1, items, settings: {learned: {pantry: {}, chores: {}, bills: {}, meds: {}}}});

// ---- ledger.js ----
test('fresh ledger validates', () => {
  const L = ledger();
  assert.equal(L('validate(fresh()).version'), 1);
});
test('validate rejects bad tab, long label, bad repeat', () => {
  const L = ledger();
  for (const bad of [{tab: 'garage'}, {label: 'x'.repeat(61)}, {every: {n: 0, unit: 'd'}}, {every: {n: 2, unit: 'y'}}, {where: 'attic'}]) {
    assert.throws(() => L(`validate(${book([item(bad)])} )`), undefined, JSON.stringify(bad));
  }
});
test('validate allows a year out (no 30-day cap)', () => {
  const L = ledger();
  L(`validate(${book([item({tab: 'bills', label: 'car registration', due: NOW + 360 * 86400000})])})`);
});
test('date input becomes 08:00 local; a time overrides it', () => {
  const L = ledger();
  assert.equal(L(`dueFromInput('2026-11-28', '')`), at(2026, 11, 28, 8));
  assert.equal(L(`dueFromInput('2026-11-28', '21:30')`), at(2026, 11, 28, 21, 30));
  assert.equal(L(`dueFromInput('', '')`), null);
});
test('daily chore Done re-arms on the morning n days out', () => {
  const L = ledger();
  assert.equal(L(`nextDue({due: ${at(2026, 11, 20, 8)}, every: {n: 7, unit: 'd'}}, ${NOW})`), at(2026, 12, 1, 8));
});
test('hourly med re-arms from when it was taken', () => {
  const L = ledger();
  assert.equal(L(`nextDue({due: ${NOW - 3600000}, every: {n: 8, unit: 'h'}}, ${NOW})`), NOW + 8 * 3600000);
});
test('monthly bill advances from its due day, clamping and recovering the anchor', () => {
  const L = ledger();
  const feb = L(`nextDue({due: ${at(2027, 1, 31, 8)}, every: {n: 1, unit: 'mo'}, day: 31}, ${NOW})`);
  assert.equal(feb, at(2027, 2, 28, 8));
  assert.equal(L(`nextDue({due: ${feb}, every: {n: 1, unit: 'mo'}, day: 31}, ${NOW})`), at(2027, 3, 31, 8));
});
test('countdown text: weeks, days, overdue', () => {
  const L = ledger();
  assert.equal(L(`left(${NOW + 16 * 86400000})`), '2w 2d');
  assert.equal(L(`left(${NOW + 3 * 86400000 + 4 * 3600000})`), '3d 4h');
  assert.equal(L(`left(${NOW - 2 * 3600000 - 5 * 60000})`), 'due 2h 05m ago');
});
test('groups: overdue / soon per tab / later', () => {
  const L = ledger();
  const g = o => L(`groupOf(${JSON.stringify(o)}, ${NOW})`);
  assert.equal(g({tab: 'pantry', due: NOW - 1}), 'over');
  assert.equal(g({tab: 'pantry', due: NOW + 86400000}), 'soon');
  assert.equal(g({tab: 'pantry', due: NOW + 5 * 86400000}), 'later');
  assert.equal(g({tab: 'chores', due: at(2026, 11, 24, 20)}), 'soon');
  assert.equal(g({tab: 'chores', due: at(2026, 11, 25, 8)}), 'later');
  assert.equal(g({tab: 'bills', due: NOW + 6 * 86400000}), 'soon');
});
test('chips guess categories', () => {
  const L = ledger();
  assert.equal(L(`kindOf('pantry', 'greek yogurt')`), 'dairy');
  assert.equal(L(`kindOf('pantry', 'chicken thighs')`), 'meat');
  assert.equal(L(`kindOf('chores', 'trash night')`), 'trash');
  assert.equal(L(`kindOf('bills', 'electric')`), 'utility');
  assert.equal(L(`kindOf('meds', 'vitamin d')`), 'supp');
});
test('learned chip re-adds with the same shelf life and spot', () => {
  const L = ledger();
  L(`var s = fresh(); learn(s, {tab: 'pantry', label: 'milk', due: ${at(2026, 12, 1, 8)}, where: 'fridge', every: null}, ${NOW});`);
  assert.equal(L(`s.settings.learned.pantry.milk.days`), 7);
  const t = L(`fromLearned('pantry', 'milk', s.settings.learned.pantry.milk, ${at(2026, 12, 3, 19)})`);
  assert.equal(t.due, at(2026, 12, 10, 8));
  assert.equal(t.where, 'fridge');
});

// ---- storage.js ----
test('storage loads empty, saves, and refuses a stale save', () => {
  const vars = {};
  let ctx = tasker('storage.js', vars);
  assert.deepEqual(unpackReply(ctx.hl_reply), {ok: true, value: ''});
  const next = book([item({id: 'a'})]);
  ctx = tasker('storage.js', vars, {hl_request: pack(JSON.stringify({previous: '', next}))});
  assert.equal(unpackReply(ctx.hl_reply).value, next);
  assert.equal(vars.HearthLedger, next);
  ctx = tasker('storage.js', vars, {hl_request: pack(JSON.stringify({previous: '', next: book([])}))});
  const r = unpackReply(ctx.hl_reply);
  assert.equal(r.ok, false);
  assert.match(r.error, /changed elsewhere/);
  assert.equal(vars.HearthLedger, next);
});
test('storage rejects non-ledger data', () => {
  const vars = {};
  const ctx = tasker('storage.js', vars, {hl_request: pack(JSON.stringify({previous: '', next: '{"version":2,"items":[]}'}))});
  assert.equal(unpackReply(ctx.hl_reply).ok, false);
});
test('a literal Tasker variable name in the request reads as unset', () => {
  const ctx = tasker('storage.js', {}, {hl_request: '%hl_request'});
  assert.deepEqual(unpackReply(ctx.hl_reply), {ok: true, value: ''});
});

// ---- reminder.js + ack.js ----
function remind(vars, now = NOW) {
  const r = tasker('reminder.js', vars, {}, now);
  if (r.hl_notify === 'yes') tasker('ack.js', vars, {hl_ids: r.hl_ids}, now);
  return r;
}
test('due items batch into one notification; later item sets the next wake', () => {
  const vars = {HearthLedger: book([
    item({id: 'a', label: 'milk', due: NOW - 60000}),
    item({id: 'b', tab: 'bills', label: 'electric', due: NOW + 30000}),
    item({id: 'c', label: 'eggs', due: at(2026, 11, 26, 8)}),
  ])};
  const r = remind(vars);
  assert.equal(r.hl_notify, 'yes');
  assert.match(r.hl_title, /^Hearth Ledger: 2 due/);
  assert.equal(r.hl_text, 'Pantry — milk\nBills — electric');
  assert.equal(vars.HearthLedgerNext, String(at(2026, 11, 26, 8) / 1000));
  assert.equal(remind(vars).hl_notify, 'no', 'announced items stay quiet');
});
test('quiet hours defer to 08:00 and do not ack', () => {
  const night = at(2026, 11, 24, 23, 0);
  const vars = {HearthLedger: book([item({id: 'a', due: night - 60000})])};
  const r = remind(vars, night);
  assert.equal(r.hl_notify, 'no');
  assert.equal(vars.HearthLedgerNext, String(at(2026, 11, 25, 8) / 1000));
  assert.equal(remind(vars, at(2026, 11, 25, 8)).hl_notify, 'yes');
});
test('a repeating item alerts again after Done (seen keyed by id@due)', () => {
  const vars = {HearthLedger: book([item({id: 'w', tab: 'chores', label: 'water plants', due: NOW - 60000, every: {n: 7, unit: 'd'}})])};
  assert.equal(remind(vars).hl_notify, 'yes');
  const L = ledger();
  const s = JSON.parse(vars.HearthLedger);
  s.items[0].due = L(`nextDue(${JSON.stringify(s.items[0])}, ${NOW})`);
  vars.HearthLedger = JSON.stringify(s);
  assert.equal(remind(vars).hl_notify, 'no', 'not due yet');
  const r = remind(vars, at(2026, 12, 1, 8));
  assert.equal(r.hl_notify, 'yes');
  assert.equal(r.hl_text, 'Chores — water plants');
  assert.deepEqual(JSON.parse(vars.HearthLedgerSeen), ['w@' + at(2026, 12, 1, 8)], 'old key pruned');
});
test('nothing pending turns the Due profile off', () => {
  const vars = {HearthLedger: book([])};
  remind(vars);
  assert.equal(vars.HearthLedgerNext, 'off');
});

// ---- import.js ----
function importRun(vars, items, now = NOW) {
  const ctx = vm.createContext({
    global: k => (k in vars ? vars[k] : ''), setGlobal: (k, v) => { vars[k] = String(v); },
    par1: pack(JSON.stringify({items})), window: {},
  });
  vm.runInContext(`Date.now = () => ${now};`, ctx);
  vm.runInContext(src('import.js').replace('/*LEDGER_JS*/', src('ledger.js')), ctx);
  return ctx.hl_reply;
}
test('import adds dated items at 08:00, learns chips, and skips repeats', () => {
  const vars = {HearthLedger: book([item({id: 'm', label: 'milk', due: at(2026, 12, 8, 8)})])};
  const batch = [
    {label: 'Garden Salad Blend', use_by: '2026-11-28'},
    {label: 'cabot habanero cheddar', use_by: '2027-05-14', where: 'fridge'},
    {label: 'pistachio & berries', days: 120, where: 'pantry'},
    {label: 'milk', use_by: '2026-12-08'},
  ];
  assert.match(importRun(vars, batch), /^added 3 .*; skipped 1 already there \(milk\)$/);
  const s = JSON.parse(vars.HearthLedger);
  const salad = s.items.find(t => t.label === 'garden salad blend');
  assert.equal(salad.due, at(2026, 11, 28, 8));
  assert.equal(salad.where, 'fridge', 'pantry items default to the fridge');
  assert.equal(s.items.find(t => t.label === 'pistachio & berries').due, at(2027, 3, 24, 8));
  assert.equal(s.settings.learned.pantry['cabot habanero cheddar'].where, 'fridge');
  assert.match(importRun(vars, batch), /^added 0; skipped 4/, 'same batch again changes nothing');
});
test('import rejects a bad date without saving anything', () => {
  const vars = {HearthLedger: book([])};
  assert.match(importRun(vars, [{label: 'eggs', use_by: '2026-11-28'}, {label: 'x', use_by: 'Nov 28'}]), /^error: Bad date for x/);
  assert.equal(JSON.parse(vars.HearthLedger).items.length, 0);
});
test('chips: cheeses are dairy, pepperoni is meat, trail mix is a snack', () => {
  const L = ledger();
  assert.equal(L(`kindOf('pantry', 'cabot habanero cheddar')`), 'dairy');
  assert.equal(L(`kindOf('pantry', 'mozzarella shredded')`), 'dairy');
  assert.equal(L(`kindOf('pantry', 'good & gather colby jack')`), 'dairy');
  assert.equal(L(`kindOf('pantry', 'hormel pepperoni')`), 'meat');
  assert.equal(L(`kindOf('pantry', 'pistachio & berries')`), 'snack');
  assert.equal(L(`kindOf('pantry', 'garden salad blend')`), 'produce');
});

// ---- scene.html ----
test('scene script parses with the ledger inlined', () => {
  const html = src('scene.html').replace('/*LEDGER_JS*/', src('ledger.js'));
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  new vm.Script(script);
});

console.log(`\n${passed} passed`);

// Shared model for scene.html (build.py inlines it at the LEDGER_JS marker) and test.mjs.
// Ledger v1 lives in the Tasker global HearthLedger as JSON; storage goes through the
// Hearth Ledger Storage task (compare-and-set), never Tasker.setVariable.
// Same engine as Ludomancery/FrostLedger/ledger.js, retuned from game minutes to life days.
const STORAGE_TASK = 'Hearth Ledger Storage';
const REMINDER_TASK = 'Hearth Ledger Reminder';
const BRIDGE_WAIT = 8000;
const MORNING = 8;  // date-only items fall due at 08:00 local, right as quiet hours end
const DAY = 86400000;
const TABS = ['pantry', 'chores', 'bills', 'meds'];
const UNITS = ['h', 'd', 'mo'];
const WHERES = ['fridge', 'freezer', 'pantry'];
// done: the button that finishes an item. first: default first due for the add form.
// every: default repeat. soon(due, now): true when the row belongs in the Soon group.
const TAB = {
  pantry: {name: 'Pantry', done: 'Used', every: null, first: {n: 7, unit: 'd'}, soon: (due, now) => due - now <= 2 * DAY},
  chores: {name: 'Chores', done: 'Done', every: {n: 7, unit: 'd'}, first: {n: 0, unit: 'd'}, soon: (due, now) => due < startOfDay(now) + DAY},
  bills: {name: 'Bills', done: 'Paid', every: {n: 1, unit: 'mo'}, first: {n: 1, unit: 'mo'}, soon: (due, now) => due - now <= 7 * DAY},
  meds: {name: 'Meds', done: 'Taken', every: {n: 1, unit: 'd'}, first: {n: 0, unit: 'd'}, soon: (due, now) => due < startOfDay(now) + DAY},
};

const fresh = () => ({version: 1, items: [], settings: {learned: {pantry: {}, chores: {}, bills: {}, meds: {}}}});
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

function migrate(s) {
  if (!s) return s;
  if (s.version !== 1) throw Error('Unknown ledger version');
  return s;
}

function validEvery(e) {
  return e === null || (e && Number.isInteger(e.n) && e.n >= 1 && e.n <= 365 && UNITS.includes(e.unit));
}
function validate(s) {
  if (!s || s.version !== 1 || !Array.isArray(s.items) || !s.settings) throw Error('Invalid ledger data');
  const ids = new Set();
  for (const t of s.items) {
    if (typeof t.id !== 'string' || ids.has(t.id) || !TABS.includes(t.tab) || typeof t.label !== 'string' || !t.label || t.label.length > 60 ||
        !Number.isFinite(t.due)) throw Error('Invalid item');
    if (t.every === undefined) t.every = null;
    if (!validEvery(t.every)) throw Error('Repeat must be 1–365 hours, days or months');
    if (t.where != null && !WHERES.includes(t.where)) throw Error('Invalid storage spot');
    if (t.day != null && !(Number.isInteger(t.day) && t.day >= 1 && t.day <= 31)) throw Error('Invalid bill day');
    ids.add(t.id);
  }
  const st = s.settings;
  if (!st.learned || typeof st.learned !== 'object') st.learned = {};
  for (const tab of TABS) if (!st.learned[tab] || typeof st.learned[tab] !== 'object') st.learned[tab] = {};
  return s;
}

// ---- Tasker bridge ----
const pack = text => encodeURIComponent(text).replace(/~/g, '%7E').replace(/%/g, '~');
const unpack = text => decodeURIComponent(text.replace(/~/g, '%'));
async function waitForBridge(ms) {
  const cutoff = Date.now() + ms;
  while (typeof (window.Tasker && window.Tasker.runTaskForResult) !== 'function' && Date.now() < cutoff) {
    await new Promise(r => setTimeout(r, 100));
  }
  if (typeof (window.Tasker && window.Tasker.runTaskForResult) !== 'function') throw Error('No Tasker bridge. Open this with Hearth Ledger Open.');
}
async function storage(request) {
  const variables = request ? {hl_request: pack(JSON.stringify(request))} : {};
  const result = await window.Tasker.runTaskForResult({name: STORAGE_TASK, task: STORAGE_TASK, variables, timeoutMs: BRIDGE_WAIT});
  const rv = result && result.returnValue;
  if (typeof rv !== 'string' || !rv) throw Error('Tasker storage returned nothing.');
  const reply = JSON.parse(unpack(rv));
  if (!reply.ok) throw Error(reply.error);
  return reply.value;
}
async function runTask(name) {
  try { await window.Tasker.runTask({name, task: name}); return true; } catch (_) { return false; }
}
// Load + migrate. Returns {raw, state}; state is null when the saved data is unreadable.
async function loadLedger() {
  const raw = await storage();
  if (raw === '') return {raw, state: fresh()};
  try { return {raw, state: validate(migrate(JSON.parse(raw)))}; } catch (_) { return {raw, state: null}; }
}

// ---- time ----
const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
const clock = ms => new Date(ms).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
function startOfDay(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }
function morningOf(ms) { const d = new Date(ms); d.setHours(MORNING, 0, 0, 0); return d.getTime(); }
const isMorning = ms => { const d = new Date(ms); return d.getHours() === MORNING && d.getMinutes() === 0; };
// Calendar days, not 24h steps, so a DST change can't shift the 08:00 due time.
function addDays(ms, n) { const d = new Date(ms); d.setDate(d.getDate() + n); return d.getTime(); }
// Month steps keep the anchor day where the month has it: Jan 31 -> Feb 28 -> Mar 31.
function addMonths(ms, n, anchor) {
  const d = new Date(ms), day = anchor || d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes());
  t.setDate(Math.min(day, new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate()));
  return t.getTime();
}
// `every` later than `from`, same time of day (used to push an item back).
function plus(every, from) {
  if (every.unit === 'h') return from + every.n * 3600000;
  if (every.unit === 'd') return addDays(from, every.n);
  return addMonths(from, every.n);
}
// Same, but date-only steps land on the morning (used for new items).
const after = (every, from) => every.unit === 'h' ? plus(every, from) : morningOf(plus(every, from));
// Next due after finishing a repeating item at `now`. Hours and days count from when it was
// done; months count from the old due date (a bill paid late is still due on its day).
function nextDue(t, now) {
  const e = t.every;
  if (e.unit === 'h') return now + e.n * 3600000;
  if (e.unit === 'd') return morningOf(addDays(now, e.n));
  return addMonths(t.due, e.n, t.day || new Date(t.due).getDate());
}
// <input type=date> gives YYYY-MM-DD, <input type=time> HH:MM (blank = morning).
function dueFromInput(date, time) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || '');
  if (!m) return null;
  const tm = /^(\d{2}):(\d{2})$/.exec(time || '');
  return new Date(+m[1], +m[2] - 1, +m[3], tm ? +tm[1] : MORNING, tm ? +tm[2] : 0).getTime();
}
const pad = n => String(n).padStart(2, '0');
function dateInput(ms) { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function when(ms, now = Date.now()) {
  const day = Math.round((startOfDay(ms) - startOfDay(now)) / DAY);
  const name = day === 0 ? 'Today' : day === 1 ? 'Tomorrow' : day === -1 ? 'Yesterday'
    : new Date(ms).toLocaleDateString([], {weekday: 'short', month: 'short', day: 'numeric'});
  return isMorning(ms) ? name : name + ' ' + clock(ms);
}
function span(sec) {
  const m = Math.floor(sec / 60);
  if (m >= 20160) return Math.floor(m / 10080) + 'w ' + Math.floor(m % 10080 / 1440) + 'd';
  if (m >= 2880) return Math.floor(m / 1440) + 'd ' + Math.floor(m % 1440 / 60) + 'h';
  if (m >= 60) return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
  return m + 'm ' + String(sec % 60).padStart(2, '0') + 's';
}
function left(due, now = Date.now()) {
  const s = Math.round((due - now) / 1000);
  return s > 0 ? span(s) : 'due ' + span(-s) + ' ago';
}
const everyText = e => e ? 'every ' + (e.n === 1 ? '' : e.n + ' ') + ({h: 'hour', d: 'day', mo: 'month'})[e.unit] + (e.n === 1 ? '' : 's') : '';
// 'over' | 'soon' | 'later' — the row's group in its tab.
const groupOf = (t, now) => t.due <= now ? 'over' : TAB[t.tab].soon(t.due, now) ? 'soon' : 'later';

function kindOf(tab, label) {
  const l = label;
  if (tab === 'pantry') {
    // Order matters: 'habanero cheddar' is dairy before produce's pepper; 'pepperoni' is meat;
    // 'pistachio & berries' is a snack, not produce (lessons from the first fridge import).
    return /milk|cheese|cheddar|mozzarella|colby|jack\b|parmesan|swiss|provolone|gouda|brie|feta|ricotta|yogurt|yoghurt|butter|cream|egg/.test(l) ? 'dairy'
      : /chicken|beef|pork|steak|turkey|fish|salmon|shrimp|bacon|sausage|pepperoni|salami|ham|meat/.test(l) ? 'meat'
      : /left ?over|soup|chili|pasta|rice|curry|takeout/.test(l) ? 'leftover'
      : /bread|bun|bagel|tortilla|roll|muffin/.test(l) ? 'bread'
      : /pistachio|almond|cashew|peanut|nut\b|nuts|trail mix|chip|cracker|pretzel|granola|cookie|candy|snack/.test(l) ? 'snack'
      : /lettuce|salad|spinach|apple|banana|berr|tomato|onion|pepper|avocado|carrot|potato|fruit|veg|herb|cilantro|lemon|lime/.test(l) ? 'produce'
      : 'other';
  }
  if (tab === 'chores') {
    return /dish|kitchen|fridge|oven|stove|counter|sink/.test(l) ? 'kitchen'
      : /bath|toilet|shower|tub/.test(l) ? 'bath'
      : /laundry|sheet|towel|wash|bed/.test(l) ? 'laundry'
      : /plant|water|garden|lawn|mow|yard/.test(l) ? 'plants'
      : /trash|garbage|recycl|bin|compost/.test(l) ? 'trash'
      : /filter|smoke|battery|hvac|furnace/.test(l) ? 'upkeep'
      : 'other';
  }
  if (tab === 'bills') {
    return /rent|mortgage/.test(l) ? 'rent'
      : /electric|power|gas|water|internet|phone|utility|sewer/.test(l) ? 'utility'
      : /netflix|spotify|hulu|disney|youtube|prime|sub|patreon|claude|github|icloud/.test(l) ? 'sub'
      : /insur/.test(l) ? 'insurance'
      : /car|registration|plate|license|inspection/.test(l) ? 'car'
      : /card|loan/.test(l) ? 'credit'
      : 'other';
  }
  return /vitamin|supp|fish oil|magnesium|zinc|iron|probiotic|creatine/.test(l) ? 'supp'
    : /refill|pharmacy/.test(l) ? 'refill' : 'rx';
}

// Learned chips: what you add once comes back as a one-tap button with the same shelf life,
// spot and repeat. Stored per tab as {label: {count, days, where, every}}.
function learn(state, t, now) {
  const book = state.settings.learned[t.tab];
  const prev = book[t.label] || {count: 0};
  book[t.label] = {count: prev.count + 1, days: Math.max(0, Math.round((startOfDay(t.due) - startOfDay(now)) / DAY)),
    where: t.where || null, every: t.every || null};
}
// The item a learned chip adds right now.
function fromLearned(tab, label, rec, now) {
  const due = rec.every && rec.every.unit === 'h' && !rec.days ? now + rec.every.n * 3600000 : morningOf(addDays(now, rec.days || 0));
  const t = {id: uid(), tab, label, due, every: rec.every || null};
  if (tab === 'pantry') t.where = rec.where || 'fridge';
  if (t.every && t.every.unit === 'mo') t.day = new Date(due).getDate();
  return t;
}

// Hearth Ledger Reminder — Tasker JavaScriptlet. Run by the Due profile (at
// HearthLedgerNext), the Poll profile, and the scene after each save.
// Everything due and not yet announced goes into ONE notification; keys are
// only marked announced by the ack step after Notify succeeds.
// Announced keys are "id@due", not the id: a chore marked Done keeps its id but
// gets a new due, and must be able to alert again.
// Quiet hours 22:00-08:00 local: nothing is announced, nothing is acked, and
// the next wake is moved to 08:00 so deferred items go out then.
var hl_notify = 'no';
var hl_title = '';
var hl_text = '';
var hl_ids = '[]';
var QUIET_FROM = 22, QUIET_TO = 8;
// Items due within this window ride along in the same notification.
var BATCH_MS = 60000;
var NAMES = { pantry: 'Pantry', chores: 'Chores', bills: 'Bills', meds: 'Meds' };
function unset(v) {
  return v === undefined || v === null || v === '' || v === 'undefined' || /^%\w+$/.test(v);
}
function quietAt(ms) {
  var h = new Date(ms).getHours();
  return h >= QUIET_FROM || h < QUIET_TO;
}
function quietEnd(ms) {
  var d = new Date(ms);
  if (d.getHours() >= QUIET_FROM) d.setDate(d.getDate() + 1);
  d.setHours(QUIET_TO, 0, 0, 0);
  return d.getTime();
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function key(t) { return t.id + '@' + t.due; }
try {
  var raw = global('HearthLedger');
  var data = unset(raw) ? {} : JSON.parse(raw);
  var seen;
  try { seen = JSON.parse(global('HearthLedgerSeen') || '[]'); } catch (e) { seen = []; }
  if (!Array.isArray(seen)) seen = [];
  var now = Date.now();
  var items = Array.isArray(data.items) ? data.items : [];
  var fresh = items.filter(function (t) { return isFinite(t.due) && seen.indexOf(key(t)) < 0; });
  var due = fresh.filter(function (t) { return t.due <= now + BATCH_MS; })
    .sort(function (a, b) { return a.due - b.due; });
  var quiet = quietAt(now);
  if (due.length && !quiet) {
    hl_notify = 'yes';
    var when = new Date(now);
    hl_title = 'Hearth Ledger: ' + due.length + ' due · ' + pad(when.getHours()) + ':' + pad(when.getMinutes());
    hl_text = due.map(function (t) { return (NAMES[t.tab] || 'Item') + ' — ' + t.label; }).join('\n');
    hl_ids = JSON.stringify(due.map(key));
  }
  // Next wake: the soonest deadline not covered by this run, or quiet-hours end when something is waiting.
  var next = Infinity;
  fresh.forEach(function (t) { if (t.due > now + BATCH_MS && t.due < next) next = t.due; });
  if (due.length && quiet) next = Math.min(next, quietEnd(now));
  if (next !== Infinity && quietAt(next)) next = quietEnd(next);
  // Epoch seconds, rounded up to the next whole minute (Time contexts are minute-grained).
  setGlobal('HearthLedgerNext', next === Infinity ? 'off' : String(Math.ceil(next / 60000) * 60));
} catch (e) {
  hl_notify = 'no';
}

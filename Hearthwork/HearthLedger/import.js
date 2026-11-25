// Hearth Ledger Import — Tasker JavaScriptlet. Adds items from outside the scene, e.g. a grocery
// order read off a screenshot and sent with:
//   dgm tasker "Hearth Ledger Import" par1=<packed JSON> --wait 10
// par1 is packed like the scene's storage requests (URI-encoded, every percent sign as "~") and
// holds {items:[{tab?, label, use_by? 'YYYY-MM-DD' | days?, where?, every?}]}.
// tab defaults to pantry; date-only items fall due at 08:00 like the scene's. An item whose
// tab + label + due day already exists is skipped, so re-sending the same order is harmless.
// Every added label also teaches its learned chip, the same as adding it in the scene.
// hl_reply is a short plain-text summary (DGM Dispatch writes it into JSON unescaped).
var hl_reply = '';
function unset(v) {
  return v === undefined || v === null || v === '' || v === 'undefined' || /^%\w+$/.test(v);
}
/*LEDGER_JS*/
try {
  if (typeof par1 !== 'string' || unset(par1)) throw Error('par1 is empty');
  var req = JSON.parse(decodeURIComponent(par1.replace(/~/g, '%')));
  var raw = global('HearthLedger');
  var state = unset(raw) ? fresh() : validate(migrate(JSON.parse(raw)));
  var now = Date.now(), added = [], skipped = [];
  (req.items || []).forEach(function (x) {
    var tab = x.tab || 'pantry', label = norm(x.label);
    if (!TABS.includes(tab) || !label) throw Error('Bad item: ' + JSON.stringify(x));
    var due = x.use_by ? dueFromInput(x.use_by, x.time || '') : morningOf(addDays(now, Number(x.days) || 0));
    if (due == null) throw Error('Bad date for ' + label + ': ' + x.use_by);
    var day = startOfDay(due);
    if (state.items.some(function (t) { return t.tab === tab && t.label === label && startOfDay(t.due) === day; })) { skipped.push(label); return; }
    var t = {id: uid(), tab: tab, label: label, due: due, every: x.every || null};
    if (tab === 'pantry') t.where = WHERES.includes(x.where) ? x.where : 'fridge';
    if (t.every && t.every.unit === 'mo') t.day = new Date(due).getDate();
    state.items.push(t);
    learn(state, t, now);
    added.push(label);
  });
  validate(state);
  if (added.length) {
    var next = JSON.stringify(state);
    setGlobal('HearthLedger', next);
    if (global('HearthLedger') !== next) throw Error('Tasker could not verify the save.');
  }
  hl_reply = 'added ' + added.length + (added.length ? ' (' + added.join(', ') + ')' : '') +
    (skipped.length ? '; skipped ' + skipped.length + ' already there (' + skipped.join(', ') + ')' : '');
} catch (e) {
  hl_reply = 'error: ' + (e.message || e);
}

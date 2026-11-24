// Hearth Ledger Reminder, step 2 — runs only after Notify succeeded. Marks the
// announced id@due keys and drops keys that no longer match a live item (done,
// deleted, or moved to a new due).
var seen;
try { seen = JSON.parse(global('HearthLedgerSeen') || '[]'); } catch (e) { seen = []; }
if (!Array.isArray(seen)) seen = [];
var live = [];
try { live = JSON.parse(global('HearthLedger')).items.map(function (t) { return t.id + '@' + t.due; }); } catch (e) {}
var merged = seen.concat(JSON.parse(hl_ids)).filter(function (k, i, all) {
  return all.indexOf(k) === i && live.indexOf(k) >= 0;
});
setGlobal('HearthLedgerSeen', JSON.stringify(merged));

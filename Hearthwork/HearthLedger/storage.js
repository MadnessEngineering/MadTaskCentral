// Hearth Ledger Storage — Tasker JavaScriptlet. The scene calls this through
// Tasker.runTaskForResult with hl_request (packed {previous, next}) to save, or
// with no request to load. The next action returns hl_reply, packed the same way.
// Packing turns every percent sign into "~" so Tasker never expands a variable
// inside the payload. Cloned from Ludomancery/FrostLedger/storage.js.
var hl_reply = '';
function packReply(reply) {
  return encodeURIComponent(JSON.stringify(reply)).replace(/~/g, '%7E').replace(/%/g, '~');
}
function unset(v) {
  return v === undefined || v === null || v === '' || v === 'undefined' || /^%\w+$/.test(v);
}
try {
  var current = global('HearthLedger');
  if (unset(current)) current = '';
  var req = typeof hl_request === 'string' && !unset(hl_request) ? hl_request : '';
  if (req) {
    var r = JSON.parse(decodeURIComponent(req.replace(/~/g, '%')));
    // Compare-and-set: refuse a save built on data that changed under us.
    if (current !== r.previous && current !== r.next) {
      throw Error('The ledger changed elsewhere. Close and reopen Hearth Ledger.');
    }
    var d = JSON.parse(r.next);
    if (d.version !== 1 || !Array.isArray(d.items) || !d.settings) {
      throw Error('Invalid ledger data.');
    }
    if (current !== r.next) setGlobal('HearthLedger', r.next);
    current = global('HearthLedger');
    if (current !== r.next) throw Error('Tasker could not verify the save.');
  }
  hl_reply = packReply({ ok: true, value: current });
} catch (e) {
  hl_reply = packReply({ ok: false, error: e.message || 'Could not reach Tasker storage.' });
}

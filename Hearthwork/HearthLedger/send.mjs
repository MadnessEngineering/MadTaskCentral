// Send a batch of items to the phone through the Hearth Ledger Import task.
//   node HearthLedger/send.mjs batches/x.json --dry LEDGER.json   # run import.js here against a copy
//   node HearthLedger/send.mjs batches/x.json                     # dgm tasker "Hearth Ledger Import" -p par1=…
// A batch is {items:[{tab?, label, use_by? | days?, where?, every?, note?}]}; notes stay on this
// side (they record how a date was read) and are not sent.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';

const here = new URL('.', import.meta.url);
const [file, flag, ledgerFile] = process.argv.slice(2);
if (!file) { console.error('usage: send.mjs BATCH.json [--dry LEDGER.json]'); process.exit(2); }
const batch = JSON.parse(readFileSync(file, 'utf8'));
const items = batch.items.map(({note, ...x}) => x);
const pack = t => encodeURIComponent(t).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase()).replace(/~/g, '%7E').replace(/%/g, '~');
const par1 = pack(JSON.stringify({items}));

if (flag === '--dry') {
  const vars = {HearthLedger: ledgerFile ? readFileSync(ledgerFile, 'utf8').trim() : ''};
  const ctx = vm.createContext({global: k => vars[k], setGlobal: (k, v) => { vars[k] = String(v); }, par1, window: {}});
  const src = readFileSync(new URL('import.js', here), 'utf8').replace('/*LEDGER_JS*/', readFileSync(new URL('ledger.js', here), 'utf8'));
  vm.runInContext(src, ctx);
  console.log(ctx.hl_reply);
  const s = JSON.parse(vars.HearthLedger || '{"items":[]}');
  vm.runInContext('var __s = ' + JSON.stringify(s), ctx);
  for (const t of s.items.slice().sort((a, b) => a.due - b.due)) {
    console.log(`  ${t.tab.padEnd(7)} ${vm.runInContext(`kindOf(${JSON.stringify(t.tab)}, ${JSON.stringify(t.label)})`, ctx).padEnd(9)} ${(t.where || '').padEnd(8)} ${new Date(t.due).toDateString()}  ${t.label}`);
  }
} else {
  const dgm = new URL('../../../mobile/Digitomancy/', here).pathname;
  const out = execFileSync('uv', ['run', 'dgm', ...(process.env.DGM_DEVICE ? ['-d', process.env.DGM_DEVICE] : []),
    'tasker', 'Hearth Ledger Import', '-p', 'par1=' + par1, '--wait', '20'], {cwd: dgm, encoding: 'utf8'});
  console.log(out);
}

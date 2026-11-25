# Hearthwork

Tasker projects for the house, not the game. The household counterpart to Ludomancery.

## Hearth Ledger

Life timers: pantry use-by dates, chores, bills and meds, built on the same engine as
Ludomancery's Frost Ledger. It is one HTML page in a Tasker 6.7.9 Scene V2 WebView that talks to
Tasker through the JS bridge. Data is JSON in the global `%HearthLedger`.

- **Tabs:** Pantry, Chores, Bills and Meds. Rows are grouped Overdue / Soon / Later, each with a
  category chip and a live countdown, and overdue rows show in red.
- **Done / Used / Paid / Taken:** a repeating item re-arms. Hours and days count from when you
  finish it; months count from the old due day, so a bill paid late is still due on its day. A
  one-off item leaves the ledger.
- **Learned chips:** anything you add once comes back as a chip. Tap it to add it again with the
  same shelf life and storage spot, or hold it to tweak the item first.
- **Alerts:** one batched notification when items come due. Quiet hours run 22:00–08:00, and
  anything due then is announced at 08:00. Date-only items fall due at 08:00.

```
python3 HearthLedger/build.py     # writes Hearth_Ledger.prj.xml
node HearthLedger/test.mjs        # smoke test: ledger.js + the real storage/reminder/ack JavaScriptlets
cd ../../mobile/Digitomancy && uv run dgm tasker-sync push "Hearth Ledger" --yes
```
Open it with the **Hearth Ledger Open** task.

**Importing from outside the scene** (e.g. dates read off grocery photos):
```
node HearthLedger/send.mjs batches/2026-11-25-fridge.json --dry LEDGER.json   # preview against a copy
node HearthLedger/send.mjs batches/2026-11-25-fridge.json                     # dgm tasker "Hearth Ledger Import"
```
A batch is `{items:[{tab?, label, use_by: "YYYY-MM-DD" | days, where?, every?, note?}]}`.
Notes record how each date was read and are not sent. An item whose tab, label and due day are
already in the ledger is skipped, so sending the same batch again is safe. `batches/` is
gitignored because it holds copies of the phone ledger.

Sources live in `HearthLedger/`: `scene.html` (UI), `ledger.js` (model, inlined into the page),
`storage.js` (compare-and-set save), `reminder.js` + `ack.js` (notifications), and `build.py`.
`build.py` refuses any `%word` in the page sources, because the bridge WebView would expand it.

### Status
- Verified locally: the build runs and the smoke test passes. The page also renders, adds items
  and re-arms chores in headless Chrome against a mock bridge that runs the real `storage.js`.
- Verified on the phone (2026-11-25, read via `dgm var`): items saved from the scene, and a due chore
  notified; `HearthLedgerSeen` holds its key, which ack only writes after Notify succeeds.
- Not yet verified on the phone: the Import task (needs the 2026-11-25 build imported).
- Imported on the Pixel 2026-11-24; task/profile ids in build.py match what the phone assigned.

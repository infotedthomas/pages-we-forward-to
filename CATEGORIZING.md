# Categorizing pages — persistence & sync

Categorization is stored in a shared **Supabase** table (`categorization_state`,
single row `id=1`) and synced live between everyone with the page open. You just
drag cards into folders; saving and syncing happen automatically.

## How it works

- Every change auto-saves locally and upserts the shared state to Supabase
  (debounced ~1.5s). The toolbar shows the sync status (● Synced / ↻ Syncing /
  ✕ Sync error / ○ Local only).
- On load, the page pulls the shared state; while open, it receives teammates'
  changes in real time.

## Non-destructive merge (the hardening)

The shared state is **merged**, never blindly overwritten. Each assignment and
folder carries a timestamp; deletions leave tombstones. On any sync (load or a
live update from a teammate):

- Per card/folder, the **newest edit wins** (last-writer-wins).
- Two people categorizing **different** cards → both kept.
- Two people editing the **same** card → newest wins; the other isn't silently
  lost mid-session.
- An older or partial remote state can **never wipe** a richer local one; if your
  copy has work the sender lacked, the union is pushed back so it propagates.

This converges (no sync loop) because the propagate-back check compares states by
value, ignoring timestamps.

## Backups

`backups/categorization-backup-YYYY-MM-DD.json` holds point-in-time snapshots of
the full state (schema v4). Because the page writes to Supabase with the public
anon key, keeping these backups means any accidental/malicious wipe is
recoverable. To regenerate a backup from a WordPress `Export xlsx`, see
`seed-from-xlsx.mjs` in the project root.

## Tools

- `merge-states.mjs` — combine multiple JSON snapshots/backups offline with the
  exact same last-writer-wins algorithm the page uses:
  ```bash
  node merge-states.mjs --out merged.json backups/*.json other-export.json
  ```

## Schema (v4)

```jsonc
{
  "schemaVersion": 4,
  "folders": [{ "id", "name", "parentId", "expanded" }],
  "cardAssignments":      { "<cardId>": "<folderId>" },
  "shortLinkAssignments": { "<redirectId>": "<folderId>" },
  "ts":         { "card": {…}, "sl": {…}, "folder": {…} },   // per-key timestamps
  "tombstones": { "card": {…}, "sl": {…}, "folder": {…} },   // deletions
  "clientId": "c-xxxxxxxx"
}
```

#!/usr/bin/env node
// Combine multiple categorization exports (pwft-state-*.json) into one state.json.
// Non-destructive last-writer-wins-per-key merge with deletion tombstones — the
// SAME algorithm the page uses on load, so committing the result is safe even
// when several people categorized in parallel.
//
// Usage:
//   node merge-states.mjs state.json pwft-state-A.json pwft-state-B.json ...
//   node merge-states.mjs --out state.json *.json
// Files are merged left-to-right; result written to --out (default: state.json).

import fs from 'fs';

const UNCAT_ID = 'f-uncat';

function defaultState() {
  return {
    schemaVersion: 4,
    folders: [{ id: UNCAT_ID, name: 'Uncategorized', parentId: null, expanded: true }],
    cardAssignments: {}, shortLinkAssignments: {},
    ts: { card: {}, sl: {}, folder: { [UNCAT_ID]: 0 } },
    tombstones: { card: {}, sl: {}, folder: {} },
    clientId: 'c-merge',
  };
}

function normalizeState(s) {
  if (!s || typeof s !== 'object') return defaultState();
  s.folders = Array.isArray(s.folders) ? s.folders : [];
  s.cardAssignments = s.cardAssignments || {};
  s.shortLinkAssignments = s.shortLinkAssignments || {};
  s.ts = s.ts || {}; s.ts.card = s.ts.card || {}; s.ts.sl = s.ts.sl || {}; s.ts.folder = s.ts.folder || {};
  s.tombstones = s.tombstones || {}; s.tombstones.card = s.tombstones.card || {}; s.tombstones.sl = s.tombstones.sl || {}; s.tombstones.folder = s.tombstones.folder || {};
  if (s.schemaVersion !== 4) {
    const t = Date.now();
    Object.keys(s.cardAssignments).forEach(k => { if (s.ts.card[k] == null) s.ts.card[k] = t; });
    Object.keys(s.shortLinkAssignments).forEach(k => { if (s.ts.sl[k] == null) s.ts.sl[k] = t; });
    s.folders.forEach(f => { if (s.ts.folder[f.id] == null) s.ts.folder[f.id] = (f.id === UNCAT_ID ? 0 : t); });
  }
  if (!s.folders.some(f => f.id === UNCAT_ID)) {
    s.folders.unshift({ id: UNCAT_ID, name: 'Uncategorized', parentId: null, expanded: true });
    s.ts.folder[UNCAT_ID] = 0;
  }
  s.clientId = s.clientId || 'c-merge';
  s.schemaVersion = 4;
  return s;
}

// IMPORTANT: keep this byte-for-byte equivalent to mergeStates() in index.html.
function mergeStates(a, b) {
  a = normalizeState(a); b = normalizeState(b);
  const out = {
    schemaVersion: 4, folders: [], cardAssignments: {}, shortLinkAssignments: {},
    ts: { card: {}, sl: {}, folder: {} }, tombstones: { card: {}, sl: {}, folder: {} },
    clientId: a.clientId || b.clientId,
  };
  const fWin = {};
  [a, b].forEach(s => s.folders.forEach(f => {
    const ts = s.ts.folder[f.id] ?? 0;
    if (!fWin[f.id] || ts >= fWin[f.id]._ts) fWin[f.id] = { ...f, _ts: ts };
  }));
  const folderIds = new Set([...Object.keys(fWin), ...Object.keys(a.tombstones.folder), ...Object.keys(b.tombstones.folder)]);
  folderIds.forEach(id => {
    const delTs = Math.max(a.tombstones.folder[id] ?? -1, b.tombstones.folder[id] ?? -1);
    const liveTs = fWin[id] ? fWin[id]._ts : -1;
    if (id !== UNCAT_ID && delTs > liveTs) { out.tombstones.folder[id] = delTs; }
    else if (fWin[id]) { const { _ts, ...folder } = fWin[id]; out.folders.push(folder); out.ts.folder[id] = _ts; }
  });
  if (!out.folders.some(f => f.id === UNCAT_ID)) { out.folders.unshift({ id: UNCAT_ID, name: 'Uncategorized', parentId: null, expanded: true }); out.ts.folder[UNCAT_ID] = 0; }
  const mergeMap = (field, kind) => {
    const keys = new Set([...Object.keys(a[field]), ...Object.keys(b[field]), ...Object.keys(a.tombstones[kind]), ...Object.keys(b.tombstones[kind])]);
    keys.forEach(k => {
      let best = { kind: 'none', ts: -1, val: null };
      if (a[field][k] != null) { const ts = a.ts[kind][k] ?? 0; if (ts > best.ts) best = { kind: 'val', ts, val: a[field][k] }; }
      if (b[field][k] != null) { const ts = b.ts[kind][k] ?? 0; if (ts > best.ts) best = { kind: 'val', ts, val: b[field][k] }; }
      const aDel = a.tombstones[kind][k] ?? -1, bDel = b.tombstones[kind][k] ?? -1;
      if (aDel > best.ts) best = { kind: 'tomb', ts: aDel };
      if (bDel > best.ts) best = { kind: 'tomb', ts: bDel };
      if (best.kind === 'val') { out[field][k] = best.val; out.ts[kind][k] = best.ts; }
      else if (best.kind === 'tomb') { out.tombstones[kind][k] = best.ts; }
    });
  };
  mergeMap('cardAssignments', 'card');
  mergeMap('shortLinkAssignments', 'sl');
  const liveFolder = new Set(out.folders.map(f => f.id));
  Object.keys(out.cardAssignments).forEach(k => { if (!liveFolder.has(out.cardAssignments[k])) out.cardAssignments[k] = UNCAT_ID; });
  Object.keys(out.shortLinkAssignments).forEach(k => { if (!liveFolder.has(out.shortLinkAssignments[k])) delete out.shortLinkAssignments[k]; });
  return dedupeFoldersByName(out);
}

// Collapse folders sharing a name + parent onto one surviving copy (remap
// assignments, tombstone the extras). Keep in sync with index.html.
function dedupeFoldersByName(s) {
  const groups = {};
  s.folders.forEach(f => { const k = JSON.stringify([f.parentId ?? null, f.name]); (groups[k] = groups[k] || []).push(f); });
  const refs = id => Object.values(s.cardAssignments).filter(v => v === id).length + Object.values(s.shortLinkAssignments).filter(v => v === id).length;
  const remap = {};
  Object.values(groups).forEach(g => {
    if (g.length < 2) return;
    g.sort((a, b) => refs(b.id) - refs(a.id) || String(a.id).localeCompare(String(b.id)));
    g.slice(1).forEach(d => { if (d.id !== UNCAT_ID) remap[d.id] = g[0].id; });
  });
  const dupIds = Object.keys(remap);
  if (!dupIds.length) return s;
  const now = Date.now();
  for (const c in s.cardAssignments) if (remap[s.cardAssignments[c]]) { s.cardAssignments[c] = remap[s.cardAssignments[c]]; s.ts.card[c] = now; }
  for (const l in s.shortLinkAssignments) if (remap[s.shortLinkAssignments[l]]) { s.shortLinkAssignments[l] = remap[s.shortLinkAssignments[l]]; s.ts.sl[l] = now; }
  s.folders = s.folders.filter(f => !remap[f.id]);
  dupIds.forEach(id => { s.tombstones.folder[id] = now; delete s.ts.folder[id]; });
  return s;
}

export { mergeStates, normalizeState, defaultState };

// ---- CLI (only when run directly, not when imported) ----
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  let outFile = 'state.json';
  const inputs = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') { outFile = argv[++i]; }
    else inputs.push(argv[i]);
  }
  if (inputs.length === 0) {
    console.error('Usage: node merge-states.mjs [--out state.json] file1.json file2.json ...');
    process.exit(1);
  }
  let merged = defaultState();
  let totalIn = 0;
  for (const f of inputs) {
    if (!fs.existsSync(f)) { console.warn(`skip (missing): ${f}`); continue; }
    const data = JSON.parse(fs.readFileSync(f, 'utf8'));
    const before = Object.keys(merged.cardAssignments).length;
    merged = mergeStates(merged, data);
    const after = Object.keys(merged.cardAssignments).length;
    totalIn++;
    console.log(`merged ${f}: cards ${Object.keys(data.cardAssignments || {}).length} → running total ${after} (+${after - before})`);
  }
  fs.writeFileSync(outFile, JSON.stringify(merged, null, 2));
  console.log(`\nWrote ${outFile}: ${merged.folders.length} folders, ${Object.keys(merged.cardAssignments).length} card assignments, ${Object.keys(merged.shortLinkAssignments).length} short-link overrides, from ${totalIn} file(s).`);
}

'use strict';
// Builds docs/asset-map.json and docs/ASSET_MAP.md: which assets come from
// Call of Duty: Black Ops II, WoW Wrath 3.3.5, or are original/synthesized.
// CPU-only. Uses stat for sizes and reads only the small provenance/manifest JSONs.
// Usage: node scripts/build-asset-map.cjs   (npm run asset-map)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = 'public/assets';
const MAX_JSON_BYTES = 1024 * 1024;

// ---------------------------------------------------------------------------
// Hand-maintained classification table. Keys are repo-relative directories
// (longest prefix wins; subfolders inherit). A directory with no matching key is
// reported as UNMAPPED and the test fails, forcing a decision for new folders.
// ---------------------------------------------------------------------------
const CLASSIFICATION = {
  'public/assets/(root files)': {
    origin: 'WOW_3_3_5', gameplayRole: 'City manifests (stormwind/dalaran/darnassus.json), the clipped Stormwind district packs (stormwind-trade/-dwarven/-valley/-park.json) and import provenance; world layer.',
    sourceNote: 'WMO city geometry converted from the user WoW 3.3.5 (build 12340) client. District packs are triangle-clipped subsets of stormwind.json (no new source data).', importScript: 'scripts/import-wow.cjs (district packs: scripts/build-districts.cjs)', redistributable: false },
  'public/assets/textures': {
    origin: 'WOW_3_3_5', gameplayRole: 'City WMO textures (BLP decoded to PNG, hashed names).',
    sourceNote: 'Wrath BLP textures; count recorded in assets/provenance.json.', importScript: 'scripts/import-wow.cjs + scripts/textures.py', redistributable: false },
  'public/assets/characters': {
    origin: 'WOW_3_3_5', gameplayRole: 'Playable race, ghoul and zombie meshes, skeletons and animation tracks (world layer).',
    sourceNote: 'Wrath MD20 models + skins; per-race source paths in characters/manifest.json.', importScript: 'scripts/import-characters.cjs', redistributable: false },
  'public/assets/props': {
    origin: 'WOW_3_3_5', gameplayRole: 'WMO doodad props, M2 models and collision hulls for all three cities, plus the per-district prop packs (props/stormwind-*.json).',
    sourceNote: 'Wrath WMO MODD placements and M2 meshes. District prop packs keep the original instance ids of props/stormwind.json.', importScript: 'scripts/import-props.cjs (district packs: scripts/build-districts.cjs)', redistributable: false },
  'public/assets/transports': {
    origin: 'WOW_3_3_5', gameplayRole: 'Horde zeppelin hull, balloon, textures and doodad animation (Battle Royale).',
    sourceNote: 'Transport_Horde_Zeppelin.wmo + exact dependencies (transports/provenance.json).', importScript: 'scripts/import-zeppelin.cjs', redistributable: false },
  'public/assets/weapons': {
    origin: 'COD_BO2', gameplayRole: 'First-person gun, magazine, scope and knife meshes, color/normal textures, scope overlays, patched weapon definitions.',
    sourceNote: 'BO2 common_mp.ff / common_patch_mp.ff via OpenAssetTools Unlinker; animation is procedural.', importScript: 'scripts/import-bo2.ps1, scripts/import-armory.ps1, scripts/import-weapon-data.cjs, scripts/prepare-weapons.py', redistributable: false },
  'public/assets/audio': {
    origin: 'COD_BO2', gameplayRole: 'Gun firing, magazine and bolt recordings (combat layer).',
    sourceNote: 'BO2 mpl_common.all aliases from common_mp.ff; WAVs copied unchanged; hashes in audio/manifest.json.', importScript: 'scripts/import-audio.ps1 + scripts/prepare-audio.py', redistributable: false },
  'public/assets/effects': {
    origin: 'COD_BO2', gameplayRole: 'Muzzle-flash gas/flame texture atlases; FX names per weapon.',
    sourceNote: 'BO2 fxt_* DDS converted to PNG; hashes in effects/provenance.json. Playback logic is local.', importScript: 'scripts/import-effects.ps1 + scripts/prepare-effects.py', redistributable: false },
  'public/assets/machines': {
    origin: 'COD_BO2', gameplayRole: 'Perk machine and Pack-a-Punch meshes with color textures (combat layer).',
    sourceNote: 'Named models from zm_transit/zm_prison/zm_buried/zm_highrise via OAT Linker+Unlinker; machines/provenance.json.', importScript: 'scripts/import-cod-props.ps1 + scripts/prepare-cod-props.py', redistributable: false },
  'public/assets/streaks': {
    origin: 'COD_BO2', gameplayRole: 'Scorestreak models (BO2 sentry gun turret) with color textures (combat layer).',
    sourceNote: 'Named model t6_wpn_turret_sentry_gun from common_mp.ff via OAT; streaks/provenance.json.', importScript: 'scripts/import-sentry.ps1 + scripts/prepare-sentry.py', redistributable: false },
  'public/assets/layouts': {
    origin: 'ORIGINAL', gameplayRole: 'User-authored Map Workshop layouts (JSON placements). Not present until the editor saves one.',
    sourceNote: 'Authored in-app; references WoW/BO2 models by path only.', importScript: '(editor, server)', redistributable: true },
  'public/ui': {
    origin: 'MIXED', gameplayRole: 'Menu card art for each city and Stormwind district.',
    sourceNote: 'Screenshots produced by scripts/capture-menu-art.cjs from the running game: WoW city geometry, possibly with BO2 weapon models or HUD in frame.', importScript: 'scripts/capture-menu-art.cjs', redistributable: false },
};
const ROOT_FILES_KEY = 'public/assets/(root files)';
const WALK_ROOTS = ['public/assets', 'public/ui'];

// Code that is not an asset folder but matters to the provenance picture.
const SYNTHESIZED = [
  { id: 'hit-confirm-sound', origin: 'ORIGINAL', layer: 'combat', file: 'src/game.js', what: "sound('hit'): WebAudio sine blip for hit confirmation (not a BO2 recording)." },
  { id: 'survival-barricade-sounds', origin: 'ORIGINAL', layer: 'combat', file: 'src/game.js', what: 'survivalSound(): sawtooth/triangle oscillator sweeps for board, repair and breach.' },
  { id: 'weapon-audio-mixer', origin: 'ORIGINAL', layer: 'combat', file: 'src/weapon-audio.js', what: 'Web Audio mixer, spatialisation and reconstructed reload/bolt timing around BO2 WAVs (code original, samples BO2).' },
  { id: 'perk-machine-signage', origin: 'ORIGINAL', layer: 'world', file: 'src/survival-world.js', what: 'sign(): canvas-drawn name/price plates and a simple box collision cabinet; BO2 GLB mesh/textures are fitted over it by src/perk-models.js.' },
  { id: 'fortifications', origin: 'ORIGINAL', layer: 'world', file: 'src/survival-world.js', what: 'Procedural timber boards, gates, carts/crates and a generated wood texture (Box geometry).' },
  { id: 'fountain-water', origin: 'ORIGINAL', layer: 'world', file: 'src/fountains.js', what: 'Reconstructed animated water surface, streams and spray fitted to WoW fountain placements.' },
  { id: 'sentry-presentation', origin: 'ORIGINAL', layer: 'combat', file: 'src/game.js', what: 'Killstreak sentry is a handful of box meshes with tracer fire; BO2-inspired concept, no BO2 asset.' },
  { id: 'uav-presentation', origin: 'ORIGINAL', layer: 'combat', file: 'src/game.js', what: 'UAV is radar-reveal logic on a 2D canvas; no model or audio.' },
  { id: 'zeppelin-placeholder', origin: 'ORIGINAL', layer: 'world', file: 'src/battle-royale-view.js', what: 'createZeppelin(): procedural stand-in shown until the real WoW zeppelin (src/zeppelin-model.js) finishes loading.' },
  { id: 'storm-and-zone', origin: 'ORIGINAL', layer: 'world', file: 'src/battle-royale-view.js', what: 'Battle Royale storm/zone visuals (README: original prototype visuals).' },
  { id: 'player-nametags', origin: 'ORIGINAL', layer: 'combat', file: 'src/combat.js', what: 'Canvas sprite name labels.' },
  { id: 'weapon-handling-animation', origin: 'ORIGINAL', layer: 'combat', file: 'src/weapons.js', what: 'Procedural sway, recoil, reload and knife swing; no BO2 animation clips (weapons/provenance.json).' },
  { id: 'css-html-ui', origin: 'ORIGINAL', layer: 'combat', file: 'public/cod-theme.css', what: 'All CSS/HTML; system fonts only; cod-theme.css imitates a CoD-style HUD with original code and no CoD image or font files.' },
];

const DESIGN_RULE = {
  statement: 'CoD owns the combat layer (guns, gun/FX audio, perk machines, sentry/UAV concepts, HUD style). WoW owns the world layer (cities, props, races, zombies/ghouls, zeppelin). ORIGINAL code fills gaps and glues them together.',
  findings: [
    { kind: 'violation', item: 'Hit-confirmation sound is a synthesized sine blip', detail: 'Combat-layer audio that is not CoD.', recommendation: 'Extract a BO2 hitmarker alias (mpl_common.all family) with scripts/import-audio.ps1, or document the blip as intentional.' },
    { kind: 'violation', item: 'Survival barricade/board/breach sounds are oscillator sweeps', detail: 'Zombies combat feedback is synthesized (README admits it).', recommendation: 'Import BO2 zombie barricade aliases (zm banks) or keep and label as placeholder.' },
    { kind: 'violation', item: 'Sentry and UAV have no CoD presentation', detail: 'Sentry is box meshes; UAV is a radar reveal only.', recommendation: 'Import a BO2 sentry model (named-model path used by import-cod-props.ps1) and UAV/sentry alias audio. Another agent may be adding sentry assets; classify any new folder in this table.' },
    { kind: 'ambiguity', item: 'Perk machines mix CoD mesh with original signage', detail: 'BO2 GLB (combat) placed inside WoW cities; canvas sign() and box collider are original and remain as fallback.', recommendation: 'Keep: mesh and textures are CoD, collision and fallback are original code. Prefer the BO2 logo textures already bundled over canvas text.' },
    { kind: 'ambiguity', item: 'Zeppelin placeholder vs real WoW zeppelin', detail: 'README says both that Battle Royale uses the original Wrath hull and that the zeppelin is an original prototype visual.', recommendation: 'Fix README wording: the WoW hull is the product; the procedural zeppelin is only a loading stand-in.' },
    { kind: 'ambiguity', item: 'Procedural fortifications and fountain water inside the WoW world layer', detail: 'World-layer visuals that are original rather than WoW.', recommendation: 'Acceptable. Where practical swap carts/crates for imported WoW doodads (props/).' },
    { kind: 'ambiguity', item: 'Playable races and zombies are WoW meshes carrying BO2 guns', detail: 'Intended hybrid: WoW actors in the world, CoD weapons in hand. Hit regions are approximated by height.', recommendation: 'Keep; this is the project premise.' },
    { kind: 'ambiguity', item: 'public/ui menu art is a rendered mix', detail: 'In-game screenshots may contain WoW geometry plus CoD models or HUD.', recommendation: 'Treat as non-redistributable (git-ignored). Regenerate with capture-menu-art.cjs if provenance matters.' },
    { kind: 'ambiguity', item: 'cod-theme.css imitates CoD styling', detail: 'Code is original (MIT) but visually evokes CoD; no CoD files are included.', recommendation: 'Fine for a parody project; do not add CoD logos or fonts.' },
    { kind: 'ambiguity', item: 'Layouts saved under public/assets/layouts/ are ORIGINAL data inside an ignored folder', detail: 'public/assets/ is git-ignored, so user layouts are never committed.', recommendation: 'Move layouts to a tracked location if sharing them is wanted.' },
  ],
};

const CODE_DIRS = ['src', 'server', 'scripts', 'tests', 'vendor'];

function posix(p) { return p.split(path.sep).join('/'); }

function walk(rel, files, dirs) {
  const abs = path.join(ROOT, rel);
  let entries;
  try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    const r = rel + '/' + e.name;
    if (e.isDirectory()) { if (e.name === 'node_modules') continue; dirs.push(r); walk(r, files, dirs); }
    else if (e.isFile()) files.push({ rel: r, bytes: fs.statSync(path.join(ROOT, r)).size });
  }
}

function keyFor(rel, isFile) {
  if (isFile && path.posix.dirname(rel) === ASSETS) return ROOT_FILES_KEY;
  let best = null;
  for (const k of Object.keys(CLASSIFICATION)) {
    if (k === ROOT_FILES_KEY) continue;
    if ((rel === k || rel.startsWith(k + '/')) && (!best || k.length > best.length)) best = k;
  }
  return best;
}

function readJson(rel) {
  try {
    const abs = path.join(ROOT, rel);
    if (fs.statSync(abs).size > MAX_JSON_BYTES) return null;
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch { return null; }
}

function provenanceFacts() {
  const facts = {};
  const root = readJson(ASSETS + '/provenance.json');
  if (root) facts['public/assets (root)'] = `WoW build ${root.build}; ${(root.cities || []).length} cities; ${root.textures} textures recorded`;
  const audio = readJson(ASSETS + '/audio/manifest.json');
  if (audio) facts['public/assets/audio'] = `${audio.source && audio.source.game}; alias bank ${audio.source && audio.source.aliasBank}; tool ${audio.source && audio.source.tool}`;
  const chars = readJson(ASSETS + '/characters/manifest.json');
  if (chars) facts['public/assets/characters'] = `WoW build ${chars.build}; ${(chars.characters || []).length} characters in manifest`;
  const eff = readJson(ASSETS + '/effects/provenance.json');
  if (eff) facts['public/assets/effects'] = `${eff.game}; ${(eff.images || []).length} source images; ${Object.keys(eff.weapons || {}).length} weapon FX records`;
  const mach = readJson(ASSETS + '/machines/provenance.json');
  if (mach) facts['public/assets/machines'] = `${mach.source}; ${mach.tool}; ${Object.keys(mach.models || {}).length} machine models`;
  const wpn = readJson(ASSETS + '/weapons/provenance.json');
  if (wpn) facts['public/assets/weapons'] = `${wpn.source}; ${wpn.tool}; ${(wpn.models || []).length} view models; animations: ${wpn.animations}`;
  const tr = readJson(ASSETS + '/transports/provenance.json');
  if (tr) facts['public/assets/transports'] = `WoW build ${tr.build}; source ${tr.source}; ${(tr.dependencies || []).length} dependencies`;
  return facts;
}

function codeStats() {
  const out = {};
  for (const d of CODE_DIRS) {
    const files = [], dirs = [];
    walk(d, files, dirs);
    out[d] = { files: files.length, bytes: files.reduce((s, x) => s + x.bytes, 0) };
  }
  let n = 0, b = 0;
  try {
    for (const e of fs.readdirSync(path.join(ROOT, 'public'), { withFileTypes: true })) {
      if (e.isFile() && /\.(css|html)$/.test(e.name)) { n++; b += fs.statSync(path.join(ROOT, 'public', e.name)).size; }
    }
  } catch { /* none */ }
  out['public/*.css|html'] = { files: n, bytes: b };
  return out;
}

function buildAssetMap() {
  const files = [], dirs = [];
  for (const r of WALK_ROOTS) walk(r, files, dirs);

  const unmapped = [];
  for (const d of dirs) if (!keyFor(d, false)) unmapped.push(d);
  for (const f of files) if (!keyFor(f.rel, true)) unmapped.push(f.rel);

  const cats = {};
  for (const k of Object.keys(CLASSIFICATION)) cats[k] = { files: 0, bytes: 0, ext: {}, present: false };
  const subfolders = {};
  for (const f of files) {
    const k = keyFor(f.rel, true);
    if (!k) continue;
    const c = cats[k];
    c.files++; c.bytes += f.bytes; c.present = true;
    const ext = path.extname(f.rel).toLowerCase() || '(none)';
    c.ext[ext] = (c.ext[ext] || 0) + 1;
    // key subfolders: directories up to two levels beneath public/assets or public/ui
    const parts = f.rel.split('/');
    for (let depth = 3; depth <= Math.min(parts.length - 1, 4); depth++) {
      const sub = parts.slice(0, depth).join('/');
      const s = subfolders[sub] || (subfolders[sub] = { files: 0, bytes: 0 });
      s.files++; s.bytes += f.bytes;
    }
  }
  for (const c of Object.values(cats)) c.ext = Object.fromEntries(Object.entries(c.ext).sort());

  const categories = Object.keys(CLASSIFICATION).sort().map(k => ({ category: k, ...CLASSIFICATION[k], ...cats[k] }));
  const byOrigin = {};
  for (const c of categories) {
    const o = byOrigin[c.origin] || (byOrigin[c.origin] = { files: 0, bytes: 0, categories: 0 });
    o.files += c.files; o.bytes += c.bytes; o.categories++;
  }
  const map = {
    schema: 1,
    regenerate: 'node scripts/build-asset-map.cjs  (npm run asset-map)',
    summaryByOrigin: Object.fromEntries(Object.entries(byOrigin).sort()),
    categories,
    keySubfolders: Object.fromEntries(Object.entries(subfolders).sort(([a], [b]) => (a < b ? -1 : 1))),
    provenanceFacts: provenanceFacts(),
    synthesizedAndOriginalCode: SYNTHESIZED,
    codeStats: codeStats(),
    designRule: DESIGN_RULE,
    unmapped: unmapped.sort(),
    redistributableViolations: categories.filter(c => c.origin !== 'ORIGINAL' && c.redistributable).map(c => c.category),
    licensing: {
      code: 'Original source code, CSS and HTML are MIT (LICENSE). vendor/mpq is MIT (wow.export); three.js and three-mesh-bvh are MIT.',
      assets: 'All COD_BO2 and WOW_3_3_5 assets (and MIXED) are NOT redistributable. public/assets/, public/ui/, tools/ and cache/ must stay git-ignored.',
    },
  };
  return { map, json: JSON.stringify(map, null, 2) + '\n', md: renderMd(map) };
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  const u = ['KB', 'MB', 'GB']; let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < 2);
  return n.toFixed(1) + ' ' + u[i];
}
const ORIGIN_TITLE = {
  COD_BO2: 'Call of Duty: Black Ops II (combat layer)',
  WOW_3_3_5: 'World of Warcraft Wrath 3.3.5 build 12340 (world layer)',
  MIXED: 'Mixed',
  ORIGINAL: 'Original / synthesized',
};

function renderMd(m) {
  const L = [];
  L.push('# Asset provenance map', '');
  L.push('Generated by `node scripts/build-asset-map.cjs` (`npm run asset-map`). Do not edit by hand: the classification table lives in the script and sizes come from the files on disk. Machine-readable copy: `docs/asset-map.json`.', '');
  L.push('## Summary by origin', '', '| Origin | Categories | Files | Size |', '|---|---:|---:|---:|');
  for (const [o, v] of Object.entries(m.summaryByOrigin)) L.push(`| ${o} | ${v.categories} | ${v.files} | ${fmtBytes(v.bytes)} |`);
  L.push('');
  for (const origin of ['COD_BO2', 'WOW_3_3_5', 'MIXED', 'ORIGINAL']) {
    const rows = m.categories.filter(c => c.origin === origin);
    if (!rows.length) continue;
    L.push(`## ${ORIGIN_TITLE[origin]}`, '', '| Category | Files | Size | Role in game | Source | Import script | Redistributable |', '|---|---:|---:|---|---|---|---|');
    for (const c of rows) {
      L.push(`| \`${c.category}\`${c.present ? '' : ' (absent)'} | ${c.files} | ${fmtBytes(c.bytes)} | ${c.gameplayRole} | ${c.sourceNote} | ${c.importScript} | ${c.redistributable ? 'yes' : 'NO'} |`);
    }
    L.push('');
  }
  L.push('## Synthesized and original code-level presentation', '', '| Item | Layer | File | What it is |', '|---|---|---|---|');
  for (const s of m.synthesizedAndOriginalCode) L.push(`| ${s.id} | ${s.layer} | \`${s.file}\` | ${s.what} |`);
  L.push('', '## Provenance files (as read)', '');
  for (const [k, v] of Object.entries(m.provenanceFacts)) L.push(`- \`${k}\`: ${v}`);
  L.push('', '## Key subfolders', '', '| Folder | Files | Size |', '|---|---:|---:|');
  for (const [k, v] of Object.entries(m.keySubfolders)) L.push(`| \`${k}\` | ${v.files} | ${fmtBytes(v.bytes)} |`);
  L.push('', '## Design rule', '', m.designRule.statement, '', '### Violations and ambiguities', '');
  for (const f of m.designRule.findings) L.push(`- **${f.kind.toUpperCase()}: ${f.item}.** ${f.detail} Recommendation: ${f.recommendation}`);
  L.push('', '## Licensing and redistribution', '', `- ${m.licensing.code}`, `- ${m.licensing.assets}`, '- Code statistics: ' + Object.entries(m.codeStats).map(([k, v]) => `${k} ${v.files} files`).join(', ') + '.', '');
  L.push('## New asset folders', '', 'The builder fails (exit 1) when a directory under `public/assets` or `public/ui` has no entry in the `CLASSIFICATION` table in `scripts/build-asset-map.cjs`. Add the entry, choose the origin, and keep `redistributable: false` for anything extracted from a game.', '');
  if (m.unmapped.length) L.push('**UNMAPPED right now:** ' + m.unmapped.map(u => `\`${u}\``).join(', '), '');
  return L.join('\n');
}

function writeDocs(result) {
  const dir = path.join(ROOT, 'docs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'asset-map.json'), result.json);
  fs.writeFileSync(path.join(dir, 'ASSET_MAP.md'), result.md);
}

module.exports = { buildAssetMap, writeDocs, CLASSIFICATION, ROOT };

if (require.main === module) {
  const r = buildAssetMap();
  writeDocs(r);
  for (const [o, v] of Object.entries(r.map.summaryByOrigin)) console.log(`${o}: ${v.files} files, ${fmtBytes(v.bytes)}`);
  if (r.map.unmapped.length) { console.error('UNMAPPED:', r.map.unmapped.join(', ')); process.exit(1); }
  if (r.map.redistributableViolations.length) { console.error('Redistributable violations:', r.map.redistributableViolations.join(', ')); process.exit(1); }
  console.log('Wrote docs/asset-map.json and docs/ASSET_MAP.md');
}

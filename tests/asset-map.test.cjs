'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildAssetMap, writeDocs, CLASSIFICATION, ROOT } = require('../scripts/build-asset-map.cjs');

const result = buildAssetMap();

test('every asset directory maps to a classification', () => {
  assert.deepStrictEqual(result.map.unmapped, [], 'unclassified asset paths: add them to CLASSIFICATION in scripts/build-asset-map.cjs');
});

test('classification entries are well formed and game assets are not redistributable', () => {
  const origins = ['COD_BO2', 'WOW_3_3_5', 'ORIGINAL', 'MIXED'];
  for (const [k, c] of Object.entries(CLASSIFICATION)) {
    assert.ok(origins.includes(c.origin), k);
    assert.ok(c.gameplayRole && c.sourceNote && c.importScript, k);
    if (c.origin !== 'ORIGINAL') assert.strictEqual(c.redistributable, false, k + ' must not be redistributable');
  }
  assert.deepStrictEqual(result.map.redistributableViolations, []);
});

test('.gitignore keeps extracted assets out of git', () => {
  const lines = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map(s => s.trim());
  assert.ok(lines.includes('public/assets/'));
  assert.ok(lines.includes('public/ui/'));
});

test('docs are generated deterministically', () => {
  const again = buildAssetMap();
  assert.strictEqual(again.json, result.json);
  assert.strictEqual(again.md, result.md);
  writeDocs(result);
  assert.strictEqual(fs.readFileSync(path.join(ROOT, 'docs/asset-map.json'), 'utf8'), result.json);
  assert.strictEqual(fs.readFileSync(path.join(ROOT, 'docs/ASSET_MAP.md'), 'utf8'), result.md);
});

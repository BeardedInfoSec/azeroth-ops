'use strict';
// Detects the git-ignored game assets (public/assets) so tests that genuinely need them
// can be skipped on a clean clone. AO_FORCE_NO_ASSETS=1 makes every check report "missing".
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../../public/assets');
const SKIP_REASON = 'needs local game assets (npm run import:wow-all / BO2 imports); see README';

function hasAssets(...relPaths) {
  if (process.env.AO_FORCE_NO_ASSETS === '1') return false;
  const list = relPaths.flat().filter(Boolean);
  if (!list.length) return fs.existsSync(ROOT);
  return list.every((rel) => fs.existsSync(path.join(ROOT, rel)));
}

// Returns node:test options: {skip: reason} when any listed asset is missing, else {}.
function skipUnlessAssets(...relPaths) {
  return hasAssets(...relPaths) ? {} : { skip: SKIP_REASON };
}

module.exports = { hasAssets, skipUnlessAssets, SKIP_REASON, ASSET_ROOT: ROOT };

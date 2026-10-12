'use strict';
// Builds the Stormwind district packs from the already-imported full city:
//   public/assets/<packId>.json         (clipped geometry, same schema as stormwind.json)
//   public/assets/props/<packId>.json   (district props, original instance ids kept)
// CPU-only and deterministic. Run: npm run build:districts
// The full city is ~43 MB of JSON; if Node runs out of memory use
//   node --max-old-space-size=4096 scripts/build-districts.cjs
// Options: --only <districtId>   build one district.   --dry   report, write nothing.
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'public/assets');
const mb = bytes => (bytes / 1048576).toFixed(2) + ' MB';

async function main(argv = process.argv.slice(2)) {
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null, dry = argv.includes('--dry');
  const {DISTRICTS, clipCity, clipProps, SOURCE_CITY} = await import(pathToFileURL(path.join(ROOT, 'src/districts.mjs')).href);
  const cityFile = path.join(ASSETS, SOURCE_CITY + '.json'), propsFile = path.join(ASSETS, 'props', SOURCE_CITY + '.json');
  for (const file of [cityFile, propsFile]) if (!fs.existsSync(file)) { console.error('Missing ' + path.relative(ROOT, file) + '. Run the Stormwind import first (npm run import:wow-all).'); return 1; }
  const targets = DISTRICTS.filter(d => !only || d.id === only);
  if (!targets.length) { console.error('Unknown district ' + only); return 1; }
  const fullBytes = fs.statSync(cityFile).size, fullProps = fs.statSync(propsFile).size;
  const city = JSON.parse(fs.readFileSync(cityFile, 'utf8')), props = JSON.parse(fs.readFileSync(propsFile, 'utf8'));
  const fullTriangles = city.groups.reduce((n, g) => n + g.indices.length / 3, 0);
  const fullTextures = new Set(city.materials.map(m => m.texture));
  console.log(`Full ${SOURCE_CITY}: ${city.groups.length} groups, ${fullTriangles} triangles, ${city.materials.length} materials, ${mb(fullBytes)} geometry + ${props.instances.length} props (${mb(fullProps)})`);
  const summary = [];
  for (const district of targets) {
    const {manifest, stats} = clipCity(city, district), clippedProps = clipProps(props, district);
    const geometryText = JSON.stringify(manifest), propsText = JSON.stringify(clippedProps);
    const textures = new Set(manifest.materials.map(m => m.texture));
    let textureBytes = 0;
    for (const url of textures) { try { textureBytes += fs.statSync(path.join(ROOT, 'public', decodeURIComponent(url))).size; } catch { /* texture not exported */ } }
    if (!dry) {
      fs.mkdirSync(path.join(ASSETS, 'props'), {recursive: true});
      fs.writeFileSync(path.join(ASSETS, district.packId + '.json'), geometryText);
      fs.writeFileSync(path.join(ASSETS, 'props', district.packId + '.json'), propsText);
    }
    const kept = clippedProps.models.filter(m => !m.stub).length;
    const row = {id: district.id, groups: stats.groups, triangles: stats.triangles, materials: stats.materials, textures: textures.size, textureBytes,
      props: clippedProps.instances.length, models: kept, geometryBytes: Buffer.byteLength(geometryText), propBytes: Buffer.byteLength(propsText)};
    summary.push(row);
    console.log(`${district.id.padEnd(18)} ${String(row.groups).padStart(3)} groups ${String(row.triangles).padStart(7)} tris (${(100 * row.triangles / fullTriangles).toFixed(1)}%) ${String(row.materials).padStart(3)}/${city.materials.length} mats ${String(row.textures).padStart(3)}/${fullTextures.size} textures (${mb(textureBytes)}) ` +
      `${String(row.props).padStart(4)}/${props.instances.length} props ${String(kept).padStart(3)}/${props.models.length} models  ${mb(row.geometryBytes)} + ${mb(row.propBytes)}${dry ? ' (dry run)' : ''}`);
  }
  return summary;
}

if (require.main === module) main().then(r => process.exit(typeof r === 'number' ? r : 0), e => { console.error(e); process.exit(1); });
module.exports = {main};

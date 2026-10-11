const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TYPES = {'.json':'application/json','.glb':'model/gltf-binary','.gltf':'model/gltf+json','.bin':'application/octet-stream','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.wav':'audio/wav','.ogg':'audio/ogg','.mp3':'audio/mpeg'};
const CITIES = [['stormwind','Stormwind'],['dalaran','Dalaran'],['darnassus','Darnassus']];
const OMIT = new Set(['provenance.json','definitions.json']);
const inside = (root, file) => file.startsWith(root + path.sep);
const digest = value => crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);

// Only exported runtime assets can enter a download pack. A reference cannot
// escape the assets directory, name a remote URL, or refer to an original install.
function assetReference(value, sourceUrl) {
  if(typeof value !== 'string' || !value || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith('//')) return null;
  let decoded, base;
  try { decoded = decodeURIComponent(value); base = decodeURIComponent(sourceUrl); } catch { return null; }
  if(/[\\\x00-\x1f?#]/.test(decoded)) return null;
  const pathname = path.posix.normalize(decoded.startsWith('/') ? decoded : path.posix.join(path.posix.dirname(base), decoded));
  if(!pathname.startsWith('/assets/') || !TYPES[path.posix.extname(pathname).toLowerCase()] || OMIT.has(path.posix.basename(pathname))) return null;
  return pathname.split('/').map(encodeURIComponent).join('/');
}

// Geometry arrays can be hundreds of MB. Scan bounded string tokens instead of
// parsing or retaining geometry. indexOf skips entire numeric-only chunks.
async function jsonReferences(file, sourceUrl, highWaterMark = 65536) {
  const refs = new Set();
  let quoted = false, escaped = false, token = '', overflow = false;
  for await (const chunk of fs.createReadStream(file, {encoding:'utf8', highWaterMark})) {
    let i = 0;
    while(i < chunk.length) {
      if(!quoted) {
        const start = chunk.indexOf('"', i);
        if(start < 0) break;
        quoted = true; escaped = false; token = '"'; overflow = false; i = start + 1;
      }
      while(quoted && i < chunk.length) {
        const char = chunk[i++];
        if(!overflow) { token += char; if(token.length > 8192) { token = ''; overflow = true; } }
        if(escaped) { escaped = false; continue; }
        if(char === '\\') { escaped = true; continue; }
        if(char !== '"') continue;
        quoted = false;
        if(!overflow) {
          let value;
          try { value = JSON.parse(token); } catch { continue; }
          const ref = assetReference(value, sourceUrl);
          if(ref) refs.add(ref);
        }
      }
    }
  }
  return [...refs].sort();
}

async function runtimeFiles(root, relative) {
  const files = [];
  let entries;
  try { entries = await fs.promises.readdir(path.join(root, relative), {withFileTypes:true}); }
  catch(error) { if(error.code === 'ENOENT') return files; throw error; }
  for(const entry of entries.sort((a,b) => a.name.localeCompare(b.name))) {
    const name = path.posix.join(relative, entry.name);
    if(entry.isDirectory()) files.push(...await runtimeFiles(root, name));
    else if(entry.isFile() && TYPES[path.extname(name).toLowerCase()] && !OMIT.has(entry.name)) files.push('/assets/' + name.split('/').map(encodeURIComponent).join('/'));
  }
  return files;
}

async function buildAssetManifest({assetRoot}) {
  const root = await fs.promises.realpath(assetRoot);
  const records = new Map(), dependencies = new Map();
  async function collect(url, pack) {
    if(pack.has(url)) return;
    pack.add(url);
    if(!records.has(url)) {
      const relative = decodeURIComponent(url.slice('/assets/'.length));
      const file = await fs.promises.realpath(path.join(root, relative));
      if(!inside(root, file)) throw new Error('Asset reference leaves exported assets: ' + url);
      const stat = await fs.promises.stat(file);
      if(!stat.isFile()) throw new Error('Asset is not a file: ' + url);
      const extension = path.extname(file).toLowerCase();
      records.set(url, {url, revision:digest(stat.size + ':' + stat.mtimeMs), size:stat.size, type:TYPES[extension]});
      dependencies.set(url, extension === '.json' || extension === '.gltf' ? await jsonReferences(file, url) : []);
    }
    for(const dependency of dependencies.get(url)) await collect(dependency, pack);
  }
  const coreFiles = new Map();
  for(const dir of ['characters','weapons','audio','effects']) {
    coreFiles.set(dir, await runtimeFiles(root, dir));
  }
  const coreAvailable = [...coreFiles.values()].every(files => files.length > 0)
    && coreFiles.get('characters').includes('/assets/characters/manifest.json')
    && coreFiles.get('audio').includes('/assets/audio/manifest.json')
    && coreFiles.get('weapons').some(file => file.endsWith('.glb'));
  const packSets = [['core','Shared gear and characters',new Set(),coreAvailable,coreAvailable ? undefined : 'Import the shared characters, weapons, gun audio, and effects on the host.']];
  if(coreAvailable) for(const files of coreFiles.values()) for(const url of files) await collect(url, packSets[0][2]);
  // Optional model imports expand the shared pack without making a fresh host
  // that only has the original core files unavailable.
  if(coreAvailable) for(const dir of ['machines','streaks','transports']) for(const url of await runtimeFiles(root,dir)) await collect(url,packSets[0][2]);
  for(const [id,name] of CITIES) {
    const pack = new Set();
    // Incomplete local imports remain visible as empty packs, never partial
    // successful downloads. A present root with a missing dependency fails.
    const cityFiles = [id + '.json', 'props/' + id + '.json'];
    const present = await Promise.all(cityFiles.map(file => fs.promises.access(path.join(root, file)).then(() => true, error => { if(error.code === 'ENOENT') return false; throw error; })));
    const available = present.every(Boolean);
    if(available) for(const file of cityFiles) await collect('/assets/' + file, pack);
    packSets.push([id,name,pack,available,available ? undefined : 'Import ' + name + ' city geometry and props on the host.']);
  }
  const assets = [...records.values()].sort((a,b) => a.url.localeCompare(b.url));
  const packs = packSets.map(([id,name,files,available,unavailableReason]) => {
    const urls = [...files].sort();
    return {id,name,assets:urls,bytes:urls.reduce((sum,url) => sum + records.get(url).size, 0),available,...(unavailableReason ? {unavailableReason} : {})};
  });
  return {version:digest(JSON.stringify({assets,packs})),assets,packs};
}

function createAssetCatalog({assetRoot, ttlMs = 30000, now = Date.now, build = buildAssetManifest}) {
  let value = null, expires = 0, pending = null;
  return {
    getManifest() {
      if(value && now() < expires) return Promise.resolve(value);
      if(pending) return pending;
      pending = Promise.resolve().then(() => build({assetRoot})).then(result => {
        value = result; expires = now() + ttlMs; return result;
      }).finally(() => { pending = null; });
      return pending;
    }
  };
}

module.exports = {assetReference,jsonReferences,buildAssetManifest,createAssetCatalog,TYPES};

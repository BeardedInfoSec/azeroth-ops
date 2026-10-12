const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const {assetReference,jsonReferences,buildAssetManifest,createAssetCatalog} = require('../server/asset-catalog.cjs');
const {createAssetServer} = require('../scripts/server.cjs');

// Tiny exported-asset fixtures only: never read/import real city geometry or
// start multiplayer, Chromium, WebGL, or any installed game process.
function fixture(t) {
  const artifacts = path.resolve(__dirname,'../artifacts');
  fs.mkdirSync(artifacts,{recursive:true});
  const root = fs.mkdtempSync(path.join(artifacts,'cache-fixture-'));
  t.after(() => {
    const target = path.resolve(root);
    assert.equal(path.dirname(target),artifacts);
    assert.match(path.basename(target),/^cache-fixture-/);
    fs.rmSync(target,{recursive:true,force:true});
  });
  const write = (name,value) => {
    const file = path.join(root,'public',name);
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
    return file;
  };
  write('assets/characters/manifest.json',{characters:[{file:'/assets/characters/human.json'}]});
  write('assets/characters/human.json',{texture:'/assets/characters/textures/skin.png',positions:[1,2,3]});
  write('assets/characters/textures/skin.png','skin');
  write('assets/weapons/rifle.glb','small model fixture');
  write('assets/weapons/scope_overlay.png','scope');
  write('assets/weapons/provenance.json',{source:'not needed'});
  write('assets/weapons/definitions.json',{unused:true});
  write('assets/audio/manifest.json',{shots:['/assets/audio/fire.wav']});
  write('assets/audio/fire.wav','shot');
  write('assets/effects/flash.png','flash');
  write('assets/textures/unreferenced.png','unused');
  write('assets/props/textures/shared.png','shared prop');
  for(const city of ['stormwind','stormwind-dwarven','stormwind-valley','stormwind-park','dalaran','darnassus']) {
    write('assets/'+city+'.json',{materials:[{texture:'/assets/textures/'+city+'.png'}],positions:[1,2,3]});
    write('assets/textures/'+city+'.png',city);
    write('assets/props/'+city+'.json',{models:[{texture:'textures/shared.png'}]});
  }
  return {root,assetRoot:path.join(root,'public/assets'),write};
}

test('asset references reject remote and traversal paths and preserve safe relative references',() => {
  const source = '/assets/props/stormwind.json';
  for(const bad of ['https://example.com/a.png','//example.com/a.png','C:/private/a.png','../../private.png','/assets/%2e%2e/private.json','/assets/x%5c..%5cprivate.png','/assets/x.png?secret=1','/assets/%GG.png','/assets/provenance.json']) assert.equal(assetReference(bad,source),null,bad);
  assert.equal(assetReference('../textures/wall.png',source),'/assets/textures/wall.png');
  assert.equal(assetReference('textures/my wall.png',source),'/assets/props/textures/my%20wall.png');
  assert.equal(assetReference('skin.png','/assets/my%20models/character.json'),'/assets/my%20models/skin.png');
});

test('stream scanning survives every token crossing small chunks without parsing geometry',async t => {
  const f = fixture(t);
  const file = f.write('assets/scanner.json',{numbers:Array(4096).fill(123.5),texture:'/assets/textures/stormwind.png',escaped:'contains \\ and " quotes',nested:{texture:'props/textures/shared.png'},bad:'https://example.com/a.png',extra:'x'.repeat(9000)});
  assert.deepEqual(await jsonReferences(file,'/assets/scanner.json',7),['/assets/props/textures/shared.png','/assets/textures/stormwind.png']);
});

test('city packs include exact city and prop dependencies, while shared runtime gear is deduplicated',async t => {
  const f = fixture(t), manifest = await buildAssetManifest(f);
  assert.match(manifest.version,/^[0-9a-f]{24}$/);
  assert.deepEqual(manifest.packs.map(pack => pack.id),['core','stormwind','stormwind-dwarven','stormwind-valley','stormwind-park','dalaran','darnassus']);
  const records = new Map(manifest.assets.map(asset => [asset.url,asset]));
  assert.equal(records.size,manifest.assets.length);
  for(const pack of manifest.packs) {
    assert.equal(pack.available,true);
    assert.equal(pack.bytes,pack.assets.reduce((sum,url) => sum+records.get(url).size,0));
    assert.equal(new Set(pack.assets).size,pack.assets.length);
  }
  const core = manifest.packs[0];
  for(const url of ['/assets/characters/human.json','/assets/characters/textures/skin.png','/assets/weapons/scope_overlay.png','/assets/audio/fire.wav','/assets/effects/flash.png']) assert.ok(core.assets.includes(url),url);
  assert.equal(manifest.assets.some(asset => /provenance|definitions|unreferenced/.test(asset.url)),false);
  for(const pack of manifest.packs.slice(1)) assert.deepEqual(pack.assets,[`/assets/${pack.id}.json`,`/assets/props/${pack.id}.json`,'/assets/props/textures/shared.png',`/assets/textures/${pack.id}.png`].sort());
  assert.equal(records.get('/assets/audio/fire.wav').type,'audio/wav');
  assert.equal(records.get('/assets/weapons/rifle.glb').type,'model/gltf-binary');
});

test('Stormwind district packs download only their own files; the legacy id prefers the Trade pack',async t => {
  const f = fixture(t);
  let manifest = await buildAssetManifest(f);
  assert.deepEqual(manifest.packs.find(p => p.id === 'stormwind').assets.filter(u => /stormwind/.test(u)),['/assets/props/stormwind.json','/assets/stormwind.json','/assets/textures/stormwind.png'].sort(),'full city fallback until a Trade pack exists');
  f.write('assets/stormwind-trade.json',{materials:[{texture:'/assets/textures/trade.png'}]});f.write('assets/textures/trade.png','trade');f.write('assets/props/stormwind-trade.json',{models:[{texture:'textures/shared.png'}]});
  manifest = await buildAssetManifest(f);
  const legacy = manifest.packs.find(p => p.id === 'stormwind');
  assert.ok(legacy.assets.includes('/assets/stormwind-trade.json') && legacy.assets.includes('/assets/textures/trade.png'));
  assert.equal(legacy.assets.includes('/assets/stormwind.json'),false,'the 43 MB full city is not downloaded when a Trade pack exists');
  const dwarven = manifest.packs.find(p => p.id === 'stormwind-dwarven');
  assert.equal(dwarven.name,'Stormwind: Dwarven District');
  assert.equal(dwarven.assets.includes('/assets/stormwind.json'),false);
  assert.equal(dwarven.assets.includes('/assets/textures/stormwind-valley.png'),false);
  assert.ok(dwarven.assets.includes('/assets/props/textures/shared.png'),'shared textures are listed once per URL and reused by every pack');
  fs.unlinkSync(path.join(f.assetRoot,'stormwind-park.json'));
  const park = (await buildAssetManifest(f)).packs.find(p => p.id === 'stormwind-park');
  assert.equal(park.available,false);assert.match(park.unavailableReason,/build:districts/);assert.deepEqual(park.assets,[]);
});

test('missing city imports and missing shared manifests advertise unavailable packs',async t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.assetRoot,'props/stormwind.json'));
  fs.unlinkSync(path.join(f.assetRoot,'audio/manifest.json'));
  const manifest = await buildAssetManifest(f);
  for(const id of ['core','stormwind']) {
    const pack = manifest.packs.find(item => item.id === id);
    assert.equal(pack.available,false);assert.equal(pack.bytes,0);assert.deepEqual(pack.assets,[]);assert.ok(pack.unavailableReason);
  }
  assert.equal(manifest.packs.find(item => item.id === 'dalaran').available,true);
});

test('optional imported machines and transports join core without making hosts that lack them unavailable',async t => {
  const f=fixture(t),before=await buildAssetManifest(f);
  assert.equal(before.packs[0].available,true);
  f.write('assets/machines/manifest.json',{machines:{juggernog:{model:'/assets/machines/juggernog.glb'}}});
  f.write('assets/machines/juggernog.glb','tiny model fixture');f.write('assets/machines/juggernog.png','tiny texture fixture');
  f.write('assets/machines/provenance.json',{source:'metadata only'});
  f.write('assets/transports/horde-zeppelin.json',{texture:'/assets/transports/textures/zeppelin.png'});f.write('assets/transports/textures/zeppelin.png','tiny transport texture');
  const after=await buildAssetManifest(f),core=after.packs[0];
  assert.equal(core.available,true);
  for(const url of ['/assets/machines/manifest.json','/assets/machines/juggernog.glb','/assets/machines/juggernog.png','/assets/transports/horde-zeppelin.json','/assets/transports/textures/zeppelin.png'])assert.ok(core.assets.includes(url),url);
  assert.equal(core.assets.some(url=>url.endsWith('/provenance.json')),false);
  assert.notEqual(before.version,after.version);
});

test('a changed asset invalidates the catalog version and only that asset revision',async t => {
  const f = fixture(t), before = await buildAssetManifest(f);
  const file = path.join(f.assetRoot,'textures/stormwind.png');
  fs.writeFileSync(file,'STORMWIND');
  fs.utimesSync(file,new Date(),new Date(Date.now()+3000));
  const after = await buildAssetManifest(f);
  assert.notEqual(before.version,after.version);
  const old = new Map(before.assets.map(asset => [asset.url,asset.revision]));
  assert.deepEqual(after.assets.filter(asset => old.get(asset.url)!==asset.revision).map(asset => asset.url),['/assets/textures/stormwind.png']);
});

test('missing referenced assets fail the manifest instead of advertising a complete broken pack',async t => {
  const f = fixture(t);
  f.write('assets/stormwind.json',{texture:'/assets/textures/missing.png'});
  await assert.rejects(buildAssetManifest(f),{code:'ENOENT'});
});

test('catalog refresh coalesces callers and reuses its bounded TTL; failures can retry',async() => {
  let clock = 0, calls = 0, release;
  const catalog = createAssetCatalog({assetRoot:'unused',ttlMs:30,now:() => clock,build:async() => {calls++;await new Promise(resolve => {release=resolve;});return {version:String(calls)};}});
  const a = catalog.getManifest(), b = catalog.getManifest();
  assert.equal(a,b);await Promise.resolve();assert.equal(calls,1);release();
  assert.equal((await a).version,'1');clock=29;assert.equal((await catalog.getManifest()).version,'1');
  clock=31;const c=catalog.getManifest();await Promise.resolve();assert.equal(calls,2);release();assert.equal((await c).version,'2');
  let attempts=0;
  const retry=createAssetCatalog({assetRoot:'unused',build:async() => {if(!attempts++) throw Error('temporary');return {version:'ready'};}});
  await assert.rejects(retry.getManifest(),/temporary/);assert.equal((await retry.getManifest()).version,'ready');
});

function request(port,url,options={}) {
  return new Promise((resolve,reject) => {
    const req=http.request({host:'127.0.0.1',port,path:url,...options},res => {
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    });req.on('error',reject);req.end();
  });
}

test('tiny static server provides conditional GET and HEAD with correct gzip cache metadata',async t => {
  const f=fixture(t), value={positions:[1,2,3],message:'fixture only'};
  f.write('assets/check.json',value);
  const manifest={version:'fixture',assets:[],packs:[]};
  const server=createAssetServer({root:f.root,catalog:{getManifest:async()=>manifest}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const port=server.address().port;
  const plain=await request(port,'/assets/check.json');
  assert.equal(plain.status,200);assert.deepEqual(JSON.parse(plain.body),value);
  assert.equal(plain.headers['cache-control'],'public, no-cache');assert.equal(plain.headers.vary,'Accept-Encoding');
  const gzip=await request(port,'/assets/check.json',{headers:{'accept-encoding':'gzip'}});
  assert.equal(gzip.headers['content-encoding'],'gzip');assert.deepEqual(JSON.parse(zlib.gunzipSync(gzip.body)),value);
  assert.notEqual(gzip.headers.etag,plain.headers.etag);
  const head=await request(port,'/assets/check.json',{method:'HEAD',headers:{'accept-encoding':'gzip'}});
  assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(head.headers.etag,gzip.headers.etag);assert.equal(head.headers['content-encoding'],'gzip');assert.equal(head.headers['content-length'],undefined);
  const fresh=await request(port,'/assets/check.json',{headers:{'accept-encoding':'gzip','if-none-match':gzip.headers.etag}});
  assert.equal(fresh.status,304);assert.equal(fresh.body.length,0);assert.equal(fresh.headers.vary,'Accept-Encoding');
  const since=await request(port,'/assets/check.json',{headers:{'if-modified-since':plain.headers['last-modified']}});
  assert.equal(since.status,304);
  const precedence=await request(port,'/assets/check.json',{headers:{'if-none-match':'"outdated"','if-modified-since':plain.headers['last-modified']}});
  assert.equal(precedence.status,200);
  const disabled=await request(port,'/assets/check.json',{headers:{'accept-encoding':'gzip;q=0, *;q=1'}});
  assert.equal(disabled.headers['content-encoding'],undefined);
  const catalog=await request(port,'/api/assets/manifest');
  assert.equal(catalog.headers['cache-control'],'no-store');assert.deepEqual(JSON.parse(catalog.body),manifest);
  assert.equal((await request(port,'/api/assets/manifest',{method:'POST'})).status,405);
  assert.equal((await request(port,'/assets/%2e%2e%2f%2e%2e%2fpackage.json')).status,404);
});

test('imported scorestreak models join the shared pack and omit their provenance',async t => {
  const f=fixture(t),before=await buildAssetManifest(f);
  f.write('assets/streaks/sentry.glb','tiny sentry fixture');f.write('assets/streaks/sentry_col.png','tiny texture fixture');f.write('assets/streaks/provenance.json',{source:'metadata only'});
  const after=await buildAssetManifest(f),core=after.packs[0];
  assert.equal(core.available,true);
  for(const url of ['/assets/streaks/sentry.glb','/assets/streaks/sentry_col.png'])assert.ok(core.assets.includes(url),url);
  assert.equal(core.assets.some(url=>url.endsWith('/provenance.json')),false);
  assert.notEqual(before.version,after.version);
});

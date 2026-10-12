const test=require('node:test'),assert=require('node:assert/strict'),T=require('three'),fs=require('node:fs');
const {skipUnlessAssets}=require('./helpers/assets.cjs');
test('Spawn selection rejects close enemies and occupied spots without duplicate fallback',async()=>{
  const {selectSpawns}=await import('../src/spawns.js'),v=x=>new T.Vector3(x,0,0);
  const selected=selectSpawns([v(1),v(12),v(13),v(20),v(30)],6,{threats:[v(0)],occupied:[v(20)],minDistance:10,spacing:4,random:()=>0});
  assert.deepEqual(selected.map(p=>p.x),[12,30]);
});
test('Randomness changes valid deployments without defeating separation',async()=>{
  const {selectSpawns}=await import('../src/spawns.js'),points=[12,24,36].map(x=>new T.Vector3(x,0,0));
  const first=selectSpawns(points,1,{random:()=>0})[0].x;let i=0;const second=selectSpawns(points,1,{random:()=>++i/4})[0].x;assert.notEqual(first,second);
});
test('Spawn clearance rejects ledges, obstructed headroom and nearby props',async()=>{
  const {clearSpawn}=await import('../src/spawns.js'),origin=new T.Vector3(),floor=(x,z)=>({point:new T.Vector3(x,0,z),face:{normal:new T.Vector3(0,1,0)}});
  assert.ok(clearSpawn(origin,floor,()=>false));assert.equal(clearSpawn(origin,()=>null,()=>false),false);assert.equal(clearSpawn(origin,floor,()=>true),false);
  assert.equal(clearSpawn(origin,(x,z)=>x>.2?null:floor(x,z),()=>false),false);
});
test('Muzzle images retain source provenance and original weapon effect references',skipUnlessAssets('effects/provenance.json'),()=>{
  const p=JSON.parse(fs.readFileSync('public/assets/effects/provenance.json'));assert.ok(p.weapons.an94_mp.viewFlashEffect.endsWith('fx_muz_ar_flash_1p'));assert.ok(p.weapons.scar_mp.viewFlashEffect.endsWith('5_star_mb'));
  for(const image of p.images){assert.ok(fs.existsSync('public'+image.file));assert.match(image.sourceSha256,/^[a-f0-9]{64}$/);}
});

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {resolveFile}=require('../scripts/server.cjs');
test('server restricts files to its public and module roots',()=>{
  assert.equal(resolveFile('/src/%2e%2e%2fpackage.json'),null);
  assert.equal(resolveFile('/vendor/three/%2e%2e%2f%2e%2e%2fpackage.json'),null);
  assert.equal(resolveFile('/%GG'),null);
  assert.equal(path.basename(resolveFile('/')),'index.html');
});
for(const city of ['stormwind','dalaran','darnassus'])test(city+' has complete geometry references and decoded textures',()=>{
  const data=JSON.parse(fs.readFileSync(`public/assets/${city}.json`));
  assert.ok(data.groups.length>50);assert.ok(data.materials.length>20);
  for(const m of data.materials)if(m.texture)assert.ok(fs.existsSync('public'+m.texture),m.texture);
  for(const g of data.groups){
    assert.equal(g.positions.length%3,0);assert.equal(g.uv.length/2,g.positions.length/3);
    assert.ok(g.positions.every(Number.isFinite));
    for(const b of g.batches){assert.ok(b.material<data.materials.length);assert.ok(b.start+b.count<=g.indices.length);assert.equal(b.count%3,0);}
    assert.ok(g.indices.every(i=>i>=0&&i<g.positions.length/3));
  }
});
test('BO2 rifles, snipers, scopes and magazines reference real PNG textures',()=>{
  const dir='public/assets/weapons';const files=fs.readdirSync(dir).filter(f=>f.endsWith('.glb'));assert.equal(files.length,26);
  for(const file of files){const b=fs.readFileSync(path.join(dir,file));assert.equal(b.readUInt32LE(8),b.length);const gltf=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));assert.ok(gltf.meshes.length);for(const img of gltf.images)assert.ok(fs.existsSync(path.join(dir,img.uri)),img.uri);}
});

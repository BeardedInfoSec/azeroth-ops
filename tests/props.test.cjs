const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {hasAssets,skipUnlessAssets}=require('./helpers/assets.cjs');
const city=hasAssets('props/stormwind.json')?JSON.parse(fs.readFileSync('public/assets/props/stormwind.json')):null;
test('Stormwind default set imports every placement including fountains and wagons',skipUnlessAssets('props/stormwind.json'),()=>{
  assert.equal(city.instances.length,6157);assert.deepEqual(city.skipped,[]);
  for(const name of ['stormwindfountain01.m2','stormwindgypsywagon01.m2']){
    const model=city.models.findIndex(m=>m.source.endsWith(name));assert.ok(model>=0);
    assert.ok(city.instances.some(i=>i.model===model));assert.ok(city.models[model].collision.indices.length>0);
  }
  const fountain=city.instances.find(i=>city.models[i.model].source.endsWith('stormwindfountain01.m2')&&Math.abs(i.position[0]+124.66)<.1);
  assert.ok(Math.abs(fountain.position[2]-40.87)<.1,'Original Trade District fountain placement');
});
test('All prop materials, instance transforms and collision indices are usable',skipUnlessAssets('props/stormwind.json'),()=>{
  for(const m of city.models){
    assert.ok(m.positions.every(Number.isFinite));assert.equal(m.uv.length,m.positions.length/3*2);
    for(const p of m.parts){assert.ok(fs.existsSync('public'+p.texture));assert.equal(p.indices.length%3,0);assert.ok(p.indices.every(i=>i<m.positions.length/3));}
    assert.equal(m.collision.indices.length%3,0);assert.ok(m.collision.positions.every(Number.isFinite));assert.ok(m.collision.indices.every(i=>i<m.collision.positions.length/3));
  }
  for(const i of city.instances){assert.ok(city.models[i.model]);assert.ok(i.scale>0);assert.ok(i.position.every(Number.isFinite));assert.ok(Math.abs(Math.hypot(...i.rotation)-1)<.01);}
});

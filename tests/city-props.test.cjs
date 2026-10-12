const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {skipUnlessAssets}=require('./helpers/assets.cjs');
const root=path.resolve(__dirname,'../public/assets');
const read=city=>JSON.parse(fs.readFileSync(path.join(root,'props',city+'.json'),'utf8'));

test('All three Wrath cities retain original default-set props and resolved textures',skipUnlessAssets('props/stormwind.json','props/dalaran.json','props/darnassus.json'),()=>{
  const expected={stormwind:6157,dalaran:4631,darnassus:1073};
  for(const [city,count] of Object.entries(expected)){
    const props=read(city);assert.equal(props.city,city);assert.equal(props.set,'Set_$DefaultGlobal');assert.equal(props.instances.length,count);assert.equal(new Set(props.instances.map(i=>i.sourceIndex)).size,count);
    for(const instance of props.instances){assert.ok(props.models[instance.model]);assert.equal(instance.position.length,3);assert.equal(instance.rotation.length,4);assert.ok([...instance.position,...instance.rotation,instance.scale].every(Number.isFinite));}
    for(const model of props.models){assert.match(model.source,/\.m2$/i);for(const part of model.parts)assert.ok(fs.existsSync(path.join(root,'..',part.texture.slice(1))),'Missing '+part.texture);}
    assert.equal(props.skipped.length,city==='dalaran'?1:0);if(city==='dalaran'){assert.match(props.skipped[0].reason,/No textured geometry/);assert.equal(props.sourceInstances-count,2);}
  }
});

const packIds=['stormwind-trade','stormwind-dwarven','stormwind-valley','stormwind-park'];
// Districts load their clipped pack when present (else the full city); the arena must match that exact source.
async function sourceFor(city){
  const {cityAssetCandidates}=await import('../src/districts.mjs');
  for(const c of cityAssetCandidates(city))if(fs.existsSync(path.join(root,c.geometry))&&fs.existsSync(path.join(root,c.props)))return {props:JSON.parse(fs.readFileSync(path.join(root,c.props),'utf8')),base:JSON.parse(fs.readFileSync(path.join(root,c.geometry),'utf8'))};
  throw new Error('no source for '+city);
}

test('Server movement and shot cover include every city prop instance',skipUnlessAssets('stormwind.json','dalaran.json','darnassus.json','props/stormwind.json','props/dalaran.json','props/darnassus.json'),async()=>{
  const {loadArena}=await import('../server/world.mjs');
  for(const city of ['stormwind','dalaran','darnassus']){
    const {props,base}=await sourceFor(city);
    const cityIndices=base.groups.reduce((sum,group)=>sum+group.batches.filter(batch=>base.materials[batch.material]?.blend<=1).reduce((n,batch)=>n+batch.count,0),0);
    const hullIndices=props.instances.reduce((sum,instance)=>sum+props.models[instance.model].collision.indices.length,0);
    const visibleIndices=props.instances.reduce((sum,instance)=>sum+props.models[instance.model].parts.filter(part=>part.blend===0).reduce((n,part)=>n+part.indices.length,0),0);
    const arena=await loadArena(city);assert.equal(arena.collider.geometry.index.count,cityIndices+hullIndices,city+' movement hulls');assert.equal(arena.shots.geometry.index.count,cityIndices+hullIndices+visibleIndices,city+' shot cover');assert.ok(arena.spawns.length>=20,city+' safe spawn pool');
  }
});

test('District prop packs keep original instance ids, the original total and stable model numbers',skipUnlessAssets('props/stormwind.json',...packIds.map(id=>id+'.json'),...packIds.map(id=>'props/'+id+'.json')),async()=>{
  const full=read('stormwind'),{layoutInstances}=await import('../src/layout-objects.js');
  for(const id of packIds){
    const pack=read(id);assert.equal(pack.instanceCount,full.instances.length,id+' records the original instance total');assert.equal(pack.models.length,full.models.length,id+' keeps model numbering');
    assert.ok(pack.instances.length>0&&pack.instances.length<full.instances.length);
    for(const instance of pack.instances){
      const original=full.instances[instance.index];assert.ok(original,id+' index '+instance.index);
      assert.deepEqual(instance.position,original.position);assert.equal(instance.model,original.model);assert.equal(instance.sourceIndex,original.sourceIndex);
      assert.equal(pack.models[instance.model].stub,undefined,id+' used models are complete');assert.equal(pack.models[instance.model].source,full.models[instance.model].source);
    }
    for(const [i,model] of pack.models.entries())assert.equal(model.source,full.models[i].source);
    // hiddenProps refers to ORIGINAL ids: hiding one removes exactly that instance from the pack, hiding an outside id changes nothing.
    const first=pack.instances[0].index,outside=full.instances.findIndex((_,i)=>!pack.instances.some(p=>p.index===i));
    assert.equal(layoutInstances(pack,{hiddenProps:[first]}).length,pack.instances.length-1);assert.equal(layoutInstances(pack,{hiddenProps:[outside]}).length,pack.instances.length);
  }
});

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../public/assets');
const read=city=>JSON.parse(fs.readFileSync(path.join(root,'props',city+'.json'),'utf8'));

test('All three Wrath cities retain original default-set props and resolved textures',()=>{
  const expected={stormwind:6157,dalaran:4631,darnassus:1073};
  for(const [city,count] of Object.entries(expected)){
    const props=read(city);assert.equal(props.city,city);assert.equal(props.set,'Set_$DefaultGlobal');assert.equal(props.instances.length,count);assert.equal(new Set(props.instances.map(i=>i.sourceIndex)).size,count);
    for(const instance of props.instances){assert.ok(props.models[instance.model]);assert.equal(instance.position.length,3);assert.equal(instance.rotation.length,4);assert.ok([...instance.position,...instance.rotation,instance.scale].every(Number.isFinite));}
    for(const model of props.models){assert.match(model.source,/\.m2$/i);for(const part of model.parts)assert.ok(fs.existsSync(path.join(root,'..',part.texture.slice(1))),'Missing '+part.texture);}
    assert.equal(props.skipped.length,city==='dalaran'?1:0);if(city==='dalaran'){assert.match(props.skipped[0].reason,/No textured geometry/);assert.equal(props.sourceInstances-count,2);}
  }
});

test('Server movement and shot cover include every city prop instance',async()=>{
  const {loadArena}=await import('../server/world.mjs');
  for(const city of ['stormwind','dalaran','darnassus']){
    const props=read(city),base=JSON.parse(fs.readFileSync(path.join(root,city+'.json'),'utf8'));
    const cityIndices=base.groups.reduce((sum,group)=>sum+group.batches.filter(batch=>base.materials[batch.material]?.blend<=1).reduce((n,batch)=>n+batch.count,0),0);
    const hullIndices=props.instances.reduce((sum,instance)=>sum+props.models[instance.model].collision.indices.length,0);
    const visibleIndices=props.instances.reduce((sum,instance)=>sum+props.models[instance.model].parts.filter(part=>part.blend===0).reduce((n,part)=>n+part.indices.length,0),0);
    const arena=await loadArena(city);assert.equal(arena.collider.geometry.index.count,cityIndices+hullIndices,city+' movement hulls');assert.equal(arena.shots.geometry.index.count,cityIndices+hullIndices+visibleIndices,city+' shot cover');assert.ok(arena.spawns.length>=20,city+' safe spawn pool');
  }
});

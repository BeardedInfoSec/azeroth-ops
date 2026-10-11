const test=require('node:test'),assert=require('node:assert/strict');

async function fixture(){
  const T=await import('three'),api=await import('../src/muzzle-effects.mjs');
  const scene=new T.Scene(),atlases=new Map(['fxt_fire_gas_flash','fxt_fire_flame_vert_c','fxt_fire_flame_vert_e'].map(name=>[name,[new T.Texture(),new T.Texture()]]));
  const lights=api.createMuzzleLights(scene);
  return {T,scene,atlases,lights,...api};
}
const visibleLights=scene=>{const lights=[];scene.traverseVisible(object=>{if(object.isPointLight)lights.push(object);});return lights;};

test('firing, expiry and hidden weapons preserve a fixed scene-level light count',async()=>{
  const f=await fixture(),weapon=new f.T.Group(),effect=f.createMuzzleEffect(f.atlases,f.lights);f.scene.add(weapon);weapon.add(effect.group);
  const permanent=visibleLights(f.scene);assert.equal(permanent.length,2);assert.ok(permanent.every(light=>light.intensity===0&&light.parent===f.scene));
  effect.trigger();assert.deepEqual(visibleLights(f.scene),permanent);assert.equal(permanent.filter(light=>light.intensity>0).length,1);
  weapon.visible=false;f.lights.update(0);assert.deepEqual(visibleLights(f.scene),permanent);assert.ok(permanent.every(light=>light.intensity===0));
  weapon.visible=true;effect.update(.06);f.lights.update(.06);assert.equal(effect.group.visible,false);assert.deepEqual(visibleLights(f.scene),permanent);assert.ok(permanent.every(light=>light.intensity===0));
  effect.dispose();f.lights.dispose();
});

test('muzzle lighting follows the transformed barrel and fades without changing atlas playback',async()=>{
  const f=await fixture(),weapon=new f.T.Group(),effect=f.createMuzzleEffect(f.atlases,f.lights);f.scene.add(weapon);weapon.add(effect.group);weapon.position.set(10,3,4);effect.group.position.set(0,0,-1);
  effect.trigger(1);let light=visibleLights(f.scene).find(item=>item.intensity>0);assert.deepEqual(light.position.toArray(),[10,3,3]);assert.ok(f.atlases.get('fxt_fire_flame_vert_e').includes(effect.group.children[1].material.map));
  weapon.position.x=15;effect.update(.0275);f.lights.update(.0275);assert.deepEqual(light.position.toArray(),[15,3,3]);assert.equal(light.intensity,1.25);assert.equal(effect.group.children[0].material.opacity,.35);
  f.lights.reset();assert.ok(visibleLights(f.scene).every(item=>item.intensity===0));effect.dispose();f.lights.dispose();
});

test('world flashes reuse a bounded set of sprites and materials through repeated shots',async()=>{
  const f=await fixture(),pool=f.createMuzzlePool(f.scene,()=>f.createMuzzleEffect(f.atlases,f.lights),4),children=[...f.scene.children];
  const materials=children.filter(item=>item.isGroup).flatMap(group=>group.children.map(sprite=>sprite.material));let disposed=0;materials.forEach(material=>material.addEventListener('dispose',()=>disposed++));
  const point=new f.T.Vector3();for(let i=0;i<1000;i++){point.set(i,0,0);pool.trigger(point,i%2);pool.update(.002);f.lights.update(.002);}
  assert.deepEqual(f.scene.children,children);assert.equal(materials.length,8);assert.equal(disposed,0);assert.equal(visibleLights(f.scene).length,2);
  assert.deepEqual(children.filter(item=>item.isGroup).flatMap(group=>group.children.map(sprite=>sprite.material)),materials);
  pool.update(.06);f.lights.update(.06);assert.ok(children.filter(item=>item.isGroup).every(group=>!group.visible));assert.ok(visibleLights(f.scene).every(light=>light.intensity===0));
  pool.trigger(point);pool.reset();f.lights.update(0);assert.ok(children.filter(item=>item.isGroup).every(group=>!group.visible));assert.ok(visibleLights(f.scene).every(light=>light.intensity===0));
  pool.dispose();assert.equal(disposed,8);assert.equal(f.scene.children.length,2);f.lights.dispose();assert.equal(f.scene.children.length,0);
});

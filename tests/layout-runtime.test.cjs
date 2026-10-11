const test=require('node:test'),assert=require('node:assert/strict');

test('Hidden props and additional WoW placements produce one deterministic instance list without changing source assets',async()=>{
  const {layoutInstances}=await import('../src/layout-objects.js');
  const source={models:[{},{}],instances:[{model:0,position:[1,2,3],rotation:[0,0,0,1],scale:1},{model:1,position:[4,5,6],rotation:[0,0,0,1],scale:2}]};
  const before=JSON.stringify(source),layout={hiddenProps:[0],placements:[{id:'a',prefabId:'wow:0',position:[8,2,3],rotation:Math.PI,scale:.5,solid:false}]};
  const result=layoutInstances(source,layout);
  assert.equal(result.length,2);assert.equal(result[0].model,1);assert.equal(result[0].solid,true);
  assert.equal(result[1].solid,false);assert.equal(result[1].scale,.5);assert.deepEqual(result[1].position,[8,2,3]);
  assert.ok(Math.abs(result[1].rotation[1]-1)<1e-8);assert.equal(JSON.stringify(source),before);
});

test('Placed cover produces matching rendered, walking and shot geometry with rotation and scale',async()=>{
  const T=await import('three'),{createLayoutPrefab,appendObjectGeometry,appendLayoutCollision,disposeLayoutObject}=await import('../src/layout-objects.js');
  const item={id:'cover',prefabId:'cart',position:[10,2,-7],rotation:Math.PI/2,scale:1.5,solid:true};
  const visual=createLayoutPrefab(item),positions=[],indices=[],walk=[],walkIndices=[],shots=[],shotIndices=[];
  appendObjectGeometry(visual,positions,indices);appendLayoutCollision({placements:[item]},walk,walkIndices,shots,shotIndices);
  assert.deepEqual(walk,positions);assert.deepEqual(shots,positions);assert.deepEqual(walkIndices,indices);assert.deepEqual(shotIndices,indices);
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(walk,3));geometry.setIndex(walkIndices);
  const mesh=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));
  const ray=new T.Raycaster(new T.Vector3(10,3.5,-12),new T.Vector3(0,0,1),0,12);
  assert.ok(ray.intersectObject(mesh).length,'The visible crate on the cart also stops a shot');
  geometry.dispose();mesh.material.dispose();disposeLayoutObject(visual);
});

test('Scenery-only placements add no walking or shot collision',async()=>{
  const {appendLayoutCollision}=await import('../src/layout-objects.js'),p=[],i=[],s=[],si=[];
  appendLayoutCollision({placements:[{id:'scenery',prefabId:'crate',position:[0,0,0],rotation:0,scale:1,solid:false}]},p,i,s,si);
  assert.deepEqual([p,i,s,si],[[],[],[],[]]);
});

test('Spooky lighting grades unlit city materials once, restores daylight and keeps the light count fixed',async()=>{
  const T=await import('three'),{CityAtmosphere}=await import('../src/atmosphere.js');
  const scene=new T.Scene(),hemi=new T.HemisphereLight(),sun=new T.DirectionalLight(),ambient=new T.AmbientLight();scene.add(hemi,sun,ambient);
  const group=new T.Group(),material=new T.MeshBasicMaterial({color:0xced0d2}),geometry=new T.BoxGeometry(1,1,1);
  group.add(new T.Mesh(geometry,material),new T.Mesh(geometry,material));scene.add(group);
  const initial=material.color.clone(),controller=new CityAtmosphere({scene,hemi,sun,ambient}),arena={sky:0x91b8d0,fog:0xa7c3cd};
  controller.apply({group},arena,'spooky');const night=material.color.clone();assert.ok(night.r<initial.r);assert.equal(scene.fog.far,112);
  controller.apply({group},arena,'spooky');assert.ok(material.color.equals(night));
  controller.apply({group},arena,'day');assert.ok(material.color.equals(initial));assert.equal(scene.background.getHex(),arena.sky);assert.equal(scene.children.filter(o=>o.isLight).length,3);
  geometry.dispose();material.dispose();
});

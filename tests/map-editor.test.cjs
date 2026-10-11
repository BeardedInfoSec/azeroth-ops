const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createMapLayouts,readPropMetadata}=require('../server/map-layouts.cjs');
const {createAssetServer}=require('../scripts/server.cjs');
const schema=import(pathToFileURL(path.resolve(__dirname,'../src/map-layout.mjs')).href);

function fixture(t){
  const base=path.resolve(__dirname,'../artifacts');fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'map-editor-fixture-'));
  t.after(()=>{const target=path.resolve(root);assert.equal(path.dirname(target),base);assert.match(path.basename(target),/^map-editor-fixture-/);fs.rmSync(target,{recursive:true,force:true});});
  const write=(name,value)=>{const file=path.join(root,'public',name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));return file;};
  write('assets/props/stormwind.json',{models:[{source:'world\\cart.m2',positions:[0,0,0,1,2,3],uv:[0,0],collision:{positions:[0,0,0],indices:[0]},parts:[{indices:[0],texture:'/assets/props/a.png'}]}],instances:[{model:0,position:[-141,-8.02,3],rotation:[0,0,0,1],scale:1}]});
  write('assets/machines/manifest.json',{machines:{quick_revive:{model:'/assets/machines/revive.glb'},missing:{model:'/assets/machines/missing.glb'},evil:{model:'/assets/machines/../../private.glb'}}});
  write('assets/machines/revive.glb','small fixture');
  return {root,write};
}
function placed(defaultLayout){const layout=defaultLayout('stormwind');layout.placements.push({id:'test-crate',prefabId:'crate',position:[-135,-8,6],rotation:.5,scale:1,solid:true});return layout;}

test('layout schema validates transforms, known catalog entries, and original indexes',async()=>{
  const {defaultLayout,validateLayout}=await schema,layout=placed(defaultLayout),options={city:'stormwind',prefabIds:new Set(['crate','machine:quick_revive']),instanceCount:2};
  layout.hiddenProps=[1,1,0];assert.deepEqual(validateLayout(layout,options).hiddenProps,[0,1]);
  for(const change of [l=>l.placements[0].position[0]=NaN,l=>l.placements[0].scale=0,l=>l.placements[0].prefabId='wow:999',l=>l.placements.push({...l.placements[0]}),l=>l.hiddenProps=[2],l=>l.city='dalaran',l=>l.settings.fortifications='anything']){const invalid=structuredClone(layout);change(invalid);assert.throws(()=>validateLayout(invalid,options));}
  layout.placements[0].prefabId='machine:quick_revive';assert.equal(validateLayout(layout,options).placements[0].prefabId,'machine:quick_revive');
  assert.throws(()=>defaultLayout('../stormwind'));assert.throws(()=>defaultLayout('__proto__'));
});
test('undo and redo preserve full layout and discard abandoned edits',async()=>{
  const {defaultLayout,LayoutHistory}=await schema,layout=defaultLayout('stormwind'),history=new LayoutHistory(layout,3);layout.settings.fortifications='off';history.push(layout);layout.hiddenProps=[3];history.push(layout);assert.deepEqual(history.undo().hiddenProps,[]);assert.deepEqual(history.redo().hiddenProps,[3]);history.undo();layout.hiddenProps=[4];history.push(layout);assert.equal(history.canRedo,false);assert.deepEqual(history.undo().hiddenProps,[]);assert.equal(history.undo().settings.fortifications,'light');
});
test('metadata reader skips geometry across chunk boundaries and keeps exact instance transforms',async t=>{
  const f=fixture(t),expected={models:[{source:'a quote " and \\ path.m2',positions:Array(4000).fill(12.25),uv:[1,2],parts:[{indices:[0,1],texture:'a.png'}],collision:{positions:[0,0,0],indices:[0]}}],instances:[{model:0,position:[1,-2,3],rotation:[0,0,0,1],scale:.8}]};
  const file=f.write('assets/props/tiny.json',expected),value=await readPropMetadata(file,{highWaterMark:7});assert.deepEqual(value.models[0].positions,[]);assert.deepEqual(value.models[0].collision.positions,[]);assert.deepEqual(value.models[0].parts[0].indices,[]);assert.equal(value.models[0].source,expected.models[0].source);assert.deepEqual(value.instances,expected.instances);
  await assert.rejects(()=>readPropMetadata(file,{maxInput:100}),/limit/);await assert.rejects(()=>readPropMetadata(file,{maxOutput:10}),/limit/);
});
test('catalog exposes real imported sources and available machines without mesh data',async t=>{
  const f=fixture(t),service=createMapLayouts({root:f.root}),catalog=await service.catalog('stormwind');assert.equal(catalog.instanceCount,1);assert.deepEqual(catalog.instances[0].position,[-141,-8.02,3]);assert.equal(catalog.prefabs.find(p=>p.id==='wow:0').name,'cart');assert.ok(catalog.prefabs.find(p=>p.id==='machine:quick_revive'));assert.ok(!catalog.prefabs.some(p=>p.id==='machine:missing'||p.id==='machine:evil'));assert.ok(!JSON.stringify(catalog).includes('positions'));assert.equal(await service.catalog('stormwind'),catalog);
});
test('layout saves are atomic, scoped and leave imported props unchanged',async t=>{
  const f=fixture(t),service=createMapLayouts({root:f.root}),{defaultLayout}=await schema,original=fs.readFileSync(path.join(f.root,'public/assets/props/stormwind.json'),'utf8');assert.deepEqual(await service.readLayout('stormwind'),defaultLayout('stormwind'));
  const layout=placed(defaultLayout);layout.hiddenProps=[0];await service.saveLayout('stormwind',layout);assert.deepEqual(await service.readLayout('stormwind'),layout);assert.equal(fs.readFileSync(path.join(f.root,'public/assets/props/stormwind.json'),'utf8'),original);assert.deepEqual(fs.readdirSync(path.join(f.root,'public/assets/layouts')),['stormwind.json']);
  await assert.rejects(()=>service.saveLayout('../dalaran',layout),/Unknown city/);layout.placements[0].prefabId='wow:9';await assert.rejects(()=>service.saveLayout('stormwind',layout),/Unavailable/);
});
test('HTTP editor routes support validated saves and reject cross-origin writes',async t=>{
  const f=fixture(t),{defaultLayout}=await schema,server=createAssetServer({root:f.root,catalog:{getManifest:async()=>({})}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));const base='http://127.0.0.1:'+server.address().port;
  const initial=await fetch(base+'/api/layouts/stormwind');assert.equal(initial.status,200);assert.equal(initial.headers.get('cache-control'),'no-store');const layout=placed(defaultLayout);
  const save=await fetch(base+'/api/layouts/stormwind',{method:'PUT',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(layout)});assert.equal(save.status,200);assert.deepEqual(await save.json(),layout);
  const wrongOrigin=await fetch(base+'/api/layouts/stormwind',{method:'PUT',headers:{'Content-Type':'application/json',Origin:'http://example.test'},body:JSON.stringify(layout)});assert.equal(wrongOrigin.status,403);
  const wrongType=await fetch(base+'/api/layouts/stormwind',{method:'PUT',body:JSON.stringify(layout)});assert.equal(wrongType.status,415);
  const wrongAsset=structuredClone(layout);wrongAsset.placements[0].prefabId='wow:999';assert.equal((await fetch(base+'/api/layouts/stormwind',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(wrongAsset)})).status,400);
  assert.equal((await fetch(base+'/api/layouts/stormwind',{method:'POST'})).status,405);assert.equal((await fetch(base+'/api/editor/catalog?city=stormwind')).status,200);assert.equal((await fetch(base+'/api/layouts/unknown')).status,400);
});

const logic=import(pathToFileURL(path.resolve(__dirname,'../src/editor-logic.mjs')).href);
test('placement math snaps X/Z, follows real ground height and clamps to the layout limits',async()=>{
  const {placementFromHit,placementFromTransform,uniformScale,snapValue}=await logic,{validateLayout,defaultLayout}=await schema;
  assert.equal(snapValue(1.26,.5),1.5);assert.equal(snapValue(1.26,0),1.26);
  assert.deepEqual(placementFromHit({x:10.3,y:-7.9876,z:-3.74},{snap:1,offset:.5}),[10,-7.488,-4]);
  assert.deepEqual(placementFromHit({x:99999,y:0,z:-99999}),[10000,0,-10000]);
  const t=placementFromTransform({position:[1.23456,2,NaN],rotationY:Math.PI*500,scale:99});assert.deepEqual(t.position,[1.235,2,0]);assert.ok(t.rotation<Math.PI*200);assert.equal(t.scale,6);
  const layout=defaultLayout('stormwind');layout.placements.push({id:'a',prefabId:'crate',position:t.position,rotation:t.rotation,scale:t.scale,solid:true});assert.doesNotThrow(()=>validateLayout(layout,{city:'stormwind'}));
  assert.equal(uniformScale(1,[1,2.5,1]),2.5);assert.equal(uniformScale(1,[1,1,1]),1);assert.equal(uniformScale(1,[.01,.01,.01]),.1);
});
test('cutaway filtering hides geometry above the level and picks the first surface below it',async()=>{
  const {cutawayRange,cutawayLevel,visibleAtCutaway,filterByCutaway,firstHitBelow}=await logic;
  assert.deepEqual(cutawayRange(-8.4,42.2),{min:-9,max:44});assert.deepEqual(cutawayRange(NaN,1),{min:-10,max:60});
  assert.equal(cutawayLevel(.5,0,100),50);assert.equal(cutawayLevel(2,0,100),100);
  assert.ok(visibleAtCutaway(10,10));assert.ok(!visibleAtCutaway(10.1,10));assert.ok(visibleAtCutaway(1e6,Infinity));
  assert.deepEqual(filterByCutaway([{position:[0,1,0]},{position:[0,30,0]}],5).length,1);
  const hits=[{point:{y:30},id:'roof'},{point:{y:2},id:'floor'}];assert.equal(firstHitBelow(hits,5).id,'floor');assert.equal(firstHitBelow(hits,Infinity).id,'roof');assert.equal(firstHitBelow(hits,-1),null);assert.equal(firstHitBelow(null,0),null);
});
test('clicked instances map back to original prop ids and collision probes ignore ground contact',async()=>{
  const {buildPropIndex,findInstanceAt,probeBox}=await logic,index=buildPropIndex([{id:0,model:1,position:[1,2,3]},{id:7,model:1,position:[-50.001,0,9]},{id:8,model:2,position:[-50,0,9]}]);
  assert.equal(findInstanceAt(index,[1.0004,2,3]).id,0);assert.equal(findInstanceAt(index,[-50.0005,0,9],{model:2}).id,8);assert.equal(findInstanceAt(index,[1.5,2,3]),null);assert.equal(findInstanceAt(index,[500,0,0]),null);
  const probe=probeBox([0,0,0],[2,2,2]);assert.ok(probe.min[1]>0&&probe.max[0]<2);assert.equal(probeBox([0,0,0],[.05,.05,.05]),null);
});
test('camera helpers move in the look direction, pan the plan view and cap pixel ratio',async()=>{
  const {flyStep,planStep,lookLimits,orthoFrustum,clampViewSize,cappedPixelRatio}=await logic,pose={position:[0,0,0],yaw:0,pitch:0};
  const forward=flyStep(pose,new Set(["w"]),.1,{speed:10});assert.ok(Math.abs(forward[2]+1)<1e-9&&Math.abs(forward[0])<1e-9);
  assert.ok(flyStep(pose,new Set(["d"]),.1,{speed:10})[0]>.99);assert.ok(flyStep(pose,new Set(["e"]),.1,{speed:10})[1]>.99);assert.equal(flyStep(pose,new Set(["w"]),.1,{speed:10,fast:true})[2],-4);assert.deepEqual(flyStep(pose,new Set(),1),[0,0,0]);
  assert.ok(planStep({x:0,z:0},new Set(['w']),.1,100).z<0);assert.ok(lookLimits(5)<Math.PI/2&&lookLimits(-5)>-Math.PI/2);
  const f=orthoFrustum(200,100,50);assert.deepEqual([f.left,f.right,f.top,f.bottom],[-50,50,25,-25]);assert.equal(clampViewSize(1),8);
  assert.equal(cappedPixelRatio(3),1.5);assert.equal(cappedPixelRatio(2,true),1);assert.equal(cappedPixelRatio(NaN),1);
});
test('editor page resolves three addons through the importmap and every element id the script uses exists',()=>{
  const {resolveFile}=require('../scripts/server.cjs'),html=fs.readFileSync(path.resolve(__dirname,'../public/editor.html'),'utf8'),source=fs.readFileSync(path.resolve(__dirname,'../src/editor.js'),'utf8');
  const map=JSON.parse(html.match(/<script type="importmap">(.*?)<\/script>/s)[1]).imports;assert.equal(map['three/addons/'],'/vendor/three/examples/jsm/');assert.ok(map.three&&map['three-mesh-bvh']);
  const file=resolveFile(map['three/addons/']+'controls/TransformControls.js');assert.ok(file&&fs.existsSync(file));
  const ids=new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m=>m[1]));for(const m of source.matchAll(/\$\('([a-z0-9-]+)'\)/g))assert.ok(ids.has(m[1]),'missing #'+m[1]);
});

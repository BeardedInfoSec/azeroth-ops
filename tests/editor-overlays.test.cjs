const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const {createAssetServer}=require('../scripts/server.cjs');
const load=file=>import(pathToFileURL(path.resolve(__dirname,file)).href);
const overlays=load('../server/editor-overlays.mjs'),logic=load('../src/editor-logic.mjs'),THREE=import('three');

// Flat, unobstructed synthetic arena: CPU only, no city files.
async function flatArena(){
  const T=await THREE,vec=(x,y,z)=>new T.Vector3(x,y,z);
  return {city:'stormwind',layout:{placements:[],hiddenProps:[],settings:{fortifications:'light'}},survivalSpawn:vec(0,1.7,0),collider:null,blocked:()=>false,
    floorAt:(x,z)=>({point:vec(x,0,z),face:{normal:{y:1}}}),spawns:Array.from({length:700},(_,i)=>vec(i%30,0,Math.floor(i/30)))};
}

test('placements computed from the real SurvivalWorld on a flat fixture',async()=>{
  const {computeOverlays}=await overlays,arena=await flatArena(),result=computeOverlays(arena,'light');
  const by=kind=>result.items.filter(i=>i.kind===kind);
  assert.equal(by('breach').length,9,'three breaches per stage');
  for(const zone of [0,1,2])assert.equal(by('breach').filter(i=>i.zone===zone).length,3);
  assert.equal(by('perk').length+by('pack').length,13);assert.equal(by('pack').length,1);
  assert.equal(by('weapon').length,3);assert.ok(by('gate').length>=1&&by('wall').length>0);
  assert.ok(by('spawn').length<=1200&&by('spawn').length>100);assert.equal(by('origin').length,1);
  for(const item of result.items)assert.ok(item.position.length===3&&item.position.every(Number.isFinite)&&typeof item.label==='string');
  assert.ok(JSON.stringify(result).length<400*1024);
  const off=computeOverlays(arena,'off');assert.equal(off.fortifications,'off');assert.ok(!off.items.some(i=>i.kind==='gate'));assert.notEqual(off.counts.wall,result.counts.wall);
  assert.deepEqual(computeOverlays(arena,'bogus').fortifications,'light');
});
test('overlayFromWorld is pure over plain world records',async()=>{
  const {overlayFromWorld}=await overlays,v=(x,y,z)=>({x,y,z});
  const world={fortifications:'classic',zoneNames:['A','B','C'],windows:[{id:'w1',zone:1,spawnPoint:v(1.234,2,3),mesh:{rotation:{y:.5}}}],machines:[{id:'perk-a',type:'perk',zone:0,name:'Jug',cost:2500,mesh:{position:v(1,0,2),rotation:{y:0}}}],weaponBuys:[{id:'weapon-0',zone:0,name:'M1',cost:500,mesh:{position:v(0,0,0),rotation:{y:0}}}],barriers:[{id:'g',type:'gate',level:1,cost:750,width:2.6,height:3,depth:1.3,mesh:{position:v(5,0,5),rotation:{y:1}}},{id:'win',type:'window',level:1,mesh:{position:v(0,0,0),rotation:{y:0}}}]};
  const out=overlayFromWorld(world,{spawns:[v(1,1,1)]});
  assert.deepEqual(out.items.map(i=>i.kind),['breach','perk','weapon','gate','spawn']);assert.deepEqual(out.items[0].position,[1.23,2,3]);assert.equal(out.counts.gate,1);
});
test('service caches per city, layout and preset, shares in-flight work and stays bounded',async()=>{
  const {createOverlayService}=await overlays;let loads=0,computes=0;const layout={placements:[],hiddenProps:[]};
  const service=createOverlayService({max:2,loadArena:async()=>{loads++;return {layout};},compute:(arena,fort)=>{computes++;return {fortifications:fort,items:[],counts:{}};}});
  const [a,b]=await Promise.all([service.get('stormwind','light'),service.get('stormwind','light')]);assert.equal(a,b);assert.equal(computes,1);
  await service.get('stormwind','classic');await service.get('stormwind','off');assert.equal(service.size,2);assert.equal(computes,3);
  layout.placements=[{id:'x'}];await service.get('stormwind','off');assert.equal(computes,4,'layout change invalidates');
  const bad=createOverlayService({loadArena:async()=>({layout}),compute:()=>{throw Error('boom');}});await assert.rejects(()=>bad.get('dalaran','light'),/boom/);assert.equal(bad.size,0);
});
test('HTTP route validates input, is read-only and serves service JSON',async t=>{
  const calls=[],server=createAssetServer({root:path.resolve(__dirname,'..'),catalog:{getManifest:async()=>({})},overlays:{get:async(city,fort)=>{calls.push([city,fort]);if(city==='darnassus')throw Error('x');return {city,fortifications:fort,items:[],counts:{}};}}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port+'/api/editor/overlays';
  const ok=await fetch(base+'?city=dalaran&fortifications=classic');assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store');assert.equal((await ok.json()).fortifications,'classic');
  assert.equal((await fetch(base+'?city=stormwind')).status,200);assert.deepEqual(calls[1],['stormwind','light']);
  assert.equal((await fetch(base+'?city=../x')).status,400);assert.equal((await fetch(base+'?city=stormwind&fortifications=zzz')).status,400);
  assert.equal((await fetch(base+'?city=stormwind',{method:'POST'})).status,405);assert.equal((await fetch(base+'?city=darnassus')).status,503);assert.equal(calls.length,3);
});
test('client sanitiser drops malformed overlay items and bounds the count',async()=>{
  const {sanitizeOverlays,overlayVisible,overlayUrl,OVERLAY_CATEGORIES}=await logic;
  const items=sanitizeOverlays({items:[{id:'a',kind:'perk',label:'x'.repeat(200),position:[1,2,3],size:[1,2,3]},{kind:'nope',position:[0,0,0]},{kind:'perk',position:[NaN,0,0]},{kind:'perk',position:[1,2]},{kind:'wall',position:[0,0,0],size:[1,-1,1]}]});
  assert.equal(items.length,2);assert.equal(items[0].label.length,60);assert.equal(items[0].category,'machine');assert.equal(items[1].size,null);
  assert.equal(sanitizeOverlays(null).length,0);assert.equal(sanitizeOverlays({items:Array(50).fill({kind:'spawn',position:[0,0,0]})},10).length,10);
  assert.ok(overlayVisible(items[0],new Set(['machine']))&&!overlayVisible(items[0],new Set(['spawn'])));assert.equal(overlayUrl('a b','off'),'/api/editor/overlays?city=a%20b&fortifications=off');
  const html=fs.readFileSync(path.resolve(__dirname,'../public/editor.html'),'utf8');for(const c of OVERLAY_CATEGORIES)assert.ok(html.includes('id="ov-'+c+'"'),c);assert.ok(html.includes('id="overlay-status"'));
});

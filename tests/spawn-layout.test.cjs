const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const schema=import('../src/map-layout.mjs'),logic=import('../src/editor-logic.mjs');
const spawn=(over={})=>({id:'s1',position:[1,2,3],yaw:.5,team:'alliance',...over});

test('legacy layouts without spawns validate unchanged and gain no key',async()=>{
  const {defaultLayout,validateLayout}=await schema,legacy=defaultLayout('dalaran');
  assert.ok(!('spawns' in legacy));const out=validateLayout(JSON.parse(JSON.stringify(legacy)),{city:'dalaran'});
  assert.deepEqual(out,legacy);assert.ok(!('spawns' in out));
});

test('spawns validate, normalise and are copied rather than aliased',async()=>{
  const {defaultLayout,validateLayout,MAX_LAYOUT_SPAWNS}=await schema,base=defaultLayout('stormwind');
  assert.equal(MAX_LAYOUT_SPAWNS,64);
  const input={...base,spawns:[spawn(),{position:[0,0,0],yaw:0},{id:'h',position:[9,1,9],yaw:-3,team:'horde'}]};
  const out=validateLayout(input,{city:'stormwind'});
  assert.deepEqual(out.spawns.map(s=>[s.id,s.team]),[['s1','alliance'],['spawn-2','any'],['h','horde']]);
  out.spawns[0].position[0]=99;assert.equal(input.spawns[0].position[0],1);
  assert.deepEqual(validateLayout({...base,spawns:[]},{city:'stormwind'}).spawns,[]);
  assert.deepEqual(Object.keys(out.spawns[0]).sort(),['id','position','team','yaw']);
  const full=Array.from({length:64},(_,i)=>spawn({id:'s'+i}));assert.equal(validateLayout({...base,spawns:full},{city:'stormwind'}).spawns.length,64);
});

test('invalid spawns are rejected',async()=>{
  const {defaultLayout,validateLayout}=await schema,base=defaultLayout('stormwind'),bad=value=>assert.throws(()=>validateLayout({...base,spawns:value},{city:'stormwind'}));
  bad('nope');bad({});bad([null]);bad([[1,2,3]]);bad(Array.from({length:65},(_,i)=>spawn({id:'s'+i})));
  bad([spawn({team:'orc'})]);bad([spawn({position:[1,2]})]);bad([spawn({position:[1,NaN,3]})]);bad([spawn({position:[1,2,20000]})]);
  bad([spawn({yaw:NaN})]);bad([spawn({yaw:'1'})]);bad([spawn({yaw:undefined})]);bad([spawn({id:'bad id!'})]);bad([spawn({id:5})]);bad([spawn(),spawn()]);
});

test('map layout files with and without spawns load, save and round trip through the host',async()=>{
  const {createMapLayouts}=require('../server/map-layouts.cjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'spawn-layout-'));
  try{
    fs.mkdirSync(path.join(root,'public/assets/layouts'),{recursive:true});fs.mkdirSync(path.join(root,'public/assets/props'),{recursive:true});
    fs.writeFileSync(path.join(root,'public/assets/props/stormwind.json'),JSON.stringify({models:[],instances:[]}));
    const layouts=createMapLayouts({root}),{defaultLayout}=await schema;
    fs.writeFileSync(path.join(root,'public/assets/layouts/stormwind.json'),JSON.stringify(defaultLayout('stormwind')));
    assert.ok(!('spawns' in await layouts.readLayout('stormwind')),'legacy file reads back without spawns');
    const saved=await layouts.saveLayout('stormwind',{...defaultLayout('stormwind'),spawns:[spawn()]});
    assert.equal(saved.spawns.length,1);assert.deepEqual((await layouts.readLayout('stormwind')).spawns,saved.spawns);
    await assert.rejects(()=>layouts.saveLayout('stormwind',{...defaultLayout('stormwind'),spawns:[spawn({team:'x'})]}),/team/);
    const legacySave=await layouts.saveLayout('stormwind',defaultLayout('stormwind'));assert.ok(!('spawns' in legacySave));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('editor spawn helpers add, update, cap, count and orient spawns',async()=>{
  const L=await logic;
  const hit={x:3.26,y:1.2345,z:-7.74};
  const s=L.spawnFromHit(hit,{snap:.5,id:'spawn-1',origin:[3.26,0,-17.74],team:'horde'});
  assert.deepEqual(s.position,[3.5,1.235,-7.5]);assert.equal(s.team,'horde');
  assert.ok(Math.abs(L.spawnFacing(s.yaw)[0])<.1&&L.spawnFacing(s.yaw)[1]<-.99,'faces toward the origin (-Z)');
  assert.equal(L.spawnFromHit(hit,{yaw:1,team:'bogus',id:'x'}).team,'any');
  assert.equal(L.spawnFromHit(hit,{yaw:7,id:'x'}).yaw,L.normAngle(7));
  assert.equal(L.nextSpawnId([{id:'spawn-1'},{id:'spawn-3'}]),'spawn-4');
  assert.equal(L.nextSpawnId([]),'spawn-1');
  const a=L.addSpawn(undefined,s);assert.ok(a.added);assert.equal(a.spawns.length,1);
  const full=Array.from({length:64},(_,i)=>({id:'s'+i,position:[0,0,0],yaw:0,team:'any'})),capped=L.addSpawn(full,s);assert.equal(capped.added,false);assert.equal(capped.spawns.length,64);
  const moved=L.updateSpawn(a.spawns,'spawn-1',{position:[1,2,3],yaw:4,team:'alliance'});
  assert.deepEqual(moved[0].position,[1,2,3]);assert.equal(moved[0].team,'alliance');assert.equal(moved[0].yaw,L.normAngle(4));assert.equal(a.spawns[0].team,'horde','original untouched');
  assert.equal(L.updateSpawn(a.spawns,'spawn-1',{team:'bogus'})[0].team,'horde');
  assert.deepEqual(L.removeSpawn(moved,'spawn-1'),[]);
  assert.deepEqual(L.spawnCounts([{team:'alliance'},{team:'horde'},{team:'horde'},{team:'any'},{}]),{total:5,any:2,alliance:1,horde:2});
  assert.equal(L.cycleTeam('any'),'alliance');assert.equal(L.cycleTeam('horde'),'any');
  assert.equal(L.nearestSpawn([{id:'a',position:[0,0,0]},{id:'b',position:[1,0,0]}],[.8,0,0]).id,'b');assert.equal(L.nearestSpawn([{id:'a',position:[0,0,0]}],[5,0,0]),null);assert.equal(L.nearestSpawn([{id:'a',position:[0,9,0]}],[0,0,0]),null);
});

test('one spawn edit is one undo step and an absent spawns field is restored on undo',async()=>{
  const {defaultLayout,validateLayout,LayoutHistory}=await schema,L=await logic,layout=defaultLayout('darnassus'),history=new LayoutHistory(layout);
  const next=JSON.parse(JSON.stringify(layout));next.spawns=L.addSpawn(next.spawns,spawn()).spawns;const v=validateLayout(next,{city:'darnassus'});
  assert.ok(history.push(v));assert.equal(history.push(v),false,'identical state is not a second step');
  const moved=JSON.parse(JSON.stringify(v));moved.spawns=L.updateSpawn(moved.spawns,'s1',{position:[5,5,5]});assert.ok(history.push(validateLayout(moved,{city:'darnassus'})));
  assert.deepEqual(history.undo().spawns[0].position,[1,2,3]);assert.ok(!('spawns' in history.undo()));
  const target=history.redo();L.replaceLayout(target,defaultLayout('darnassus'));assert.ok(!('spawns' in target),'reset drops the optional field');
});

test('host reports are matched to current spawns and summarised for the editor',async()=>{
  const L=await logic,spawns=[{id:'a'},{id:'b'},{id:'c'}];
  const sum=L.spawnReportSummary({accepted:['a','zz'],rejected:[{id:'b',reason:'Blocked: no room to stand here'},{id:'gone',reason:'x'},{reason:'no id'}]},spawns);
  assert.deepEqual(sum.rejected,[{id:'b',reason:'Blocked: no room to stand here'}]);assert.equal(sum.accepted,1);assert.match(sum.text,/1 spawn rejected.*b \(Blocked/);
  assert.equal(L.spawnReportSummary(null,spawns).text,'');assert.match(L.spawnReportSummary({accepted:['a','b']},spawns).text,/2 saved spawns accepted/);
});

test('overlay output carries the host spawn report and shows every automatic spawn',async()=>{
  const {overlayFromWorld}=await import('../server/editor-overlays.mjs'),v=(x,y,z)=>({x,y,z});
  const out=overlayFromWorld({fortifications:'light'},{spawns:Array.from({length:1500},(_,i)=>v(i,0,0)),authored:{accepted:[{id:'a'}],rejected:[{id:'b',reason:'Outside the playable area',index:1}]}});
  assert.ok(out.counts.spawn<=1200&&out.counts.spawn>=750);assert.deepEqual(out.spawnReports,{accepted:['a'],rejected:[{id:'b',reason:'Outside the playable area'}]});
  assert.deepEqual(overlayFromWorld({fortifications:'light'}).spawnReports,{accepted:[],rejected:[]});
});

test('editor page and script expose the spawn tool, its panel and the P hotkey',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../public/editor.html'),'utf8'),js=fs.readFileSync(path.join(__dirname,'../src/editor.js'),'utf8');
  for(const id of ['tool-spawns','spawn-panel','spawn-count','spawn-team','spawn-yaw','spawn-delete','spawn-done','spawn-report'])assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(js,/key==='p'\)setSpawnMode/);assert.match(js,/replaceLayout\(layout,defaultLayout/);
});

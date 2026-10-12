const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {WebSocket}=require('ws');
const {skipUnlessAssets}=require('./helpers/assets.cjs');
// Pure logic: runs on a clean clone without any game assets.
const load=()=>import('../src/districts.mjs');

// Synthetic district: circle r=100 at the origin.
const district={id:'stormwind-test',packId:'stormwind-test',packName:'Test',origin:[0,0,0],radius:100};
function tri(group,x0,z0){ // appends a small triangle with its own vertices
  const base=group.positions.length/3;
  group.positions.push(x0,0,z0, x0+4,0,z0, x0,0,z0+4);group.uv.push(0,0,1,0,0,1);group.indices.push(base,base+1,base+2);
}

test('district table is valid, ids and packs are unique, origins lie inside their own radius',async()=>{
  const d=await load();
  assert.deepEqual(d.validateDistrictTable(),[]);
  assert.equal(new Set(d.districtIds()).size,d.DISTRICTS.length);
  assert.equal(new Set(d.DISTRICTS.map(x=>x.packId)).size,d.DISTRICTS.length);
  assert.deepEqual(d.districtIds().slice(0,1),['stormwind'],'the legacy id stays first / default');
  assert.equal(d.getDistrict('stormwind').packId,'stormwind-trade');
  assert.deepEqual(d.getDistrict('stormwind').origin,[-141,-8.02,3],'legacy Trade origin is unchanged');
  for(const x of d.DISTRICTS){
    assert.ok(d.inDistrict(x,x.origin),x.id);assert.ok(!d.inDistrict(x,[x.origin[0]+x.radius+1,0,x.origin[2]]),x.id);
    assert.ok(x.radius>=d.COMBAT_RADIUS+d.SPAWN_SEARCH_RADIUS,x.id+' pack must contain the whole combat area');
    assert.ok(d.exploreLimit(x.id)<=x.radius-d.SPAWN_SEARCH_RADIUS,x.id+' free roam stops inside the pack');
    assert.ok(Number.isFinite(x.yaw)&&Number.isInteger(x.sky)&&Number.isInteger(x.fog));
  }
  assert.equal(d.exploreLimit('dalaran'),750,'non-district cities keep the old free-roam limit');
  assert.equal(d.validateDistrictTable([{...d.DISTRICTS[0]},{...d.DISTRICTS[0]}]).filter(p=>/duplicate/.test(p)).length,2);
  assert.ok(d.validateDistrictTable([{...d.DISTRICTS[1],radius:50}]).some(p=>/radius too small/.test(p)));
});

test('city ids are validated strictly and every consumer agrees on the list',async()=>{
  const d=await load(),{CITIES}=require('../server/map-layouts.cjs'),{EDITOR_CITIES}=await import('../src/map-layout.mjs'),{ARENAS}=await import('../src/world.js');
  for(const bad of ['__proto__','constructor','stormwind-','Stormwind','stormwind-trade','stormwind-dwarven/','../stormwind','',null,undefined,5,{}]){assert.equal(d.isDistrictId(bad),false,String(bad));assert.equal(d.isCityId(bad),false,String(bad));}
  assert.equal(d.isCityId('dalaran'),true);assert.equal(d.isDistrictId('dalaran'),false);
  assert.deepEqual([...CITIES].sort(),d.cityIds().sort(),'server/map-layouts.cjs CITIES matches src/districts.mjs');
  assert.deepEqual(Object.keys(EDITOR_CITIES).sort(),d.cityIds().sort());
  assert.deepEqual(Object.keys(ARENAS).sort(),d.cityIds().sort());
  for(const x of d.DISTRICTS){assert.deepEqual(ARENAS[x.id].spawn,x.origin);assert.equal(ARENAS[x.id].yaw,x.yaw);assert.deepEqual(EDITOR_CITIES[x.id].spawn,x.origin);}
});

test('asset candidates prefer the district pack and fall back to the full city',async()=>{
  const d=await load();
  assert.deepEqual(d.cityAssetCandidates('stormwind-park').map(c=>c.geometry),['stormwind-park.json','stormwind.json']);
  assert.deepEqual(d.cityAssetCandidates('stormwind').map(c=>c.props),['props/stormwind-trade.json','props/stormwind.json']);
  assert.deepEqual(d.cityAssetCandidates('dalaran'),[{geometry:'dalaran.json',props:'props/dalaran.json',pack:false}]);
  assert.equal(d.packFiles('dalaran'),null);
});

test('clipGroup keeps triangles by centroid, re-indexes deterministically and keeps batches',async()=>{
  const {clipGroup,triangleInDistrict}=await load();
  const g={name:'G',id:7,positions:[],uv:[],indices:[],batches:[]};
  tri(g,10,10);                       // inside
  tri(g,300,0);                       // far outside
  // straddling: one vertex outside the circle, centroid inside
  const s=g.positions.length/3;g.positions.push(90,0,0, 99,0,0, 108,0,0);g.uv.push(0,0,1,0,0,1);g.indices.push(s,s+1,s+2);
  // straddling the other way: one vertex inside, centroid outside
  const o=g.positions.length/3;g.positions.push(95,0,0, 140,0,0, 140,0,4);g.uv.push(0,0,1,0,0,1);g.indices.push(o,o+1,o+2);
  tri(g,-20,-20);                     // inside, second batch
  g.batches=[{start:0,count:12,material:3},{start:12,count:3,material:5}];
  const a=clipGroup(g,district),b=clipGroup(g,district);
  assert.deepEqual(a,b,'deterministic');
  assert.equal(a.indices.length/3,3,'inside + straddling-in + second batch');
  assert.equal(a.name,'G');assert.equal(a.id,7);
  assert.deepEqual(a.batches,[{start:0,count:6,material:3},{start:6,count:3,material:5}]);
  assert.equal(a.positions.length,9*3);assert.equal(a.uv.length,9*2,'only used vertices kept');
  assert.ok(Math.max(...a.indices)<a.positions.length/3);
  assert.deepEqual(a.positions.slice(0,3),[10,0,10],'vertex coordinates are unchanged (no re-centring)');
  assert.equal(triangleInDistrict(district,[99,0,0, 100,0,0, 101,0,0],0,1,2),true);
  assert.equal(triangleInDistrict(district,[100,0,1, 101,0,1, 102,0,1],0,1,2),false);
  const empty={name:'E',id:1,positions:[300,0,0,304,0,0,300,0,4],uv:[0,0,1,0,0,1],indices:[0,1,2],batches:[{start:0,count:3,material:0}]};
  assert.equal(clipGroup(empty,district),null);
  // a batch that loses every triangle disappears; the others keep consistent ranges
  const mixed=structuredClone(g);mixed.batches=[{start:0,count:3,material:1},{start:3,count:3,material:2},{start:6,count:9,material:4}];
  assert.deepEqual(clipGroup(mixed,district).batches.map(x=>x.material),[1,4]);
});

test('clipCity renumbers materials, drops unused ones and reports statistics',async()=>{
  const {clipCity}=await load();
  const near={name:'near',id:0,positions:[],uv:[],indices:[],batches:[]},far={name:'far',id:1,positions:[],uv:[],indices:[],batches:[]};
  tri(near,0,0);near.batches=[{start:0,count:3,material:2}];tri(far,500,500);far.batches=[{start:0,count:3,material:1}];
  const city={id:'stormwind',name:'Stormwind',source:'x.wmo',materials:[{texture:'/a.png'},{texture:'/b.png'},{texture:'/c.png'}],groups:[near,far]};
  const {manifest,stats}=clipCity(city,district);
  assert.equal(manifest.groups.length,1);assert.deepEqual(manifest.materials,[{texture:'/c.png'}]);assert.equal(manifest.groups[0].batches[0].material,0);
  assert.deepEqual(stats,{groups:1,triangles:1,materials:1,vertices:3});
  assert.equal(manifest.id,'stormwind-test');assert.equal(manifest.source,'x.wmo');
  assert.equal(city.materials.length,3,'input is not mutated');assert.equal(city.groups[0].batches[0].material,2);
});

test('clipProps preserves original instance ids and the original total, stubbing unused models',async()=>{
  const {clipProps}=await load();
  const model=n=>({source:'m'+n+'.m2',positions:[0,0,0],uv:[0,0],parts:[{texture:'/t.png',blend:0,flags:0,indices:[0,0,0]}],collision:{positions:[0,0,0],indices:[0,0,0]}});
  const props={city:'stormwind',source:'s',set:'x',sourceInstances:5,skipped:[],models:[model(0),model(1),model(2)],
    instances:[{model:0,position:[1,0,1],rotation:[0,0,0,1],scale:1,sourceIndex:0},{model:1,position:[500,0,0],rotation:[0,0,0,1],scale:1,sourceIndex:1},{model:2,position:[0,0,99],rotation:[0,0,0,1],scale:1,sourceIndex:2},{model:0,position:[0,0,-101],rotation:[0,0,0,1],scale:1,sourceIndex:3}]};
  const pack=clipProps(props,district);
  assert.deepEqual(pack.instances.map(i=>i.index),[0,2]);assert.equal(pack.instanceCount,4);
  assert.deepEqual(pack.instances.map(i=>i.sourceIndex),[0,2]);
  assert.equal(pack.models.length,3);assert.equal(pack.models[1].stub,true);assert.deepEqual(pack.models[1].positions,[]);assert.equal(pack.models[1].source,'m1.m2');
  assert.equal(pack.models[0].stub,undefined);assert.equal(props.models[1].stub,undefined,'input is not mutated');assert.equal(props.instances[0].index,undefined);
  // clipping a clipped pack again keeps the original ids and total
  const again=clipProps(pack,{...district,radius:50});assert.deepEqual(again.instances.map(i=>i.index),[0]);assert.equal(again.instanceCount,4);
});

test('hidden props still address original ids inside a district pack',async()=>{
  const {layoutInstances}=await import('../src/layout-objects.js'),{clipProps}=await load();
  const mk=(x,i)=>({model:0,position:[x,0,0],rotation:[0,0,0,1],scale:1,sourceIndex:i});
  const full={models:[{source:'a.m2',parts:[],positions:[],uv:[],collision:{positions:[],indices:[]}}],instances:[mk(500,0),mk(5,1),mk(6,2),mk(7,3)]};
  const pack=clipProps(full,district);
  assert.deepEqual(layoutInstances(pack,{hiddenProps:[]}).map(i=>i.index),[1,2,3]);
  assert.deepEqual(layoutInstances(pack,{hiddenProps:[2]}).map(i=>i.index),[1,3],'id 2 is the third ORIGINAL instance, not the second kept one');
  assert.deepEqual(layoutInstances(pack,{hiddenProps:[0]}).map(i=>i.index),[1,2,3],'hiding a prop outside the district is harmless');
  assert.equal(layoutInstances(full,{hiddenProps:[2]}).length,3,'full-city files (no index field) behave as before');
});

test('layouts: districts are valid cities with night lighting, and prop ids use the original total',async()=>{
  const {defaultLayout,validateLayout,EDITOR_CITIES}=await import('../src/map-layout.mjs'),d=await load();
  for(const id of d.districtIds()){
    const layout=defaultLayout(id);assert.equal(layout.settings.lighting,'spooky',id+' zombies night lighting like Stormwind');
    assert.doesNotThrow(()=>validateLayout({...layout,hiddenProps:[0,6000,6156]},{city:id,instanceCount:6157}));
    assert.throws(()=>validateLayout({...layout,hiddenProps:[6157]},{city:id,instanceCount:6157}),/Unknown original prop/);
    assert.throws(()=>validateLayout(layout,{city:id==='stormwind'?'stormwind-park':'stormwind'}),/different city/);
  }
  assert.equal(defaultLayout('dalaran').settings.lighting,'day');assert.throws(()=>defaultLayout('stormwind-nowhere'),/Unknown city/);
  assert.equal(Object.hasOwn(EDITOR_CITIES,'__proto__'),false);
});

test('multiplayer rooms accept district maps and reject unknown ones',async()=>{
  const {attachMultiplayer}=await import('../server/multiplayer.mjs');
  const server=http.createServer(),net=attachMultiplayer(server,{arenaLoader:async()=>{throw new Error('unused');},autoTick:false});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/multiplayer'),state={room:null};
  try{
    await new Promise((resolve,reject)=>{ws.on('open',resolve);ws.on('error',reject);});
    ws.on('message',raw=>{const m=JSON.parse(raw);if(m.room)state.room=m.room;});
    const send=m=>ws.send(JSON.stringify(m)),until=async p=>{const t=Date.now()+4000;while(!p()){if(Date.now()>t)throw new Error('timeout');await new Promise(r=>setTimeout(r,15));}};
    send({type:'create',mode:'tdm'});await until(()=>state.room);assert.equal(state.room.city,'stormwind');
    for(const id of ['stormwind-dwarven','stormwind-valley','stormwind-park','dalaran','stormwind']){send({type:'settings',city:id});await until(()=>state.room.city===id);}
    send({type:'settings',city:'stormwind-evil'});send({type:'settings',city:'__proto__'});await new Promise(r=>setTimeout(r,80));assert.equal(state.room.city,'stormwind');
  }finally{ws.terminate();net.close();await new Promise(r=>server.close(r));}
});

test('the pack build script is registered and wired into the full import; the menu lists every map',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));
  assert.match(pkg.scripts['build:districts'],/scripts\/build-districts\.cjs/);
  const all=fs.readFileSync(path.join(__dirname,'../scripts/import-wow-all.cjs'),'utf8');
  assert.ok(all.indexOf("'import-props.cjs'")<all.indexOf("'build-districts.cjs'"),'districts are clipped after the props are imported');
  const index=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
  for(const id of ['stormwind','stormwind-dwarven','stormwind-valley','stormwind-park','dalaran','darnassus']){
    assert.ok(index.includes('data-map="'+id+'"'),'menu card '+id);assert.ok(index.includes('<option value="'+id+'">'),'room map '+id);
  }
  assert.ok(index.includes('/districts.css'));
});

// Needs generated packs: npm run build:districts
const packs=['stormwind-trade','stormwind-dwarven','stormwind-valley','stormwind-park'];
test('generated district packs are consistent with the full city',skipUnlessAssets('stormwind.json',...packs.map(p=>p+'.json')),async()=>{
  const d=await load(),root=path.join(__dirname,'../public/assets');
  const full=JSON.parse(fs.readFileSync(path.join(root,'stormwind.json'),'utf8'));
  const fullTriangles=full.groups.reduce((n,g)=>n+g.indices.length/3,0);
  const centroidDistance=(g,a,b,c,x)=>Math.hypot((g.positions[a*3]+g.positions[b*3]+g.positions[c*3])/3-x.origin[0],(g.positions[a*3+2]+g.positions[b*3+2]+g.positions[c*3+2])/3-x.origin[2]);
  for(const x of d.DISTRICTS){
    const pack=JSON.parse(fs.readFileSync(path.join(root,x.packId+'.json'),'utf8'));
    const triangles=pack.groups.reduce((n,g)=>n+g.indices.length/3,0);
    assert.ok(triangles>5000&&triangles<fullTriangles*.2,x.id+' is a small subset ('+triangles+' of '+fullTriangles+')');
    const names=new Set(full.groups.map(g=>g.name+'#'+g.id));
    for(const g of pack.groups){
      assert.ok(names.has(g.name+'#'+g.id),'group '+g.name+' keeps its name and id');
      for(const b of g.batches){assert.ok(pack.materials[b.material],'material in range');assert.ok(b.start+b.count<=g.indices.length);}
      for(let i=0;i<g.indices.length;i+=3)if(centroidDistance(g,g.indices[i],g.indices[i+1],g.indices[i+2],x)>x.radius+1e-6)assert.fail(x.id+' has a triangle outside the district in '+g.name);
    }
    const used=new Set(pack.groups.flatMap(g=>g.batches.map(b=>b.material)));assert.equal(used.size,pack.materials.length,'only used materials are kept');
    // every full-city triangle (in a batch) whose centroid is inside the circle survives
    let inFull=0;
    for(const g of full.groups)for(const b of g.batches)for(let i=b.start;i<b.start+b.count;i+=3)if(centroidDistance(g,g.indices[i],g.indices[i+1],g.indices[i+2],x)<=x.radius)inFull++;
    assert.equal(triangles,inFull,x.id+' keeps exactly the triangles inside the circle');
  }
});

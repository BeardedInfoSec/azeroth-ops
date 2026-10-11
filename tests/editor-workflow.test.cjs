const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const logic=import(pathToFileURL(path.resolve(__dirname,'../src/editor-logic.mjs')).href);
const schema=import(pathToFileURL(path.resolve(__dirname,'../src/map-layout.mjs')).href);
const close=(a,b,eps=1e-3)=>assert.ok(Math.abs(a-b)<=eps,a+' vs '+b);
const item=(id,x,y,z,rotation=0,scale=1)=>({id,prefabId:'crate',position:[x,y,z],rotation,scale,solid:true});

test('rotation stepping snaps to the configured angle, wraps and reverses',async()=>{
  const {stepRotation,normAngle}=await logic;
  close(stepRotation(0,1,15),Math.PI/12);close(stepRotation(0,-1,15),-Math.PI/12);close(stepRotation(0,1,45),Math.PI/4);
  let r=0;for(let i=0;i<24;i++)r=stepRotation(r,1,15);close(r,0,1e-3);
  close(stepRotation(.1,1,15),Math.PI/12);close(stepRotation(.1,-1,15),0);close(stepRotation(NaN,1,15),Math.PI/12);close(stepRotation(0,1,0),Math.PI/12);
  close(normAngle(Math.PI*3),Math.PI);close(normAngle(-Math.PI*2.5),-Math.PI/2);assert.equal(normAngle(Infinity),0);
});
test('scale stepping clamps to the layout limits and random rolls respect the range',async()=>{
  const {stepScale,clampScale,scaleRange,rollScale,rollRotation,mulberry32}=await logic;
  assert.equal(stepScale(1,1),1.1);assert.equal(stepScale(6,1),6);assert.equal(stepScale(.1,-1),.1);assert.equal(clampScale(NaN),1);assert.equal(clampScale(99),6);
  assert.deepEqual(scaleRange(2,.5),[.5,2]);assert.deepEqual(scaleRange('x',9),[1,6]);
  const rng=mulberry32(7);for(let i=0;i<200;i++){const v=rollScale(rng,.8,1.3);assert.ok(v>=.8&&v<=1.3);const a=rollRotation(rng);assert.ok(a>-Math.PI-1e-9&&a<=Math.PI);}
  const a=mulberry32(5),b=mulberry32(5);assert.equal(a(),b());assert.notEqual(mulberry32(5)(),mulberry32(6)());
});
test('sit-on-surface and slope lift offsets',async()=>{
  const {sitOffset,slopeLift,placementFromHit}=await logic;
  assert.equal(sitOffset(-.5,2),1);assert.equal(sitOffset(.25,1),-.25);assert.equal(sitOffset(NaN,1),0);assert.equal(sitOffset(-1,99),6);
  assert.equal(slopeLift(1,2),0);assert.equal(slopeLift(.5,1),1.2);assert.ok(slopeLift(.9,1)>0&&slopeLift(.9,1)<.6);assert.equal(slopeLift(.5,0),0);
  assert.deepEqual(placementFromHit({x:1,y:2,z:3},{offset:sitOffset(-.5,1)}),[1,2.5,3]);
});
test('capacity respects the 256 placement limit without silent loss',async()=>{
  const {capacityLeft,PLACEMENT_LIMIT}=await logic;
  assert.equal(PLACEMENT_LIMIT,256);assert.deepEqual(capacityLeft(250,10),{allowed:6,dropped:4});assert.deepEqual(capacityLeft(256,1),{allowed:0,dropped:1});assert.deepEqual(capacityLeft(0,5),{allowed:5,dropped:0});
});
test('group transforms rotate and scale around the selection centre and stay valid',async()=>{
  const {selectionCentre,groupTransform,normAngle}=await logic,{validateLayout,defaultLayout}=await schema;
  const items=[item('a',0,0,0),item('b',4,2,0,.5,2)],centre=selectionCentre(items);assert.deepEqual(centre,[2,1,0]);assert.equal(selectionCentre([]),null);
  const moved=groupTransform(items,centre,{move:[1,0,-1]});assert.deepEqual(moved[0].position,[1,0,-1]);assert.deepEqual(moved[1].position,[5,2,-1]);
  const turned=groupTransform(items,centre,{yaw:Math.PI});close(turned[0].position[0],4);close(turned[1].position[0],0);close(turned[0].rotation,Math.PI);close(turned[1].rotation,normAngle(.5+Math.PI));
  const quarter=groupTransform([item('a',1,0,0),item('b',-1,0,0)],[0,0,0],{yaw:Math.PI/2});close(quarter[0].position[2],-1);close(quarter[0].position[0],0);
  const grown=groupTransform(items,centre,{scale:2});assert.deepEqual(grown[0].position,[-2,-1,0]);assert.equal(grown[0].scale,2);assert.equal(grown[1].scale,4);
  assert.equal(groupTransform([item('c',0,0,0,0,5)],[0,0,0],{scale:3})[0].scale,6);
  const layout=defaultLayout('stormwind');layout.placements=turned;assert.doesNotThrow(()=>validateLayout(layout,{city:'stormwind'}));
});
test('nudging follows the snap size, shift multiplier, camera heading and height keys',async()=>{
  const {nudgeVector}=await logic;
  assert.deepEqual(nudgeVector({key:'ArrowUp',snap:1}),[0,0,-1]);assert.deepEqual(nudgeVector({key:'ArrowRight',snap:2,shift:true}),[10,0,0]);
  assert.deepEqual(nudgeVector({key:'ArrowUp',snap:1,yaw:Math.PI/2}),[-1,0,0]);assert.deepEqual(nudgeVector({key:'ArrowLeft',snap:1,yaw:Math.PI}),[1,0,0]);
  assert.deepEqual(nudgeVector({key:'PageUp',snap:.5}),[0,.5,0]);assert.deepEqual(nudgeVector({key:'PageDown',snap:0,shift:true}),[0,-2.5,0]);assert.equal(nudgeVector({key:'x'}),null);
});
test('marquee selection, toggling and paste placement',async()=>{
  const {itemsInRect,toggleId,unionIds,pasteItems,selectionCentre}=await logic;
  const items=[item('a',0,0,0),item('b',5,0,5),item('c',20,0,0)];
  assert.deepEqual(itemsInRect(items,{x0:6,z0:6,x1:-1,z1:-1}),['a','b']);assert.deepEqual(itemsInRect(items,{x0:100,z0:100,x1:101,z1:101}),[]);
  assert.deepEqual(toggleId(['a'],'b'),['a','b']);assert.deepEqual(toggleId(['a','b'],'a'),['b']);assert.deepEqual(unionIds(['a'],['a','b']),['a','b']);
  let n=0;const makeId=()=>'n'+n++,clip=[item('a',0,0,0),item('b',4,1,0)];
  const pasted=pasteItems(clip,[10,5,10],{makeId});assert.deepEqual(pasted.map(i=>i.id),['n0','n1']);assert.deepEqual(selectionCentre(pasted),[10,5,10]);assert.deepEqual(pasted[1].position,[12,5.5,10]);
  assert.deepEqual(pasteItems(clip,null,{makeId})[0].position,[2,0,2]);assert.deepEqual(pasteItems([],[0,0,0],{makeId}),[]);
  assert.deepEqual(pasteItems(clip,[10.4,0,10.4],{makeId,snap:1})[0].position.slice(0,1),[8]);
});
test('scatter points are deterministic, inside the circle and bounded',async()=>{
  const {scatterPlan,acceptScatterHit}=await logic,opts={seed:42,count:20,radius:5,center:[10,-10],assets:['a','b']};
  const one=scatterPlan(opts),two=scatterPlan(opts);assert.deepEqual(one,two);assert.equal(one.length,20);
  for(const p of one){assert.ok(Math.hypot(p.x-10,p.z+10)<=5.001);assert.ok(['a','b'].includes(p.prefabId));assert.ok(p.scale>=.8&&p.scale<=1.25);}
  assert.notDeepEqual(scatterPlan({...opts,seed:43}),one);assert.equal(scatterPlan({...opts,count:9999}).length,100);assert.equal(scatterPlan({...opts,assets:[]}).length,0);
  const fixed=scatterPlan({...opts,randomRotation:false,rotation:.5,randomScale:false,scale:1.5});assert.ok(fixed.every(p=>p.rotation===.5&&p.scale===1.5));
  const spaced=scatterPlan({...opts,count:8,spacing:1});for(let i=0;i<spaced.length;i++)for(let j=i+1;j<spaced.length;j++)assert.ok(Math.hypot(spaced[i].x-spaced[j].x,spaced[i].z-spaced[j].z)>=1);
  assert.ok(acceptScatterHit(1,0,1)&&!acceptScatterHit(6,0,4)&&acceptScatterHit(6,0,20));
});
test('tile filtering, sorting, favorites and recents',async()=>{
  const {filterTiles,browserReducer,sanitizeIdList,categoriesOf,moveIndex,tileMeta,sizeLabel,RECENT_LIMIT}=await logic;
  const prefabs=[{id:'crate',name:'Supply crate',category:'Cover',size:[1.5,1.4,1.5]},{id:'wow:1',name:'oak tree',category:'World of Warcraft',source:'world\\tree\\oak.m2',size:[1,1,1]},{id:'wow:2',name:'cart',category:'World of Warcraft',source:'x\\cart.m2',size:[1,1,1]},{id:'machine:a',name:'Jug (scenery)',category:'Imported COD machines',size:[1,2.7,1]}];
  assert.deepEqual(categoriesOf(prefabs),['Cover','Imported COD machines','World of Warcraft']);
  assert.deepEqual(filterTiles(prefabs,{}).tiles.map(t=>t.id),['crate','machine:a','wow:2','wow:1']);
  assert.deepEqual(filterTiles(prefabs,{query:'OAK tree'}).tiles.map(t=>t.id),['wow:1']);assert.deepEqual(filterTiles(prefabs,{query:'tree oak'}).tiles.map(t=>t.id),['wow:1']);assert.equal(filterTiles(prefabs,{query:'cart.m2'}).total,1);
  assert.deepEqual(filterTiles(prefabs,{category:'cat:Cover'}).tiles.map(t=>t.id),['crate']);
  let st=browserReducer(undefined,{type:'toggleFavorite',id:'wow:1'});st=browserReducer(st,{type:'toggleFavorite',id:'machine:a'});
  assert.deepEqual(st.favorites,['machine:a','wow:1']);assert.equal(filterTiles(prefabs,{favorites:st.favorites}).tiles[0].favorite,true);assert.deepEqual(filterTiles(prefabs,{category:'favorites',favorites:st.favorites}).tiles.map(t=>t.id).sort(),['machine:a','wow:1']);
  st=browserReducer(st,{type:'toggleFavorite',id:'wow:1'});assert.deepEqual(st.favorites,['machine:a']);
  for(let i=0;i<20;i++)st=browserReducer(st,{type:'use',id:'r'+i});st=browserReducer(st,{type:'use',id:'r5'});assert.equal(st.recent.length,RECENT_LIMIT);assert.equal(RECENT_LIMIT,12);assert.equal(st.recent[0],'r5');assert.equal(new Set(st.recent).size,12);
  assert.deepEqual(browserReducer({favorites:['a','b'],recent:['b','c']},{type:'prune',valid:new Set(['b'])}),{favorites:['b'],recent:['b']});
  assert.deepEqual(filterTiles(prefabs,{category:'recent',recent:['wow:2','crate']}).tiles.map(t=>t.id),['wow:2','crate']);
  assert.equal(filterTiles(prefabs,{limit:2}).truncated,true);assert.equal(filterTiles(prefabs,{limit:2}).total,4);
  assert.deepEqual(sanitizeIdList(['a','a','zz',5,'b'],new Set(['a','b'])),['a','b']);assert.deepEqual(sanitizeIdList('bad',null),[]);assert.equal(sanitizeIdList(['a','b','c'],null,2).length,2);
  assert.equal(moveIndex(-1,5,1),0);assert.equal(moveIndex(-1,5,-1),4);assert.equal(moveIndex(4,5,1),4);assert.equal(moveIndex(0,5,-1),0);assert.equal(moveIndex(2,0,1),-1);
  assert.equal(tileMeta(prefabs[0]),'Cover · 1.5 x 1.4 x 1.5 m');assert.equal(tileMeta(prefabs[1]),'World of Warcraft');assert.equal(sizeLabel(prefabs[1],[2,3.14,1]),'2 x 3.1 x 1 m');
});
test('camera focus pose and readout text',async()=>{
  const {focusPose,formatReadout,placementBanner}=await logic;
  const pose=focusPose({centre:[10,0,10],radius:2,yaw:0,pitch:-Math.PI/4});assert.ok(pose.position[1]>0&&pose.position[2]>10&&pose.distance>=6);
  assert.ok(focusPose({centre:[0,0,0],radius:100}).distance>focusPose({centre:[0,0,0],radius:1}).distance);
  assert.equal(formatReadout({position:[1,2.345,3],rotation:Math.PI/2,scale:1.25}),'X 1  Y 2.35  Z 3 · ROT 90° · SCALE 1.25x');
  assert.match(placementBanner('Crate'),/^PLACING: Crate — R rotate.*\[ \] scale, Esc done$/);assert.match(placementBanner('Rock',{tool:'scatter',count:12}),/SCATTER: Rock — click to scatter 12/);
});
test('the editor page and script wire up every new control',()=>{
  const html=fs.readFileSync(path.resolve(__dirname,'../public/editor.html'),'utf8'),source=fs.readFileSync(path.resolve(__dirname,'../src/editor.js'),'utf8');
  for(const id of ['asset-search','asset-category','asset-tiles','place','scatter-tool','done','mode-banner','mode-text','marquee','readout','angle-snap','place-stay','place-sit','place-slope','place-random-rot','place-random-scale','scale-min','scale-max','scatter-count','scatter-radius','scatter-favs','multi','help-panel','snap'])assert.ok(html.includes('id="'+id+'"'),id);
  assert.ok(!html.includes('id="asset-list"')&&!source.includes("$('asset-list')"));
  assert.ok(html.includes('<details id="help-panel"'));
  assert.ok(source.includes('try{localStorage.setItem')&&source.includes('catch{}'));
  assert.match(source,/import\s*\{[^}]*scatterPlan[^}]*\}\s*from '\.\/editor-logic\.mjs'/);
});

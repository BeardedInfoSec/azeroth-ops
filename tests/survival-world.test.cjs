const test=require('node:test'),assert=require('node:assert/strict');
const {skipUnlessAssets}=require('./helpers/assets.cjs');

async function fixture(){
  const THREE=await import('three'),{SurvivalWorld}=await import('../src/survival-world.js');
  const nodes=[],grid=new Map();
  // Sloped, fully three-dimensional ground catches assumptions that all barriers sit at y=0.
  for(let z=-17;z<=17;z++)for(let x=-17;x<=17;x++){
    const node={id:nodes.length,x,z,point:new THREE.Vector3(x*2.5,3+x*.12+z*.07,z*2.5),edges:[]};
    nodes.push(node);grid.set(x+','+z,node);
  }
  for(const node of nodes)for(const [x,z] of [[1,0],[-1,0],[0,1],[0,-1]]){const next=grid.get((node.x+x)+','+(node.z+z));if(next)node.edges.push(next.id);}
  const nav={nodes,reachable:nodes,cell:2.5,nearest(point){return nodes.reduce((a,b)=>a.point.distanceToSquared(point)<b.point.distanceToSquared(point)?a:b);}};
  const scene=new THREE.Scene(),originalEdges=JSON.stringify(nodes.map(n=>n.edges)),spawn=new THREE.Vector3(0,3,0);
  const env=new SurvivalWorld({scene,nav,spawn,gunModels:[],city:'stormwind'});
  return {THREE,nav,scene,env,originalEdges};
}

test('Fortifications cover every reachable zone boundary without modifying navigation',async()=>{
  const {nav,scene,env,originalEdges}=await fixture();
  try{
    assert.equal(env.gates.length,2);assert.equal(env.windows.length,9);assert.equal(env.activeWindows.length,3);
    for(const node of nav.nodes)for(const next of node.edges){if(env.nodeZones.get(node.id)===env.nodeZones.get(next))continue;const key=node.id<next?node.id+':'+next:next+':'+node.id;assert.ok(env.edgeBarriers.has(key),'unfortified graph crossing '+key);assert.equal(env.canTraverse(node.id,next),false);}
    assert.equal(JSON.stringify(nav.nodes.map(n=>n.edges)),originalEdges);
    assert.deepEqual(env.weaponBuys.map(w=>[w.zone,w.gunIndex,w.cost]),[[0,1,1000],[1,2,1500],[2,3,1750]]);
    assert.deepEqual(env.gates.map(g=>g.cost),[750,1500]);
    for(const interaction of env.interactions){assert.ok(Number.isFinite(interaction.position.y));assert.equal(env.zoneAt(interaction.position),interaction.zone);}
  }finally{env.dispose();}
  assert.equal(scene.children.length,0);
});

test('Swept movement blocks walls and empty windows; gates unlock in order',async()=>{
  const {THREE,env}=await fixture(),eye=new THREE.Vector3(0,2.45,0);
  try{
    for(const wall of env.barriers){const body=new THREE.Vector3(0,.9,0),from=wall.inside.clone().add(body),to=wall.outside.clone().add(body);assert.equal(env.isMoveBlocked(from,to),true,wall.id);assert.equal(env.isMoveBlocked(to,from),true,wall.id+' reverse');}
    const {resolveFortificationMove}=await import('../src/engine/fortification-motion.js');
    for(const rail of env.barriers.filter(w=>w.type==='rail')){const from=rail.inside.clone().add(eye),to=rail.outside.clone().add(eye);assert.ok(resolveFortificationMove(from,to,[rail]).distanceTo(to)>.1,'Full player capsule must hit a low boundary rail');}
    const wall=env.windows[0],from=wall.inside.clone().add(eye),to=wall.outside.clone().add(eye);
    env.setBoards(wall,0);assert.equal(env.isMoveBlocked(from,to),true);
    assert.equal(env.isMoveBlocked(from.clone().add(new THREE.Vector3(0,10,0)),to.clone().add(new THREE.Vector3(0,10,0))),false);
    assert.equal(env.openZone(2),false);const gate=env.gates[0];assert.equal(env.isAccessible(gate.outside),false);
    assert.equal(env.openZone(1),true);assert.equal(env.canTraverse(gate.insideNode,gate.outsideNode),true);assert.equal(env.isMoveBlocked(gate.inside.clone().add(eye),gate.outside.clone().add(eye)),false);assert.equal(gate.mesh.parent,null);assert.equal(env.isAccessible(gate.outside),true);assert.equal(env.activeWindows.length,3);
    assert.ok(env.windows.filter(w=>w.zone===0).every(w=>w.retired&&w.open&&!w.mesh.parent),'Old spawn windows retire when that area becomes interior');
    assert.ok(env.barriers.filter(w=>w.level===1&&!w.permanent).every(w=>w.open&&!w.mesh.parent),'The whole interior boundary opens, not just a single narrow gate');
    assert.equal(env.openZone(2),true);assert.equal(env.activeWindows.length,3);assert.ok(env.activeWindows.every(w=>w.zone===2));assert.equal(env.openZone(2),false);assert.equal(env.openZone(3),false);const outer=env.windows.find(w=>w.zone===2);assert.equal(env.zoneAt(outer.outside),3);assert.equal(env.isAccessible(outer.inside),true);assert.equal(env.isAccessible(outer.outside),false);assert.equal(env.canTraverse(outer.insideNode,outer.outsideNode),false);assert.equal(env.isAccessible(new THREE.Vector3(1000,3,0)),false);
  }finally{env.dispose();}
});

test('Destroyed planks leave actual raycast gaps and repairs restore physical shot cover',async()=>{
  const {THREE,env}=await fixture();
  try{
    const window=env.windows[0],origin=window.inside.clone(),target=window.approachPath.at(-1).clone();origin.y=target.y=window.mesh.position.y+1.04;
    const ray=new THREE.Raycaster(origin,target.clone().sub(origin).normalize(),0,origin.distanceTo(target));
    assert.ok(ray.intersectObject(window.mesh,true).length>0);assert.equal(env.setBoards(window.id,0),true);assert.equal(window.boards,0);assert.equal(ray.intersectObject(window.mesh,true).length,0);assert.ok(window.planks.every(p=>!p.parent));
    assert.equal(env.setBoards(window,3),true);assert.equal(window.planks.filter(p=>p.parent).length,3);assert.ok(ray.intersectObject(window.mesh,true).length>0);
    env.setBoards(window,99);assert.equal(window.boards,6);env.setBoards(window,-1);assert.equal(window.boards,0);assert.equal(env.setBoards('missing',1),false);
  }finally{env.dispose();}
});

function reachableNodes(nav,env,spawn){
  const start=nav.nearest(spawn),visited=new Set([start.id]),queue=[start.id];
  for(let i=0;i<queue.length;i++){const node=nav.nodes[queue[i]];for(const id of node.edges){if(visited.has(id)||!env.canTraverse(node,nav.nodes[id]))continue;visited.add(id);queue.push(id);}}
  return visited;
}

test('Covered entry paths stay clear around their baffles while hiding newly spawned undead',async()=>{
  const {THREE,env}=await fixture();
  try{
    for(const entry of env.windows){
      const path=[entry.spawnPoint,...entry.approachPath,...entry.releasePath];
      for(let i=1;i<path.length;i++)assert.equal(env.canEntryMove(entry,path[i-1],path[i]),true,entry.id+' path segment '+i);
      env.setBoards(entry,0);
      const from=entry.inside.clone(),to=entry.spawnPoint.clone();from.y=to.y=entry.mesh.position.y+1.6;
      const ray=new THREE.Raycaster(from,to.clone().sub(from).normalize(),0,from.distanceTo(to));
      assert.ok(ray.intersectObject(entry.mesh,true).length>0,entry.id+' must conceal its spawn even with all boards gone');
    }
  }finally{env.dispose();}
});

// District maps are gated on their own generated pack (npm run build:districts).
for(const city of ['stormwind','stormwind-dwarven','stormwind-valley','stormwind-park','dalaran','darnassus'])test(city+' expansion keeps every machine, weapon rack and active entry physically reachable',skipUnlessAssets(city+'.json','props/'+city+'.json'),async()=>{
  const THREE=await import('three'),{loadArena}=await import('../server/world.mjs'),{GroundNavigation}=await import('../src/navigation.js'),{SurvivalWorld}=await import('../src/survival-world.js'),{ARENAS}=await import('../src/world.js'),{clearSpawn}=await import('../src/spawns.js');
  const arena=await loadArena(city),base=ARENAS[city].spawn;let best=null;
  // Match the playable client's safe-spawn search, including imported prop collision.
  for(let radius=0;radius<=24;radius+=3)for(let k=0;k<16;k++){
    const x=base[0]+Math.cos(k*Math.PI/8)*radius,z=base[2]+Math.sin(k*Math.PI/8)*radius,h=arena.floorAt(x,z,base[1]+8,50);
    if(!h||h.face.normal.y<.7||!clearSpawn(h.point,arena.floorAt,arena.blocked,1.2,2.65))continue;
    const score=radius+Math.abs(h.point.y-base[1])*2;if(!best||score<best.score)best={point:h.point,score};
  }
  assert.ok(best,'A safe playable spawn exists');
  const spawn=best.point.clone().add(new THREE.Vector3(0,2.45,0)),nav=new GroundNavigation(spawn,arena.floorAt,arena.blocked),env=new SurvivalWorld({scene:new THREE.Scene(),nav,spawn,city,worldCollider:arena.collider});
  try{
    assert.equal(env.machines.length,13);assert.equal(env.weaponBuys.length,3);assert.equal(env.gates.length,2);
    for(let level=0;level<3;level++){
      if(level)assert.equal(env.openZone(level),true);
      const reachable=reachableNodes(nav,env,spawn),unlocked=nav.reachable.filter(n=>env.unlockedZones.has(env.nodeZones.get(n.id)));
      console.log(city+' area '+level+': '+reachable.size+'/'+unlocked.length+' nodes reachable, '+env.activeWindows.length+' active entries');
      assert.ok(reachable.size>=unlocked.length*.95,city+' area '+level+' must not create disconnected expansion pockets');
      for(const item of [...env.machines,...env.weaponBuys].filter(i=>env.unlockedZones.has(i.zone)))assert.ok(reachable.has(nav.nearest(item.position).id),city+' unreachable '+item.id+' after opening area '+level);
      assert.ok(env.activeWindows.length>=2,city+' area '+level+' needs more than one active entry');
      for(const entry of env.activeWindows){
        assert.ok(reachable.has(entry.insideNode),city+' unreachable entry '+entry.id);
        const path=[entry.spawnPoint,...entry.approachPath,...entry.releasePath];
        for(let i=1;i<path.length;i++)assert.equal(env.canEntryMove(entry,path[i-1],path[i]),true,city+' '+entry.id+' blocked approach/release segment '+i);
        env.setBoards(entry,0);const from=entry.inside.clone().add(new THREE.Vector3(0,1.6,0)),to=entry.spawnPoint.clone().add(new THREE.Vector3(0,1.6,0)),ray=new THREE.Raycaster(from,to.clone().sub(from).normalize(),0,from.distanceTo(to));
        assert.ok(ray.intersectObject(entry.mesh,true).length>0,city+' exposed spawn behind '+entry.id);
      }
    }
  }finally{env.dispose();}
});

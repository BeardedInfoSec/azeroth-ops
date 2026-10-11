const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(fortifications){
  const T=await import('three'),{SurvivalWorld}=await import('../src/survival-world.js'),nodes=[],grid=new Map();
  for(let z=-8;z<=8;z++)for(let x=-8;x<=8;x++){const node={id:nodes.length,x,z,point:new T.Vector3(x*2.5,0,z*2.5),edges:[]};nodes.push(node);grid.set(x+','+z,node);}
  for(const node of nodes)for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const adjacent=grid.get((node.x+dx)+','+(node.z+dz));if(adjacent)node.edges.push(adjacent.id);}
  const nav={nodes,reachable:nodes,cell:2.5,nearest(point){return nodes.reduce((a,b)=>a.point.distanceToSquared(point)<b.point.distanceToSquared(point)?a:b);}},scene=new T.Scene(),spawn=new T.Vector3(),env=new SurvivalWorld({scene,nav,spawn,perkDefinitions:[],zoneSteps:[2,4,6],fortifications});
  return {T,env,scene,nav,grid};
}
test('light fortifications lower cover and reduce meshes while retaining locked boundaries',async()=>{
  const light=await fixture('light'),classic=await fixture('classic');
  try{
    assert.equal(light.env.gates.length,classic.env.gates.length);assert.equal(light.env.windows.length,classic.env.windows.length);
    const wall=light.env.barriers.find(value=>value.type==='wall'),old=classic.env.barriers.find(value=>value.id===wall.id);assert.equal(wall.height,2.05);assert.equal(old.height,3.2);assert.ok(wall.mesh.children.length<old.mesh.children.length);
    for(const barrier of light.env.barriers)if(typeof barrier.outsideNode==='number')assert.equal(light.env.canTraverse(barrier.insideNode,barrier.outsideNode),false,barrier.id);
    const {resolveFortificationMove}=await import('../src/engine/fortification-motion.js'),from=wall.inside.clone().add(new light.T.Vector3(0,2.45,0)),to=wall.outside.clone().add(new light.T.Vector3(0,2.45,0));assert.ok(resolveFortificationMove(from,to,[wall]).distanceTo(to)>.1,'Low visible cover still stops the player capsule');
    const gate=light.env.gates[0];assert.equal(light.env.openZone(1),true);assert.equal(light.env.canTraverse(gate.insideNode,gate.outsideNode),true);
  }finally{light.env.dispose();classic.env.dispose();}
});
test('open layout retains exactly three covered spawns and opens every reachable area',async()=>{
  const {env,grid,nav,scene}=await fixture('off');
  try{
    assert.equal(env.gates.length,0);assert.equal(env.barriers.length,3);assert.equal(env.windows.length,3);assert.equal(env.activeWindows.length,3);assert.deepEqual([...env.unlockedZones],[0,1,2]);assert.ok(env.barriers.every(item=>item.type==='window'&&item.level===3));
    assert.ok(nav.nodes.every(node=>env.isAccessible(node.point)),'Outer city has no invisible forbidden zone');assert.equal(env.canTraverse(grid.get('2,0'),grid.get('3,0')),true);assert.equal(env.openZone(1),false);
    assert.ok(env.weaponBuys.length>0);assert.ok(env.entryColliders.length>=12,'Covered alcove sides and baffles remain physical');
  }finally{env.dispose();}assert.equal(scene.children.length,0);
});
test('open layout spawns stay concealed and their approach paths remain clear after boards break',async()=>{
  const {T,env}=await fixture('off');
  try{for(const entry of env.activeWindows){const points=[entry.spawnPoint,...entry.approachPath,...entry.releasePath];for(let i=1;i<points.length;i++)assert.equal(env.canEntryMove(entry,points[i-1],points[i]),true,entry.id+' segment '+i);env.setBoards(entry,0);const from=entry.inside.clone().add(new T.Vector3(0,1.6,0)),to=entry.spawnPoint.clone().add(new T.Vector3(0,1.6,0)),ray=new T.Raycaster(from,to.clone().sub(from).normalize(),0,from.distanceTo(to));assert.ok(ray.intersectObject(entry.mesh,true).length>0,'Baffle conceals '+entry.id+' even without planks');}}
  finally{env.dispose();}
});
test('light is the default and classic keeps original tall cover',async()=>{
  const light=await fixture(),classic=await fixture('classic');try{assert.equal(light.env.fortifications,'light');assert.ok(light.env.barriers.filter(item=>item.type==='wall').every(item=>item.height===2.05));assert.ok(classic.env.barriers.filter(item=>item.type==='wall').every(item=>item.height===3.2));}finally{light.env.dispose();classic.env.dispose();}
});

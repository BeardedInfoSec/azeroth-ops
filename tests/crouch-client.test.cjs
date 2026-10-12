// Exercise real client movement/camera/input without a renderer or imported map.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/game.js'),'utf8');
function load(context,name,next){const start=source.indexOf('function '+name+'('),end=source.indexOf(next,start);assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),context);}
async function fixture(t,{roof=false}={}){
  const T=await import('three'),bvh=await import('three-mesh-bvh'),config=await import('../src/player-config.js'),stance=await import('../src/engine/player-stance.js'),movement=await import('../src/engine/ground-movement.js'),{CharacterCollision}=await import('../src/engine/character-collision.js'),{resolveFortificationMove}=await import('../src/engine/fortification-motion.js');
  const geometries=[new T.PlaneGeometry(40,40).rotateX(-Math.PI/2)];if(roof)geometries.push(new T.BoxGeometry(2,.2,2).translate(0,1.85,0));
  const {mergeGeometries}=await import('three/addons/utils/BufferGeometryUtils.js'),geometry=mergeGeometries(geometries),collider=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));geometry.boundsTree=new bvh.MeshBVH(geometry);collider.raycast=bvh.acceleratedRaycast;
  t.after(()=>{geometry.dispose();geometries.forEach(g=>g.dispose());collider.material.dispose();});
  const ray=new T.Raycaster(),player=new T.Vector3(0,2.45,0),sent=[],elements=new Map();
  const districts=await import('../src/districts.mjs'),context=vm.createContext({...config,...stance,...movement,...districts,city:'stormwind',THREE:T,resolveFortificationMove,characterCollision:new CharacterCollision(2.45,.32),world:{collider},player,spawn:player.clone(),velocity:new T.Vector3(),groundJump:new movement.GroundJump(),grounded:true,vertical:0,airbornePeak:null,elapsed:0,hp:100,active:true,crouched:false,crouchToggle:false,combat:{},mode:'factions',networkActive:false,networkPoseTime:0,lobby:{room:{phase:'playing'},send:m=>sent.push(m)},keys:new Set(),yaw:0,pitch:0,aim:false,shooting:false,isRoyale:()=>false,isCoop:()=>false,canPlayInput:()=>true,classSpeed:()=>1,racialMovement:()=>1,currentRace:()=> 'human',notify(){},floorAt(x,z,top,max){ray.set(new T.Vector3(x,top,z),new T.Vector3(0,-1,0));ray.far=max;return ray.intersectObject(collider)[0]||null;},camera:new T.PerspectiveCamera(78,1,.01,100),viewKick:0,recoverKick:v=>v,simulation:{ads:0,reloadLeft:0},thirdPerson:false,weapon:new T.Object3D(),knife:{active:false},playerUnit:null,GUNS:[{adsFov:60}],gunIndex:0,scope:{hidden:true},gunModels:[{userData:{adsOffset:[0,0,-.3],adsPitch:0}}],recoil:0,$:id=>{if(!elements.has(id))elements.set(id,{style:{}});return elements.get(id);}});
  load(context,'collide','function move(');load(context,'move','function updateViewPose(');load(context,'updateViewPose','function tickBots(');
  const handlers={};context.document={addEventListener:(name,callback)=>handlers[name]=callback};const start=source.indexOf("document.addEventListener('keydown',e=>{if(!active"),end=source.indexOf("document.addEventListener('keyup'",start);assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),context);
  return {context,T,sent,key(code,repeat=false){handlers.keydown({code,repeat,preventDefault(){}});},step(count=1){for(let i=0;i<count;i++){context.elapsed+=1/120;context.move(1/120);}}};
}

test('Releasing movement or losing control stops horizontal drift immediately',async t=>{
  const f=await fixture(t),c=f.context;c.velocity.set(0,0,-9);f.step();assert.equal(c.player.x,0);assert.equal(c.player.z,0);assert.equal(c.velocity.length(),0);
  c.active=false;c.keys.add('KeyW');c.velocity.set(0,0,-9);f.step();assert.equal(c.player.z,0,'stale input cannot move an unfocused operator');
});

test('C toggles crouch once, lowers camera without moving feet, and disables sprint',async t=>{
  const f=await fixture(t),c=f.context;f.key('KeyC');f.key('KeyC',true);f.step();assert.equal(c.crouched,true);assert.equal(c.camera.position.y,1.6);assert.ok(Math.abs(c.player.y-2.45)<1e-6);
  c.keys.add('KeyW');c.keys.add('ShiftLeft');f.step(120);assert.ok(Math.abs(c.player.z+2.6)<1e-6);assert.equal(c.characterCollision.height,1.6);
  c.keys.clear();f.key('KeyC');f.step();assert.equal(c.crouched,false);assert.ok(Math.abs(c.camera.position.y-2.45)<1e-6);
});

test('Low overhead geometry prevents standing and jumping until the player moves clear',async t=>{
  const f=await fixture(t,{roof:true}),c=f.context;f.key('KeyC');f.step();assert.equal(c.crouched,true);
  f.key('Space');f.step();assert.equal(c.crouched,true);assert.equal(c.vertical,0);assert.equal(c.camera.position.y,1.6);
  c.player.x=2;f.step();assert.equal(c.crouched,false);assert.ok(Math.abs(c.player.y-2.45)<1e-6);assert.ok(Math.abs(c.camera.position.y-2.45)<1e-6);
});

test('LAN sends stance before actions with unchanged feet and allows a corrected crouch to clear safely',async t=>{
  const f=await fixture(t),c=f.context;c.networkActive=true;c.networkClass={};f.key('KeyC');f.step();assert.equal(f.sent.length,1);assert.equal(f.sent[0].type,'pose');assert.equal(f.sent[0].crouched,true);assert.deepEqual(Array.from(f.sent[0].position),[0,2.45,0]);
  load(c,'handleNetwork','function tickNetwork(');c.handleNetwork({type:'correct',position:[0,2.45,0],crouched:true});assert.equal(c.crouched,true);assert.equal(c.velocity.length(),0);
  f.key('KeyC');f.step();assert.equal(c.crouched,false);assert.equal(f.sent.at(-1).crouched,false);
});

test('Solo recovery relocation chooses a safe crouch when returning under a beam',async t=>{
  const f=await fixture(t,{roof:true}),c=f.context;load(c,'relocatePlayer','function createSurvivalMode(');
  c.player.x=3;c.velocity.set(0,0,-5);c.groundJump.press(0);c.relocatePlayer(new f.T.Vector3(0,2.45,0));
  assert.equal(c.crouched,true);assert.equal(c.crouchToggle,false);assert.equal(c.velocity.length(),0);assert.equal(c.grounded,false);assert.equal(c.groundJump.queuedUntil,-Infinity);
  f.step();assert.equal(c.crouched,true);assert.ok(Math.abs(c.camera.position.y-1.6)<1e-6);
});

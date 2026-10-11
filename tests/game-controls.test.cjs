// Exercise real control functions with tiny CPU objects; never import game.js,
// create a WebGL renderer, load an arena, or request native pointer lock.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/game.js'),'utf8');
function loadFunction(context,name,next){const start=source.indexOf('function '+name+'('),end=source.indexOf(next,start);assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start-(source.slice(start-6,start)==='async '?6:0),end),context);}

test('Empty primary fire automatically knifes; ammunition and recovery choose the correct action without gun effects',()=>{
  let knife=0,reload=0;const context=vm.createContext({canPlayInput:()=>true,hp:100,combat:{},meleeRemaining:()=>0,isRoyale:()=>false,simulation:{ammo:0,reserve:0,fire(){throw Error('Empty fire must not call gun.fire');}},quickKnife:()=>knife++,reload:()=>reload++});
  loadFunction(context,'fire','function updateHUD(');
  context.fire();assert.equal(knife,1);assert.equal(reload,0);
  context.simulation.reserve=30;context.fire();assert.equal(knife,1);assert.equal(reload,1);
  context.hp=0;context.fire();assert.equal(knife,1);assert.equal(reload,1);
  context.hp=100;context.meleeRemaining=()=>.3;context.fire();assert.equal(reload,1);
});

test('Quick knife uses cover and shared damage, predicts no LAN damage, and preserves ammunition',async()=>{
  const THREE=await import('three'),rules=await import('../src/melee-rules.mjs'),{WeaponSimulation}=await import('../src/engine/weapon-simulation.mjs'),{GUNS}=await import('../src/weapon-data.js'),{shotBlocked}=await import('../src/ballistics.js');
  let now=1000,damage=0,swings=0;const cover=new THREE.Group(),messages=[],simulation=new WeaponSimulation(GUNS),unit={id:'undead',alive:true,faction:'scourge',mesh:{position:new THREE.Vector3(0,0,-1.5)},actor:{height:1.85}};
  const context=vm.createContext({canPlayInput:()=>true,THREE,...rules,active:true,ready:true,hp:100,combat:{winner:null,playerKills:0,playerShot(target,amount){assert.equal(target,unit);damage+=amount;return true;}},simulation,meleeState:{},performance:{now:()=>now},networkActive:false,networkStatus:'alive',isRoyale:()=>false,aim:false,scope:{hidden:false},document:{body:{classList:{remove(){}}}},muzzle:{reset(){}},knife:{swing(){swings++;}},weapon:{visible:true},playerUnit:null,player:new THREE.Vector3(0,2.45,0),yaw:0,pitch:0,bots:[unit],shotBlocked,shotCover:()=>cover,hitPoint:new THREE.Vector3(),sound(){},notify(){},updateHUD(){},lobby:{send:m=>messages.push(m)}});
  Object.assign(context,await import('../src/player-config.js'),await import('../src/engine/player-stance.js'),{crouched:false});
  loadFunction(context,'quickKnife','function setMenuCamera(');
  assert.equal(context.quickKnife(),true);assert.equal(damage,130);assert.equal(simulation.ammo,GUNS[0].capacity);assert.equal(swings,1);assert.equal(context.weapon.visible,false);assert.equal(context.scope.hidden,true);
  assert.equal(context.quickKnife(),false);assert.equal(swings,1);
  now+=800;simulation.tick(.8,false,false);const wall=new THREE.Mesh(new THREE.BoxGeometry(2,3,.2),new THREE.MeshBasicMaterial());wall.position.set(0,1.5,-.6);cover.add(wall);cover.updateMatrixWorld(true);
  assert.equal(context.quickKnife(),true);assert.equal(damage,130,'cover prevents local damage');wall.removeFromParent();wall.geometry.dispose();wall.material.dispose();
  now+=800;simulation.tick(.8,false,false);context.networkActive=true;assert.equal(context.quickKnife(),true);assert.equal(damage,130,'LAN damage waits for server');assert.equal(messages[0].type,'melee');
});

test('LAN load waits for host layout, reloads mismatched scenery, and never acknowledges failed loading',async()=>{
  const session=await import('../src/match-session.mjs'),{defaultLayout}=await import('../src/map-layout.mjs');const layout=defaultLayout('stormwind'),sent=[],changes=[],status=[];
  const room={code:'TEST',loadGeneration:1,layoutRevision:'1:abc',phase:'loading',city:'stormwind',mode:'tdm',layout:null,players:[{id:'local',team:'alliance',race:'human'}]},elements=new Map();
  const context=vm.createContext({...session,networkLoadAttempt:0,waitForMatchFrame:async()=>{},syncNetwork(){},updateViewPose(){},autoDeploy(){},refreshMatchScreen(){},networkLoading:false,networkActive:false,networkSpawn:0,networkSurvivalSignature:'',networkStatus:'alive',releaseMouse(){},resetKnife(){},city:'stormwind',ready:true,world:{layout:{...layout,hiddenProps:[2]}},assetsReady:Promise.resolve(),lobby:{id:'local',room,send:m=>sent.push(m),status:m=>status.push(m)},$:id=>{if(!elements.has(id))elements.set(id,{value:''});return elements.get(id);},updateRaceOptions(){},selectOperator(){},clearRoyale(){},setAtmosphere(){},combat:{units:[],reset(){}},stylePackedWeapons(){},clearSentry(){},streaks:{reset(){}},spawn:{},yaw:0,document:{querySelector:()=>({textContent:''})},console:{error(){}}});
  context.changeCity=async(id,override)=>{changes.push([id,override]);context.world={layout:override};context.ready=true;};
  loadFunction(context,'prepareNetwork','function networkGun(');
  await context.prepareNetwork(room);assert.equal(context.networkLoading,false);assert.equal(changes.length,0);assert.equal(sent.length,0);
  room.layout=layout;await context.prepareNetwork(room);assert.equal(changes.length,1);assert.equal(changes[0][1],layout);assert.equal(sent.at(-1).type,'loaded');assert.equal(sent.at(-1).loadGeneration,1);assert.equal(sent.at(-1).layoutRevision,'1:abc');
  context.networkActive=false;sent.length=0;context.waitForMatchFrame=async()=>{room.loadGeneration++;};await context.prepareNetwork(room);assert.equal(sent.some(m=>m.type==='loaded'),false,'A new match during frame preparation cannot accept the old ready ack');assert.equal(sent.some(m=>m.type==='leave'),false);context.waitForMatchFrame=async()=>{};
  context.networkActive=false;context.ready=false;sent.length=0;context.changeCity=async()=>{context.ready=false;};await context.prepareNetwork(room);assert.equal(sent.some(m=>m.type==='loaded'),false);assert.equal(sent.at(-1).type,'leave');assert.match(status.at(-1),/host map layout/);
});

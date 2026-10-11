const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/game.js'),'utf8');
function loadFunction(context,name,next){const start=source.indexOf('function '+name+'('),end=source.indexOf(next,start);assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),context);}
async function fixture(){
  const T=await import('three'),rules=await import('../src/radar.mjs');
  const unit={id:'remote',alive:true,networkSpawn:1,faction:'horde',mesh:{position:new T.Vector3(5,0,-10)}};
  return {T,...rules,unit};
}

test('Silent contacts stay hidden; gunfire pings fade at the firing position and expire after two seconds',async()=>{
  const {unit,recordRadarShot,radarContact,RADAR_SHOT_MS}=await fixture();
  for(const faction of ['horde','alliance','scourge']){unit.faction=faction;assert.equal(radarContact(unit,{now:1000}),null);}
  recordRadarShot(unit,unit.mesh.position,1000);assert.equal(radarContact(unit,{now:1000}).alpha,1);
  unit.mesh.position.x=20;
  const fading=radarContact(unit,{now:2000});assert.deepEqual(fading.position,[5,0,-10]);assert.equal(fading.alpha,.5);
  assert.equal(radarContact(unit,{now:1000+RADAR_SHOT_MS}),null);
  recordRadarShot(unit,unit.mesh.position,3200);assert.deepEqual(radarContact(unit,{now:3200}).position,[20,0,-10]);
  assert.equal(radarContact(unit,{now:10000}),null,'time spent outside the tab must not keep old pings alive');
});

test('UAV reveals current positions only while active; death and a new spawn invalidate old shots',async()=>{
  const {unit,recordRadarShot,radarContact}=await fixture();
  assert.deepEqual(radarContact(unit,{uav:true,now:1000}).position,[5,0,-10]);
  assert.equal(radarContact(unit,{uav:false,now:1000}),null);
  recordRadarShot(unit,unit.mesh.position,1000);unit.mesh.position.x=25;
  assert.deepEqual(radarContact(unit,{uav:true,now:1100}).position,[25,0,-10]);
  assert.deepEqual(radarContact(unit,{uav:false,now:1100}).position,[5,0,-10]);
  unit.networkSpawn++;assert.equal(radarContact(unit,{now:1100}),null);
  recordRadarShot(unit,unit.mesh.position,1200);unit.alive=false;
  assert.equal(radarContact(unit,{uav:true,now:1300}),null);assert.equal(unit.radarShot,null);
  unit.alive=true;assert.equal(radarContact(unit,{now:1400}),null);
});

test('Real radar rendering requires a shot or UAV for every contact and never casts a cover ray',async()=>{
  const {T,unit,radarContact,recordRadarShot}=await fixture(),draws=[];
  const ally={...unit,id:'ally',faction:'alliance',networkFriendly:true,mesh:{position:new T.Vector3(-5,0,-10)}},undead={...unit,id:'undead',faction:'scourge',mesh:{position:new T.Vector3(10,0,0)}};
  const canvas={globalAlpha:1,clearRect(){draws.length=0;},beginPath(){},arc(){},stroke(){},moveTo(){},lineTo(){},closePath(){},fill(){},fillRect(x,y){draws.push({x,y,alpha:this.globalAlpha});}};
  const context=vm.createContext({THREE:T,performance:{now:()=>1000},$:()=>({getContext:()=>canvas}),player:new T.Vector3(),yaw:0,bots:[unit,ally,undead],uavTime:0,radarContact,shotBlocked(){throw Error('Radar must not raycast city cover');}});
  loadFunction(context,'radar','const engineClock=');context.radar();assert.equal(draws.length,0);
  recordRadarShot(unit,unit.mesh.position,500);context.radar();assert.equal(draws.length,1);assert.equal(draws[0].alpha,.75);assert.equal(canvas.globalAlpha,1);
  recordRadarShot(ally,ally.mesh.position,1000);context.radar();assert.equal(draws.length,2);
  context.uavTime=30;context.radar();assert.equal(draws.length,3);
  undead.mesh.position.x=50;context.radar();assert.equal(draws.length,2,'UAV retains radar range');
});

test('LAN radar uses confirmed firearm events, including when unfocused; knife and sentry events do not reveal an operator',async()=>{
  const {T,unit,recordRadarShot,radarContact}=await fixture();unit.gun={};unit.actor={animate(){}};
  const context=vm.createContext({THREE:T,networkActive:true,lobby:{id:'local'},bots:[unit],recordRadarShot:(u,p)=>recordRadarShot(u,p,1000),weaponShotEffect(){},tracer(){},worldMuzzle(){},playWeaponShot(){},equipKnife(){}});
  loadFunction(context,'handleNetwork','function tickNetwork(');
  context.handleNetwork({type:'shot',id:'remote',from:[7,2,-9],to:[0,2,0],gun:0,hit:false});
  assert.deepEqual(radarContact(unit,{now:1000}).position,[7,2,-9]);
  unit.radarShot=null;
  context.handleNetwork({type:'melee',id:'remote',from:[7,2,-9],to:[0,2,0],hit:false});assert.equal(unit.radarShot,null);
  context.handleNetwork({type:'shot',id:'sentry-1',from:[7,2,-9],to:[0,2,0],hit:false});assert.equal(unit.radarShot,null);
  context.networkActive=false;context.handleNetwork({type:'shot',id:'remote',from:[7,2,-9],to:[0,2,0],hit:false});assert.equal(unit.radarShot,null);
});

test('Solo bot gunfire passes its shooter to the real game callback and creates a radar ping',async()=>{
  const {T,recordRadarShot,radarContact}=await fixture(),{Combat}=await import('../src/combat.js');
  const callback=source.match(/onBotShot:(\(from,to,index,unit\)=>\{[^\n]+?\}),scene/);assert.ok(callback);
  const onBotShot=vm.runInNewContext('('+callback[1]+')',{recordRadarShot:(u,p)=>recordRadarShot(u,p,1000),worldMuzzle(){},playWeaponShot(){}});
  const unit={id:0,alive:true,faction:'horde',actor:{height:2,update(){},animate(){}},mesh:{position:new T.Vector3(0,0,-5),lookAt(){}},cooldown:0,attackTime:0,navTimer:10,target:{isPlayer:true,actor:{height:2.6}}};
  const combat=Object.assign(Object.create(Combat.prototype),{units:[unit],mode:'factions',faction:'alliance',elapsed:0,playerRespawn:0,countdown:0,getPlayer:()=>new T.Vector3(0,2.45,0),equip(){},shotBlocked:()=>false,nav:{step:()=>false},tracer(){},damagePlayer(){},onBotShot});
  combat.tick(.016);assert.ok(unit.cooldown>0);assert.ok(radarContact(unit,{now:1000}));
  const last=unit.radarShot;combat.tick(.016);assert.equal(unit.radarShot,last,'movement/animation alone cannot refresh the ping');
});

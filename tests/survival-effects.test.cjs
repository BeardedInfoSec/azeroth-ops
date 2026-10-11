const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(perks=[]){
 const T=await import('three'),{SurvivalRules}=await import('../src/survival-rules.mjs'),{SurvivalEffects}=await import('../src/survival-effects.js');
 const rules=new SurvivalRules();rules.perks=new Set(perks);let hp=100,held=false,player=new T.Vector3(12,2.45,0);const calls={down:0,hits:[],ammo:0,upgrades:0},units=[];
 const owner={scene:new T.Scene(),rules,spawn:new T.Vector3(0,2.45,0),getPlayer:()=>player,getHealth:()=>hp,setHealth:value=>hp=value,relocate:point=>player.copy(point),isHolding:()=>held,applyUpgrades:()=>calls.upgrades++,resetWeaponLoadout:()=>{},setGhost:()=>{},notify:()=>{},getAmmo:()=>({capacity:30}),addAmmo:amount=>calls.ammo+=amount,environment:{isAccessible:()=>true},combat:{race:'human',units,nav:{reachable:[{point:new T.Vector3(0,0,0)}]},playerDown:()=>calls.down++,shotBlocked:(from,to)=>to.x===2,playerShot:(unit,damage)=>{calls.hits.push({id:unit.id,damage});return true;}}};
 const effects=new SurvivalEffects(owner);effects.body=()=>{};
 return {T,rules,owner,effects,calls,units,get hp(){return hp},setHeld:value=>held=value,setPlayer:point=>player.copy(point)};
}
test('Quick Revive loses perks and Mule weapon, preserves purchase limit and grants two-second grace',async()=>{
 const f=await fixture(['quick_revive','juggernog','mule_kick']);f.rules.owned=new Set([0,1,2]);f.rules.muleWeapon=2;f.rules.revivePurchases=3;
 assert.equal(f.effects.onLethal(),true);assert.equal(f.hp,0);assert.equal(f.effects.recovery.type,'quick');assert.equal(f.rules.perks.size,0);assert.deepEqual([...f.rules.owned],[0,1]);
 f.effects.tick(4.01);assert.equal(f.hp,100);assert.equal(f.effects.recovery,null);assert.equal(f.effects.grace,2);assert.equal(f.rules.revivePurchases,3);f.effects.tick(2.1);assert.equal(f.effects.grace,0);f.effects.dispose();
});
test("Who's Who takes priority and holding at the corpse restores equipment minus consumed perk",async()=>{
 const f=await fixture(['whos_who','quick_revive','juggernog']);f.rules.owned=new Set([0,1]);f.rules.packed.add(1);const body=f.owner.getPlayer().clone();
 f.effects.onLethal();assert.equal(f.effects.recovery.type,'ghost');assert.ok(f.owner.getPlayer().distanceTo(body)>=8);assert.equal(f.hp,0);
 f.setPlayer(body);f.setHeld(true);f.effects.tick(2.01);assert.equal(f.effects.recovery,null);assert.equal(f.hp,250);assert.deepEqual([...f.rules.perks],['quick_revive','juggernog']);assert.ok(f.rules.packed.has(1));assert.equal(f.effects.grace,2);f.effects.dispose();
});
test('expired ghost falls back to Quick Revive, otherwise ends the run',async()=>{
 const f=await fixture(['whos_who','quick_revive','tombstone']);f.effects.onLethal();f.effects.tick(15.01);assert.equal(f.effects.recovery.type,'quick');assert.equal(f.calls.down,0);f.effects.tick(4.01);assert.equal(f.hp,100);assert.equal(f.effects.stash,null);f.effects.dispose();
 const solo=await fixture(['whos_who']);solo.effects.onLethal();solo.effects.tick(15.01);assert.equal(solo.effects.recovery,null);assert.equal(solo.calls.down,1);assert.equal(solo.hp,0);solo.effects.dispose();
});
test('Tombstone returns a starter life and recovers a packed stash without restoring Tombstone',async()=>{
 const f=await fixture(['tombstone','juggernog']);f.rules.owned=new Set([0,1]);f.rules.packed.add(1);f.effects.onLethal();assert.equal(f.effects.recovery.type,'tombstone');assert.deepEqual([...f.rules.owned],[0]);
 f.effects.tick(4.01);assert.equal(f.hp,100);assert.ok(f.effects.stash);assert.ok(f.owner.getPlayer().equals(f.owner.spawn));f.setPlayer(f.effects.stash.position);f.setHeld(true);f.effects.tick(1.01);assert.equal(f.effects.stash,null);assert.deepEqual([...f.rules.owned],[0,1]);assert.ok(f.rules.packed.has(1));assert.deepEqual([...f.rules.perks],['juggernog']);f.effects.dispose();
});
test('Electric Cherry and PhD apply bounded damage and respect line of sight',async()=>{
 const f=await fixture(['electric_cherry','phd_flopper']);f.setPlayer(new f.T.Vector3(0,2.45,0));for(const [id,x] of [[0,1],[1,2],[2,7]])f.units.push({id,alive:true,mesh:{position:new f.T.Vector3(x,0,0)},actor:{height:1.8}});
 f.effects.onReload({fractionEmpty:1});assert.deepEqual(f.calls.hits,[{id:0,damage:100}]);assert.equal(f.units[0].stunLeft,2);assert.equal(f.units[1].stunLeft,undefined);
 f.effects.onLand(1.19);assert.equal(f.calls.hits.length,1);f.effects.onLand(1.2);assert.deepEqual(f.calls.hits.at(-1),{id:0,damage:150});f.effects.dispose();
});
test('Electric Cherry cannot repeat after reload cancellation until that gun fires again',async()=>{
 const f=await fixture(['electric_cherry']);let gun=0;f.owner.getGun=()=>gun;f.setPlayer(new f.T.Vector3(0,2.45,0));f.units.push({id:0,alive:true,mesh:{position:new f.T.Vector3(1,0,0)},actor:{height:1.8}});
 f.effects.onReload({fractionEmpty:1});assert.equal(f.calls.hits.length,1);
 f.effects.onReload({fractionEmpty:1});assert.equal(f.calls.hits.length,1,'Cancelling and restarting reload cannot shock again');
 gun=1;f.effects.onReload({fractionEmpty:1});assert.equal(f.calls.hits.length,2,'A different gun has its own initial charge');
 gun=0;f.effects.onReload({fractionEmpty:1});assert.equal(f.calls.hits.length,2,'Switching back cannot reset its charge');
 f.effects.onShot(1);f.effects.onReload({fractionEmpty:1});assert.equal(f.calls.hits.length,2,'Firing another gun cannot recharge this one');
 f.effects.onShot(0);f.effects.onReload({fractionEmpty:1});assert.equal(f.calls.hits.length,3);f.effects.dispose();
});
test('Vulture Aid creates a collectible ammo drop, temporary concealment and enemy markers',async()=>{
 const f=await fixture(['vulture_aid']);f.setPlayer(new f.T.Vector3(0,2.45,0));f.units.push({id:5,alive:false,mesh:{position:new f.T.Vector3()},actor:{height:1.8}},{id:6,alive:true,mesh:{position:new f.T.Vector3(5,0,0)},actor:{height:1.8}});
 const random=Math.random;try{Math.random=()=>.1;f.effects.killed(5);}finally{Math.random=random;}
 f.owner.environment.interactions=[{id:'perk-juggernog',type:'perk',zone:0,position:new f.T.Vector3(10,0,0)},{id:'weapon-2',type:'weapon',zone:1,position:new f.T.Vector3(20,0,0)}];
 assert.equal(f.effects.pickups.length,1);assert.equal(f.effects.clouds.length,1);f.effects.tick(.01);assert.equal(f.calls.ammo,30);assert.equal(f.effects.pickups.length,0);assert.equal(f.effects.hidden,true);assert.equal(f.effects.markers.size,1);assert.equal(f.effects.machineMarkers.size,1);f.rules.zones.add(1);f.effects.tick(.01);assert.equal(f.effects.machineMarkers.size,2);
 f.effects.tick(11);assert.equal(f.effects.hidden,false);assert.equal(f.effects.clouds.length,0);f.rules.perks.clear();f.effects.tick(.01);assert.equal(f.effects.markers.size,0);assert.equal(f.effects.machineMarkers.size,0);f.effects.dispose();assert.equal(f.owner.scene.children.length,0);
});
test('held recovery input finishes effects but cannot immediately buy a nearby machine',async()=>{
 const {Survival}=await import('../src/survival.js'),T=await import('three');let held=true,targets=0,effectTicks=0;
 const controller=Object.create(Survival.prototype);Object.assign(controller,{combat:{winner:null},cooldown:0,draw(){},isHolding:()=>held,target:()=>{targets++;return null;},effects:{recovery:{type:'ghost'},stash:null,tick(){effectTicks++;this.recovery=null;},feet:()=>new T.Vector3()}});
 controller.tick(.1);controller.tick(.1);assert.equal(effectTicks,2);assert.equal(targets,0);assert.equal(controller.requireRelease,true);
 held=false;controller.tick(.1);assert.equal(controller.requireRelease,false);assert.equal(targets,1);
 held=true;controller.effects.stash={mesh:{position:new T.Vector3()},hold:0};controller.effects.tick=function(){this.stash.hold+=.1;};controller.tick(.1);assert.equal(controller.effects.stash.hold,.1);assert.equal(targets,1,'Stash hold takes priority over a nearby purchase');
});
test('Human recovery uses its shorter timer and Tauren recovery restores racial maximum health',async()=>{
 const human=await fixture(['quick_revive']);human.effects.onLethal();assert.equal(human.effects.recovery.left,3.4);human.effects.tick(3.39);assert.equal(human.hp,0);human.effects.tick(.02);assert.equal(human.hp,100);human.effects.dispose();
 const tauren=await fixture(['quick_revive']);tauren.owner.combat.race='tauren';tauren.effects.onLethal();assert.equal(tauren.effects.recovery.left,4);tauren.effects.tick(4.01);assert.equal(tauren.hp,105);tauren.effects.dispose();
});

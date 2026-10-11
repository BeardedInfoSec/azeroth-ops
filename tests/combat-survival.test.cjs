const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(){
 const T=await import('three'),{Combat}=await import('../src/combat.js');
 const calls={awards:[],attacks:0,releases:0,refills:[],ticks:0,speeds:[],notices:[],disposes:0,hurts:[]};
 const entry={outside:new T.Vector3(10,0,0),inside:new T.Vector3(5,0,0),boards:2};
 const adapter={waveSettings:()=>({count:2,health:100,speed:2,damage:17,spawnInterval:1}),startWave:()=>{},tick:()=>calls.ticks++,nextEntry:()=>entry,attackEntry:()=>calls.attacks++,releaseEntry:b=>{b.mesh.position.copy(entry.inside);b.entry=null;calls.releases++;},awardHit:(...args)=>calls.awards.push(args),dispose:()=>calls.disposes++};
 const combat=new Combat({scene:new T.Scene(),getPlayer:()=>new T.Vector3(0,2.45,0),shotBlocked:()=>false,notify:(...args)=>calls.notices.push(args),refill:respawn=>calls.refills.push(respawn),damagePlayer:amount=>calls.hurts.push(amount)});
 Object.assign(combat,{mode:'undead',faction:'alliance',survival:adapter,waveQueue:0,nextUndeadId:0,nav:{step:(b,p,s)=>{calls.speeds.push(s);return true;}}});
 combat.clear=()=>{combat.units=[];};
 combat.add=(race,faction,p,id,hp=100)=>{const unit={id,race,faction,hp,alive:true,mesh:new T.Object3D(),actor:{height:1.8,update(){},animate(name){this.animation=name;}},ring:{},label:{},cooldown:0,attackTime:0,navTimer:0};unit.mesh.position.copy(p);combat.units.push(unit);return unit;};
 return {T,combat,calls,adapter,entry};
}

test('survival gradually spawns its queue and keeps boarded entries from targeting the player',async()=>{
 const {combat,calls}=await fixture();combat.startWave();assert.equal(combat.units.length,0);assert.equal(combat.waveQueue,2);
 combat.tick(.5);assert.equal(combat.units.length,0);assert.equal(combat.countdown,0);
 combat.tick(.5);assert.equal(combat.units.length,1);assert.equal(combat.waveQueue,1);assert.equal(calls.attacks,1);assert.equal(combat.units[0].target,null);
 combat.tick(.5);assert.equal(combat.units.length,1);assert.equal(calls.attacks,1);assert.deepEqual(calls.speeds,[]);
 combat.tick(.5);assert.equal(combat.units.length,2);assert.equal(combat.waveQueue,0);
});

test('broken entry release may take several ticks without attacking boards or acquiring a target',async()=>{
 const {combat,calls,adapter,entry}=await fixture();combat.startWave();combat.tick(1);entry.boards=0;
 adapter.releaseEntry=b=>{calls.releases++;b.actor.animate('walk');if(calls.releases===3){b.mesh.position.copy(entry.inside);b.entry=null;}};
 const unit=combat.units[0],attacks=calls.attacks;combat.tick(.1);combat.tick(.1);
 assert.ok(unit.entry);assert.equal(unit.target,null);assert.equal(unit.actor.animation,'walk');assert.equal(calls.attacks,attacks);
 combat.tick(.1);assert.equal(unit.entry,null);assert.ok(unit.target.isPlayer);assert.deepEqual(calls.speeds,[2]);
});

test('closet spawns use the concealed origin and finish approaching before attacking or releasing',async()=>{
 const {T,combat,calls,adapter,entry}=await fixture();entry.spawnPoint=new T.Vector3(12,0,2);let approached=false;
 adapter.approachEntry=b=>{b.actor.animate('walk');return approached;};
 combat.startWave();combat.tick(1);const unit=combat.units[0];assert.deepEqual(unit.mesh.position.toArray(),[12,0,2]);assert.equal(calls.attacks,0);assert.equal(unit.target,null);
 entry.boards=0;combat.tick(.1);assert.equal(calls.releases,0,'Broken boards do not skip the physical approach path');
 approached=true;combat.tick(.1);assert.equal(calls.releases,1);assert.equal(unit.entry,null);
});

test('retired entries release their existing occupant without further board attacks',async()=>{
 const {combat,calls,entry}=await fixture();combat.startWave();combat.tick(1);entry.retired=true;
 const attacks=calls.attacks;combat.tick(.1);assert.equal(calls.attacks,attacks);assert.equal(calls.releases,1);assert.equal(combat.units[0].entry,null);
});

test('entry walking follows every corner, respects physical blockers and never teleports to the interior',async()=>{
 const {T}=await fixture(),{Survival}=await import('../src/survival.js'),visited=[];
 let blocked=false;const controller=Object.create(Survival.prototype);controller.lastdt=.1;
 controller.environment={canEntryMove(entry,from,to){visited.push([from.clone(),to.clone()]);return !blocked;}};
 const unit={mesh:new T.Object3D(),actor:{animate(){}},entry:{approachPath:[new T.Vector3(1,0,0),new T.Vector3(1,0,1)],releasePath:[new T.Vector3(1,.1,2),new T.Vector3(1,.2,3)]}};
 controller.approachEntry(unit);assert.equal(unit.mesh.position.x,.25);assert.equal(unit.mesh.position.z,0);
 blocked=true;const before=unit.mesh.position.clone();controller.approachEntry(unit);assert.ok(unit.mesh.position.equals(before));
 blocked=false;for(let i=0;i<12;i++)controller.approachEntry(unit);
 assert.deepEqual(unit.mesh.position.toArray(),[1,0,1]);assert.ok(unit.entry);
 controller.releaseEntry(unit);assert.ok(unit.entry);assert.ok(unit.mesh.position.z<2);
 for(let i=0;i<20&&unit.entry;i++)controller.releaseEntry(unit);
 assert.equal(unit.entry,null);assert.deepEqual(unit.mesh.position.toArray(),[1,.2,3]);
 assert.ok(visited.every(([from,to])=>from.distanceTo(to)<=.120001),'All collision queries cover bounded movement steps');
});

test('survival awards only accepted actual damage and waits for the remaining spawn queue',async()=>{
 const {combat,calls}=await fixture();combat.startWave();combat.tick(1);const first=combat.units[0];
 for(const damage of [NaN,Infinity,-1,0])assert.equal(combat.playerShot(first,damage,false),false);
 assert.deepEqual(calls.awards,[]);combat.playerShot(first,10,false);combat.playerShot(first,999,true);
 assert.deepEqual(calls.awards,[[0,10,false,false],[0,90,true,true]]);assert.equal(combat.playerShot(first,10,false),false);assert.equal(calls.awards.length,2);assert.equal(combat.countdown,0);
 assert.equal(calls.notices.some(([text])=>text.includes('+100')),false);
 combat.tick(1);combat.playerShot(combat.units[1],100,false);assert.equal(combat.countdown,8);
 combat.tick(7.9);assert.equal(combat.wave,1);combat.tick(.2);assert.equal(combat.wave,2);assert.deepEqual(calls.refills,[]);assert.equal(combat.units.length,0);assert.equal(combat.waveQueue,2);
 combat.tick(1);assert.equal(combat.units[0].id,2,'Reward IDs remain unique across waves');
});

test('survival caps living enemies at 24 and retries unavailable entries',async()=>{
 const {combat,adapter,entry}=await fixture();combat.startWave();adapter.nextEntry=()=>null;combat.tick(1);assert.equal(combat.units.length,0);assert.equal(combat.waveQueue,2);
 adapter.nextEntry=()=>entry;for(let i=0;i<24;i++){const unit=combat.add('zombie','scourge',entry.outside,i+50);unit.entry=entry;}
 combat.tick(1);assert.equal(combat.units.length,24);assert.equal(combat.waveQueue,2);
 combat.units[0].alive=false;combat.tick(.1);assert.equal(combat.units.filter(unit=>unit.alive).length,24);assert.equal(combat.waveQueue,1);
});

test('reset disposes survival before clearing units; switching to exploration detaches it',async()=>{
 const {T,combat,adapter}=await fixture(),order=[];adapter.dispose=()=>order.push('dispose');combat.clear=()=>order.push('clear');
 combat.reset('explore','alliance','human',new T.Vector3(),0);
 assert.deepEqual(order,['dispose','clear']);assert.equal(combat.survival,null);assert.equal(combat.waveQueue,0);
});

test('faction kills and faction player respawns keep their existing behavior',async()=>{
 const {combat,calls,entry}=await fixture();combat.survival=null;combat.mode='factions';const enemy=combat.add('orc','horde',entry.outside,0);
 assert.equal(combat.playerShot(enemy,100,false),true);assert.equal(combat.score.alliance,1);assert.equal(combat.playerKills,1);assert.equal(combat.countdown,0);assert.equal(calls.notices.at(-1)[0],'ELIMINATION +100');
 combat.playerRespawn=.05;combat.playerSpawn=()=>entry.inside;combat.tick(.1);assert.deepEqual(calls.refills,[true]);assert.deepEqual(calls.awards,[]);
});

test('stunned undead neither navigate nor attack and resume when the stun expires',async()=>{
 const {T,combat,calls,adapter}=await fixture();combat.waveConfig=adapter.waveSettings();
 const unit=combat.add('zombie','scourge',new T.Vector3(5,0,0),0);unit.stunLeft=.2;
 combat.tick(.1);combat.tick(.1);assert.equal(unit.stunLeft,0);assert.equal(unit.actor.animation,'idle');assert.deepEqual(calls.speeds,[]);assert.deepEqual(calls.hurts,[]);
 combat.tick(.1);assert.deepEqual(calls.speeds,[2]);assert.ok(unit.target.isPlayer);
 unit.mesh.position.set(1,0,0);unit.cooldown=0;unit.stunLeft=.2;
 combat.tick(.1);combat.tick(.1);assert.deepEqual(calls.hurts,[]);
 combat.tick(.1);assert.deepEqual(calls.hurts,[17]);assert.equal(unit.actor.animation,'attack');
});

test('hidden survivors cannot be acquired and lose cached undead targets immediately',async()=>{
 const {T,combat,calls,adapter}=await fixture();combat.waveConfig=adapter.waveSettings();
 const unit=combat.add('zombie','scourge',new T.Vector3(1,0,0),0);adapter.playerHidden=true;
 combat.tick(.1);assert.equal(unit.target,null);assert.deepEqual(calls.hurts,[]);assert.deepEqual(calls.speeds,[]);
 adapter.playerHidden=false;combat.tick(.4);assert.ok(unit.target.isPlayer);assert.deepEqual(calls.hurts,[17]);
 unit.navTimer=100;unit.cooldown=0;adapter.playerHidden=true;
 combat.tick(.1);assert.equal(unit.target,null,'Cached target is revoked without waiting for normal retarget timer');assert.deepEqual(calls.hurts,[17]);
 unit.mesh.position.set(5,0,0);combat.tick(.5);assert.deepEqual(calls.speeds,[],'Mist also suppresses pursuit');
 adapter.playerHidden=false;combat.tick(.4);assert.ok(unit.target.isPlayer);assert.deepEqual(calls.speeds,[2]);
});

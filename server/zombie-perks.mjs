import * as T from 'three';
import {COOP_RULES} from '../src/coop-rules.mjs';
import {racialReviveDuration} from '../src/racial-traits.mjs';

const alive=p=>p.status==='alive'&&p.hp>0;
const held=(p,now)=>p.interactHeld&&now-p.interactAt<350;
const notice=(m,p,message)=>m.send(p,{type:'notice',message});
function arrays(m){m.stashes??=[];m.pickups??=[];m.clouds??=[];}
function clearLine(m,a,b){return !m.trace(a.clone().add(new T.Vector3(0,1,0)),b.clone().add(new T.Vector3(0,1,0)));}
function equipment(p){return {loadout:p.survival.snapshotLoadout(),inventory:p.weapon.inventory.map(i=>({...i})),gun:p.weapon.index};}
function restore(m,p,snapshot,exclude){
  p.survival.restoreLoadout(snapshot.loadout,{excludePerks:exclude});m.configureWeapons(p,{});
  for(const index of p.survival.owned){const source=snapshot.inventory[index],gun=p.weapon.guns[index];if(source&&gun)p.weapon.inventory[index]={ammo:Math.max(0,Math.min(gun.capacity,source.ammo)),reserve:Math.max(0,Math.min(gun.reserve,source.reserve))};}
  p.weapon.select(p.survival.owned.has(snapshot.gun)?snapshot.gun:[...p.survival.owned][0]);
}
function burst(m,p,now,radius,damage,color,stun=0){
  if(!alive(p))return;const center=m.feet(p).add(new T.Vector3(0,1,0));
  for(const unit of [...m.units]){if(!unit.alive)continue;const target=unit.position.clone().add(new T.Vector3(0,(unit.height||1.8)*.6,0));if(center.distanceTo(target)>radius||m.trace(center,target))continue;unit.stunUntil=Math.max(unit.stunUntil||0,now+stun*1000);m.hurtUnit(unit,damage,p,false);}
  m.broadcast({type:'zombie-burst',position:center.toArray(),radius,color});
}
export function onDown(m,p,now){
  arrays(m);const snapshot=equipment(p),perks=p.survival.perks;p.zombieHidden=false;p.selfRecovery=null;
  if(perks.has('whos_who'))p.selfRecovery={until:now+COOP_RULES.selfReviveWindow*1000,hold:0,required:racialReviveDuration(COOP_RULES.selfRevive,p.race),snapshot,requireRelease:true};
  if(perks.has('tombstone')){m.stashes=m.stashes.filter(s=>s.owner!==p.id);m.stashes.push({id:'stash-'+p.id+'-'+now,owner:p.id,position:m.feet(p),snapshot,expiresAt:0,hold:0,requireRelease:true});}
  p.cherrySpent=new Set();
}
export function onShot(_m,p,index){p.cherrySpent?.delete(index);}
export function onReload(m,p,now,fractionEmpty){
  if(!alive(p)||!p.survival.perks.has('electric_cherry'))return;p.cherrySpent??=new Set();const index=p.weapon.index;if(p.cherrySpent.has(index))return;
  p.cherrySpent.add(index);const fraction=Math.max(0,Math.min(1,Number.isFinite(fractionEmpty)?fractionEmpty:0));burst(m,p,now,2+fraction*3,20+fraction*80,0xae90ff,2);
}
export function onLand(m,p,now,distance){if(alive(p)&&Number.isFinite(distance)&&distance>=1.2&&p.survival.perks.has('phd_flopper')&&now>=(p.phdReadyAt||0)){p.phdReadyAt=now+1000;burst(m,p,now,5,150,0xc18cff);}}
export function onKill(m,p,unit,now){
  if(!p||!alive(p)||!p.survival.perks.has('vulture_aid'))return;arrays(m);const random=m.random||Math.random,serial=m.perkSerial=(m.perkSerial||0)+1;
  // A kill behind a boarded window drops its reward on the accessible side.
  const position=(unit.entry?.inside||unit.position).clone();m.pickups.push({id:'drop-'+serial,owner:p.id,type:random()<.5?'ammo':'points',position,expiresAt:now+25000});
  if(random()<.2)m.clouds.push({id:'mist-'+serial,position:position.clone(),expiresAt:now+10000});
}
export function interactPerks(m,p,now){
  arrays(m);return p.status==='downed'&&!!p.selfRecovery||alive(p)&&m.stashes.some(s=>s.owner===p.id&&m.feet(p).distanceTo(s.position)<2.3&&clearLine(m,m.feet(p),s.position));
}
export function tickPerks(m,dt,now){
  arrays(m);dt=Math.max(0,Math.min(.25,dt));const players=m.players;
  for(const p of players){
    const recovery=p.selfRecovery;
    if(recovery){
      if(p.status!=='downed'||now>=recovery.until)p.selfRecovery=null;
      else{if(!held(p,now))recovery.requireRelease=false;recovery.hold=held(p,now)&&!recovery.requireRelease&&(!p.interactTarget||p.interactTarget===p.id)?recovery.hold+dt:0;
        if(recovery.hold>=recovery.required){restore(m,p,recovery.snapshot,['whos_who']);p.selfRecovery=null;m.stashes=m.stashes.filter(s=>s.owner!==p.id);m.revive(p,now);p.perkRequireRelease=true;notice(m,p,"WHO'S WHO / SELF RESCUE COMPLETE");}}
    }
    p.zombieHidden=alive(p)&&p.survival.perks.has('vulture_aid')&&m.clouds.some(c=>c.expiresAt>now&&m.feet(p).distanceTo(c.position)<3);
  }
  for(const s of m.stashes){
    const p=players.find(p=>p.id===s.owner);if(!p){s.expiresAt=now;continue;}
    if(!alive(p)){s.hold=0;continue;}if(!s.expiresAt)s.expiresAt=now+COOP_RULES.stashLifetime*1000;
    if(!held(p,now))s.requireRelease=false;
    const nearby=m.feet(p).distanceTo(s.position)<2.3&&clearLine(m,m.feet(p),s.position);
    s.hold=nearby&&held(p,now)&&!s.requireRelease&&!p.perkRequireRelease&&(!p.interactTarget||p.interactTarget===s.id)?s.hold+dt:0;
    if(s.hold>=COOP_RULES.stashHold&&s.expiresAt>now){restore(m,p,s.snapshot,['tombstone','whos_who']);s.expiresAt=now;p.perkRequireRelease=true;notice(m,p,'TOMBSTONE / EQUIPMENT RECOVERED');}
  }
  m.stashes=m.stashes.filter(s=>!s.expiresAt||s.expiresAt>now);
  for(const drop of m.pickups){const p=players.find(p=>p.id===drop.owner);if(!p){drop.expiresAt=now;continue;}
    if(drop.expiresAt>now&&alive(p)&&p.survival.perks.has('vulture_aid')&&m.feet(p).distanceTo(drop.position)<1.5&&clearLine(m,m.feet(p),drop.position)){
      if(drop.type==='points')p.survival.points+=50;else p.weapon.reserve=Math.min(p.weapon.gun.reserve,p.weapon.reserve+p.weapon.gun.capacity);
      drop.expiresAt=now;notice(m,p,drop.type==='points'?'VULTURE AID / +50 POINTS':'VULTURE AID / AMMUNITION');
    }
  }
  m.pickups=m.pickups.filter(p=>p.expiresAt>now);m.clouds=m.clouds.filter(c=>c.expiresAt>now);
}
export function perkSnapshot(m,now){
  arrays(m);return {pickups:m.pickups.map(p=>({id:p.id,owner:p.owner,type:p.type,position:p.position.toArray(),left:Math.max(0,(p.expiresAt-now)/1000)})),clouds:m.clouds.map(c=>({id:c.id,position:c.position.toArray(),left:Math.max(0,(c.expiresAt-now)/1000)})),stashes:m.stashes.map(s=>({id:s.id,owner:s.owner,position:s.position.toArray(),left:s.expiresAt?Math.max(0,(s.expiresAt-now)/1000):COOP_RULES.stashLifetime,hold:s.hold,waiting:!s.expiresAt}))};
}
export function playerPerkSnapshot(p,now){return {hidden:!!p.zombieHidden,selfRecovery:p.selfRecovery?{left:Math.max(0,(p.selfRecovery.until-now)/1000),hold:p.selfRecovery.hold,required:p.selfRecovery.required}:null};}

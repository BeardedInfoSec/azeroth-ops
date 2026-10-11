import * as T from 'three';
import {GroundNavigation} from '../src/navigation.js';
import {SurvivalWorld} from '../src/survival-world.js';
import {SurvivalRules,waveConfig,survivalWeapons} from '../src/survival-rules.mjs';
import {COOP_PERKS,COOP_RULES} from '../src/coop-rules.mjs';
import {GUNS} from '../src/weapon-data.js';
import {WeaponSimulation,damageAt,hitRegion} from '../src/engine/weapon-simulation.mjs';
import {pelletDirections,tracerCount} from '../src/engine/firing-modes.mjs';
import {MELEE,tryMelee,selectMeleeTarget} from '../src/melee-rules.mjs';
import {resolveFortificationMove} from '../src/engine/fortification-motion.js';
import {PLAYER_EYE_HEIGHT,PLAYER_RADIUS,PLAYER_CROUCH_SPEED,playerEyeHeight,playerHeightOffset,playerBodyHeight} from '../src/player-config.js';
import {stanceEye} from '../src/engine/player-stance.js';
import {racialWeapons,racialMaxHealth,racialMovement,racialRegenDelay,racialRegenRate,racialReviveDuration,racialBleedoutDuration} from '../src/racial-traits.mjs';
import {survivalOrigin} from './world.mjs';
import {onDown,onReload,onLand,onKill,onShot,tickPerks,interactPerks,perkSnapshot,playerPerkSnapshot} from './zombie-perks.mjs';

const eye=new T.Vector3(0,PLAYER_EYE_HEIGHT,0),body=new T.Vector3(0,.9,0);
const vector=a=>new T.Vector3().fromArray(a);
const descendant=(object,parent)=>{for(let p=object;p;p=p.parent)if(p===parent)return true;return false;};

/** One independently owned simulation per lobby. Only immutable city meshes are shared. */
export class ZombieMatch{
  constructor({arena,city=arena.city,players,clock=Date.now,random=Math.random,send=()=>{},broadcast=()=>{},end=()=>{},award=()=>{},nav=null,environment=null}){
    Object.assign(this,{arena,city,clock,random,send,broadcast,end,award});this.getPlayers=players;
    this.spawn=survivalOrigin(arena,city);this.scene=new T.Scene();
    this.nav=nav||new GroundNavigation(this.spawn,arena.floorAt,arena.blocked);
    this.environment=environment||new SurvivalWorld({scene:this.scene,nav:this.nav,spawn:this.spawn,city,worldCollider:arena.collider,perkDefinitions:COOP_PERKS,fortifications:arena.layout?.settings.fortifications});
    this.edges=this.nav.nodes.map(n=>[...n.edges]);this.nav.blocked=(a,b,padding=0)=>arena.blocked(a,b,padding)||this.environment.isMoveBlocked(a,b,padding);
    this.units=[];this.pickups=[];this.clouds=[];this.stashes=[];this.serial=0;this.wave=1;this.queued=0;this.countdown=5;this.spawnDelay=0;this.started=false;this.ended=false;this.lastTick=clock();this.route();
  }
  get players(){return this.getPlayers();}
  feet(p){return vector(p.position).sub(eye);}
  maxHealth(p){return racialMaxHealth(p.survival.maxHealth,p.race);}
  movement(p){return racialMovement(p.race)*p.survival.movementMultiplier;}
  route(){for(const n of this.nav.nodes)n.edges=this.edges[n.id].filter(id=>this.environment.canTraverse(n,this.nav.nodes[id]));this.nav.cache.clear();}
  trace(from,to,exclude=null){
    const delta=to.clone().sub(from),length=delta.length();if(length<.001)return null;
    const city=this.arena.trace(from,to),ray=new T.Raycaster(from,delta.divideScalar(length),0,length);
    this.environment.group?.updateMatrixWorld(true);
    const fort=ray.intersectObject(this.environment.shotCollider,true).find(h=>!exclude||!descendant(h.object,exclude));
    return !fort?city:!city||fort.distance<from.distanceTo(city.point)?fort:city;
  }
  configureWeapons(p,{refillIndex,reset=false}={}){
    const guns=racialWeapons(survivalWeapons(GUNS,p.survival),p.race);
    if(reset||!p.weapon)p.weapon=new WeaponSimulation(guns);
    else{p.weapon.guns=guns;for(let i=0;i<guns.length;i++){const slot=p.weapon.inventory[i];slot.ammo=Math.min(slot.ammo,guns[i].capacity);slot.reserve=Math.min(slot.reserve,guns[i].reserve);}}
    if(refillIndex!==undefined){p.weapon.inventory[refillIndex]={ammo:guns[refillIndex].capacity,reserve:guns[refillIndex].reserve};p.weapon.select(refillIndex);p.weapon.releaseTrigger();}
    if(!p.survival.owned.has(p.weapon.index)){p.weapon.select([...p.survival.owned][0]);p.weapon.releaseTrigger();}
  }
  prepare(now=this.clock()){
    if(this.prepared)return;this.prepared=true;
    for(const p of this.players){p.survival=new SurvivalRules({coop:true});p.status='dead';p.revives=0;p.revive=null;p.selfRecovery=null;p.interactHeld=false;p.reviveBlocked=false;p.fallPeak=null;this.deploy(p,now,true);}
  }
  start(now=this.clock()){
    if(this.started)return;this.prepare(now);this.started=true;this.startedAt=now;this.lastTick=now;
    for(const p of this.players){p.protectedUntil=now+2000;p.lastPose=p.lastTick=p.lastHurt=now;}
  }
  deploy(p,now,initial=false){
    if(!initial){p.survival.resetLoadout();p.survival.points=Math.max(p.survival.points,500);}
    p.survival.zones=new Set(this.environment.unlockedZones);p.survival.resetWave(this.wave);this.configureWeapons(p,{reset:true});
    const others=this.players.filter(o=>o!==p&&o.status==='alive'),threats=this.units.filter(u=>u.alive&&!u.entry);
    const candidates=this.nav.reachable.filter(n=>n.edges.length>=2&&this.environment.isAccessible(n.point)&&!this.environment.isMoveBlocked(n.point.clone().add(body),n.point.clone().add(body),.4));
    const safe=candidates.filter(n=>others.every(o=>n.point.distanceTo(this.feet(o))>=1.6)&&threats.every(u=>n.point.distanceTo(u.position)>=6));
    const pool=safe.length?safe:candidates;pool.sort((a,b)=>a.point.distanceToSquared(this.spawn)-b.point.distanceToSquared(this.spawn));
    const point=pool[0]?.point||this.spawn.clone().sub(eye);p.position=point.clone().add(eye).toArray();p.lastSpawn=p.position.slice();p.spawnNumber=(p.spawnNumber||0)+1;
    p.status='alive';p.hp=this.maxHealth(p);p.crouched=false;p.protectedUntil=now+2000;p.respawnAt=0;p.deployment='landed';p.lastHurt=now;p.lastPose=now;p.lastTick=now;p.yaw=0;p.pitch=0;p.aim=false;p.trigger=false;p.revive=null;p.bleedoutAt=0;p.interactHeld=false;p.interactTarget=null;p.repairTime=0;p.purchaseHeld=false;p.reviveBlocked=false;p.melee={};
    this.send(p,{type:'correct',position:p.position,crouched:!!p.crouched});
  }
  playerSnapshot(p){
    if(!p.survival)return null;
    return {points:p.survival.points,owned:[...p.survival.owned],perks:[...p.survival.perks],packed:[...p.survival.packed],zones:[...this.environment.unlockedZones],maxHealth:this.maxHealth(p),...playerPerkSnapshot(p,this.clock()),revivePurchases:p.survival.revivePurchases,muleWeapon:p.survival.muleWeapon};
  }
  snapshot(){
    const now=this.clock();
    return {wave:this.wave,queued:this.queued,countdown:this.countdown,elapsed:this.started?Math.max(0,(now-this.startedAt)/1000):0,zones:[...this.environment.unlockedZones],spawn:this.spawn.toArray(),ended:this.ended,
      windows:this.environment.windows.map(w=>({id:w.id,boards:w.boards,retired:!!w.retired})),
      units:this.units.map(u=>({id:u.id,race:u.race,position:u.position.toArray(),yaw:u.yaw,hp:u.hp,maxHp:u.maxHp,alive:u.alive,animation:u.animation,entry:u.entry?.id||null})),
      ...perkSnapshot(this,now)};
  }
  beginWave(){
    this.config=waveConfig(this.wave);this.queued=Math.ceil(this.config.count*(1+.5*(this.players.length-1)));this.spawnDelay=0;
    for(const p of this.players){p.survival.resetWave(this.wave);if(p.status==='dead')this.deploy(p,this.clock());}
    this.broadcast({type:'notice',message:'WAVE '+this.wave+' / '+this.queued+' UNDEAD'});
  }
  spawnUnit(){
    const entries=this.environment.activeWindows.filter(w=>!this.units.some(u=>u.alive&&u.entry===w));if(!entries.length)return false;
    const entry=entries[Math.floor(this.random()*entries.length)],id='undead-'+(++this.serial),race=this.serial%3===0?'ghoul':'zombie',position=(entry.spawnPoint||entry.outside).clone();
    this.units.push({id,race,position,mesh:{position},height:race==='ghoul'?1.55:1.85,yaw:0,hp:this.config.health,maxHp:this.config.health,alive:true,animation:'walk',entry,approach:0,release:0,cooldown:.3,stunLeft:0,waypoint:null});this.queued--;return true;
  }
  walkEntry(u,path,key,dt){
    let index=u[key]||0,budget=dt*2.5;u.animation='walk';
    while(index<path.length&&budget>0){const delta=path[index].clone().sub(u.position),distance=delta.length();if(distance<.001){index++;continue;}const step=Math.min(distance,budget,.12),next=u.position.clone().addScaledVector(delta,step/distance);if(!this.environment.canEntryMove(u.entry,u.position,next)){u.animation='idle';break;}u.yaw=Math.atan2(delta.x,delta.z);u.position.copy(next);budget-=step;if(step>=distance-.00001)index++;}
    u[key]=index;return index>=path.length;
  }
  tickUnit(u,dt,now){
    if(!u.alive)return;u.cooldown=Math.max(0,u.cooldown-dt);if(now<(u.stunUntil||0)){u.animation='idle';return;}
    if(u.entry){
      if(!this.walkEntry(u,u.entry.approachPath||[],'approach',dt))return;
      if(u.entry.boards>0){u.animation='attack';if(u.cooldown<=0){this.environment.setBoards(u.entry,u.entry.boards-1);u.cooldown=Math.max(.55,1.1-this.wave*.025);}return;}
      if(!this.walkEntry(u,u.entry.releasePath||[u.entry.inside],'release',dt))return;u.entry=null;u.waypoint=null;
    }
    const targets=this.players.filter(p=>p.status==='alive'&&!p.zombieHidden).sort((a,b)=>this.feet(a).distanceToSquared(u.position)-this.feet(b).distanceToSquared(u.position)),target=targets[0];if(!target){u.animation='idle';return;}
    const destination=this.feet(target),distance=destination.distanceTo(u.position);u.yaw=Math.atan2(destination.x-u.position.x,destination.z-u.position.z);
    if(distance<1.65&&!this.trace(u.position.clone().add(body),destination.clone().add(new T.Vector3(0,playerBodyHeight(.9,target.crouched),0)))){u.animation='attack';if(u.cooldown<=0){this.damagePlayer(target,this.config.damage,now);u.cooldown=1.1;}}
    else u.animation=this.nav.step(u,destination,this.config.speed*(u.race==='ghoul'?1.2:1),dt)?(u.race==='ghoul'&&this.wave>=3?'run':'walk'):'idle';
  }
  damagePlayer(p,damage,now=this.clock()){
    if(p.status!=='alive'||now<p.protectedUntil||!Number.isFinite(damage)||damage<=0)return false;
    p.hp=Math.max(0,p.hp-damage);p.lastHurt=now;
    for(const victim of this.players)if(victim.revive?.by===p.id){victim.revive=null;p.reviveBlocked=true;}
    if(p.hp<=0){
      onDown(this,p,now);p.survival.losePerks();this.configureWeapons(p);p.status='downed';p.deaths++;p.bleedoutAt=now+racialBleedoutDuration(COOP_RULES.bleedout,p.race)*1000;p.revive=null;p.trigger=p.aim=p.interactHeld=false;p.weapon.resetAction();p.streak?.death();
      this.broadcast({type:'notice',message:p.name+' IS DOWN / HOLD E NEAR THEM TO REVIVE'});
    }
    return true;
  }
  revive(p,now=this.clock()){
    if(p.status!=='downed')return false;p.status='alive';p.hp=Math.ceil(this.maxHealth(p)*COOP_RULES.reviveHealth);p.protectedUntil=now+COOP_RULES.reviveShield*1000;p.lastHurt=now;p.bleedoutAt=0;p.revive=null;p.selfRecovery=null;p.reviveBlocked=false;p.interactHeld=false;p.crouched=!!p.crouched||this.arena.canStand?.(vector(p.position),this.environment.movementColliders)===false;this.configureWeapons(p);this.send(p,{type:'correct',position:p.position,crouched:!!p.crouched});this.broadcast({type:'notice',message:p.name+' REVIVED'});return true;
  }
  hurtUnit(u,damage,p,headshot=false){
    if(!u?.alive||!Number.isFinite(damage)||damage<=0)return false;const amount=Math.min(u.hp,damage);u.hp=Math.max(0,u.hp-damage);const killed=u.hp===0;
    if(p?.survival)p.survival.awardHit(u.id,{damage:amount,killed,headshot});
    if(killed){u.alive=false;u.animation='death';u.deadAt=this.clock();if(p){p.kills++;this.award(p,{type:'zombieKill',headshot});onKill(this,p,u,this.clock());}}
    return true;
  }
  isReviving(p){return this.players.some(v=>v.revive?.by===p.id)||this.held(p,this.clock())&&!p.reviveBlocked&&this.players.some(v=>this.canRevive(p,v));}
  melee(p,target){
    if(!Array.isArray(target)||target.length!==3||!target.every(Number.isFinite))return false;
    const from=stanceEye(vector(p.position),p.crouched).add(new T.Vector3(0,-.35,0)),direction=vector(target).sub(from);if(direction.lengthSq()<1e-8)return false;
    if(!tryMelee(p.weapon,p.melee??={},this.clock(),{alive:p.status==='alive'&&p.hp>0,reviving:this.isReviving(p),landed:p.deployment==='landed'}))return false;
    p.protectedUntil=0;
    const contact=selectMeleeTarget({origin:from.toArray(),direction:direction.toArray(),candidates:this.units.filter(u=>u.alive).map(u=>({id:u.id,position:u.position.toArray(),height:u.height,unit:u})),blocked:(a,b)=>!!this.trace(vector(a),vector(b))});
    const hit=!!contact&&this.hurtUnit(contact.candidate.unit,MELEE.damage,p);
    this.broadcast({type:'melee',id:p.id,from:from.toArray(),to:contact?.point||from.addScaledVector(direction.normalize(),MELEE.range).toArray(),hit,killed:!!hit&&!contact.candidate.unit.alive});return true;
  }
  shoot(p,target){
    if(p.status!=='alive'||this.clock()<(p.melee?.nextAt||0)||this.isReviving(p)||!p.weapon.fire({trustCooldown:true}))return false;
    onShot(this,p,p.weapon.index);p.protectedUntil=0;
    const from=stanceEye(vector(p.position),p.crouched).add(new T.Vector3(0,-.35,0)),direction=vector(target).sub(from);if(direction.length()<.001)return false;direction.normalize();
    const gun=p.weapon.gun,dirs=pelletDirections(gun,direction.toArray(),{ads:p.weapon.ads}),struck=new Map(),ends=[];
    for(const d of dirs){
      const ray=new T.Ray(from,vector(d)),far=ray.at(300,new T.Vector3()),wall=this.trace(from,far);let point=wall?.point||far,distance=from.distanceTo(point),victim=null;
      for(const unit of this.units){if(!unit.alive)continue;const box=new T.Box3(unit.position.clone().add(new T.Vector3(-.34,0,-.34)),unit.position.clone().add(new T.Vector3(.34,unit.height,.34))),hit=ray.intersectBox(box,new T.Vector3());if(hit&&from.distanceTo(hit)<distance){point=hit;distance=from.distanceTo(hit);victim=unit;}}
      ends.push(point.toArray());
      if(victim){const region=hitRegion((point.y-victim.position.y)/victim.height),entry=struck.get(victim)||{damage:0,headshot:false};entry.damage+=damageAt(gun,distance,region);entry.headshot||=region==='locHead';struck.set(victim,entry);}
    }
    let hit=false;for(const [victim,entry] of struck)hit=this.hurtUnit(victim,entry.damage,p,entry.headshot)||hit;
    this.broadcast({type:'shot',id:p.id,gun:p.weapon.index,from:from.toArray(),to:ends[0],hit,...(dirs.length>1?{pellets:dirs.length,tos:ends.slice(0,tracerCount(gun))}:{})});
    return true;
  }
  reload(p){if(p.status!=='alive'||this.clock()<(p.melee?.nextAt||0)||this.isReviving(p))return false;const fraction=1-p.weapon.ammo/p.weapon.gun.capacity;if(!p.weapon.reload())return false;onReload(this,p,this.clock(),fraction);return true;}
  switchWeapon(p,index){if(p.status!=='alive'||this.isReviving(p)||!p.survival.owned.has(index))return false;p.weapon.select(index);return true;}
  pose(p,next,now,requestedCrouched=p.crouched){
    if(p.status!=='alive')return false;const old=vector(p.position),elapsed=Math.min(.3,Math.max(0,(now-p.lastPose)/1000)+.04),delta=next.clone().sub(old);p.lastPose=now;
    const requested=typeof requestedCrouched==='boolean'?requestedCrouched:!!p.crouched,forts=this.environment.movementColliders,crouched=requested||!requested&&!!p.crouched&&!!this.arena.canStand&&(!this.arena.canStand(old,forts)||!this.arena.canStand(next,forts));
    // Include standing travel since the last packet when entering crouch.
    const height=playerEyeHeight(crouched),offset=new T.Vector3(0,playerHeightOffset(crouched),0),oldEye=stanceEye(old,crouched),nextEye=stanceEye(next,crouched),bodyOffset=new T.Vector3(0,-height*.4,0),speed=(crouched&&p.crouched?5.2*PLAYER_CROUCH_SPEED:10)*this.movement(p);
    if(Math.hypot(delta.x,delta.z)>speed*elapsed+.15||Math.abs(delta.y)>12*elapsed+.3||next.distanceTo(this.spawn)>75||this.arena.blocked(oldEye.clone().add(bodyOffset),nextEye.clone().add(bodyOffset)))return false;
    let resolved=resolveFortificationMove(oldEye,nextEye,forts,PLAYER_RADIUS,height).add(offset);resolved.add(this.arena.resolve(resolved,crouched));resolved=resolveFortificationMove(oldEye,stanceEye(resolved,crouched),forts,PLAYER_RADIUS,height).add(offset);
    p.position=resolved.toArray();p.crouched=!!crouched;
    const floor=this.arena.floorAt(resolved.x,resolved.z,resolved.y+.5,PLAYER_EYE_HEIGHT+2);
    if(floor){const above=resolved.y-PLAYER_EYE_HEIGHT-floor.point.y;if(above>.15)p.fallPeak=Math.max(p.fallPeak??resolved.y,resolved.y);else if(p.fallPeak!==null&&p.fallPeak!==undefined){const drop=p.fallPeak-resolved.y;p.fallPeak=null;if(drop>=1.2)onLand(this,p,now,drop);}}
    return true;
  }
  interact(p,m,now=this.clock()){
    p.interactAt=now;p.interactTarget=typeof m.target==='string'?m.target:null;
    for(const v of this.players)if(v.revive?.by===p.id&&p.interactTarget&&p.interactTarget!==v.id)v.revive=null;
    if(!m.held){p.interactHeld=false;p.purchaseHeld=false;p.repairTime=0;p.reviveBlocked=false;p.perkRequireRelease=false;for(const v of this.players)if(v.revive?.by===p.id)v.revive=null;return;}
    p.interactHeld=true;
  }
  held(p,now){return p.interactHeld&&now-p.interactAt<350;}
  canRevive(p,v){return p.status==='alive'&&v.status==='downed'&&p!==v&&(!p.interactTarget||p.interactTarget===v.id)&&this.feet(p).distanceTo(this.feet(v))<=COOP_RULES.reviveRange&&!this.trace(this.feet(p).add(new T.Vector3(0,playerBodyHeight(.9,p.crouched),0)),this.feet(v).add(new T.Vector3(0,.6,0)));}
  target(p){
    const from=stanceEye(vector(p.position),p.crouched),look=new T.Vector3(-Math.sin(p.yaw)*Math.cos(p.pitch),Math.sin(p.pitch),-Math.cos(p.yaw)*Math.cos(p.pitch));let best=null,distance=3.8;
    for(const item of this.environment.interactions){
      if(!this.environment.unlockedZones.has(item.zone)||item.type==='gate'&&this.environment.unlockedZones.has(item.level??item.zone)||item.type==='window'&&!this.environment.activeWindows.includes(item.window||item))continue;
      if(p.interactTarget&&p.interactTarget!==item.id)continue;
      const to=(item.position||item.mesh.position).clone().add(new T.Vector3(0,1.7,0)),delta=to.clone().sub(from),d=delta.length();if(d>=distance||d<.01||delta.normalize().dot(look)<.25||this.trace(from,to,item.mesh))continue;best=item;distance=d;
    }return best;
  }
  purchase(p,item){
    if(p.status!=='alive')return {ok:false,cost:0,reason:'downed'};
    const rules=p.survival;rules.zones=new Set(this.environment.unlockedZones);let result;
    if(item.type==='gate'){result=rules.openZone(item.level??item.zone);if(result.ok){this.environment.openZone(item.level??item.zone);this.route();for(const member of this.players)member.survival.zones=new Set(this.environment.unlockedZones);}}
    else if(item.type==='weapon'){const index=item.gunIndex??item.weapon??item.index;result=rules.buyWeapon(index,item.zone,p.weapon.index);if(result.ok)this.configureWeapons(p,{refillIndex:index});}
    else if(item.type==='perk'){result=rules.buyPerk(item.perkId,item.zone);if(result.ok){this.configureWeapons(p);if(item.perkId==='juggernog')p.hp=this.maxHealth(p);}}
    else if(item.type==='pack'){result=rules.packWeapon(p.weapon.index,item.zone);if(result.ok)this.configureWeapons(p,{refillIndex:p.weapon.index});}
    if(result&&!result.ok)this.send(p,{type:'notice',message:result.reason==='insufficient-points'?'NEED '+result.cost+' POINTS':result.reason.replaceAll('-',' ').toUpperCase()});return result;
  }
  tickInteractions(dt,now){
    for(const v of this.players)if(v.revive){const p=this.players.find(p=>p.id===v.revive.by);if(!p||!this.held(p,now)||p.reviveBlocked||!this.canRevive(p,v))v.revive=null;}
    for(const p of this.players){
      if(!this.held(p,now)){p.repairTime=0;p.purchaseHeld=false;continue;}if(p.status!=='alive'||p.perkRequireRelease)continue;
      const target=this.players.filter(v=>this.canRevive(p,v)).sort((a,b)=>this.feet(a).distanceToSquared(this.feet(p))-this.feet(b).distanceToSquared(this.feet(p)))[0];
      for(const v of this.players)if(v.revive?.by===p.id&&v!==target)v.revive=null;
      if(target){if(p.reviveBlocked)continue;if(!target.revive)target.revive={by:p.id,progress:0,duration:racialReviveDuration(p.survival.perks.has('quick_revive')?COOP_RULES.quickRevive:COOP_RULES.revive,p.race)};if(target.revive.by===p.id){target.revive.progress+=dt;if(target.revive.progress>=target.revive.duration){this.revive(target,now);p.revives=(p.revives||0)+1;this.award(p,{type:'revive'});p.perkRequireRelease=true;}}continue;}
      if(interactPerks(this,p,now))continue;
      const item=this.target(p);if(p.focus!==item?.id){p.focus=item?.id;p.repairTime=0;}if(!item)continue;
      if(item.type==='window'){const window=item.window||item;if(window.boards<6){p.repairTime=(p.repairTime||0)+dt;if(p.repairTime>=.75){p.repairTime=0;this.environment.setBoards(window,window.boards+1);p.survival.repair(window.id);}}}
      else if(!p.purchaseHeld){p.purchaseHeld=true;this.purchase(p,item);}
    }
  }
  tick(now=this.clock()){
    if(!this.started||this.ended)return;const dt=Math.min(.2,Math.max(0,(now-this.lastTick)/1000));this.lastTick=now;
    for(const p of this.players){p.weapon.tick(Math.min(.2,Math.max(0,(now-p.lastTick)/1000)),p.status==='alive'&&p.aim,p.status==='alive'&&p.trigger);p.lastTick=now;if(p.status==='alive'&&now-p.lastHurt>racialRegenDelay(p.race)*1000)p.hp=Math.min(this.maxHealth(p),p.hp+racialRegenRate(p.race)*dt);if(p.status==='downed'&&now>=p.bleedoutAt){p.status='dead';p.revive=null;p.interactHeld=false;p.selfRecovery=null;this.broadcast({type:'notice',message:p.name+' BLED OUT / RETURNS NEXT WAVE'});}}
    tickPerks(this,dt,now);this.tickInteractions(dt,now);
    if(!this.players.some(p=>p.status==='alive'||p.status==='downed'&&p.selfRecovery&&p.selfRecovery.until>now)){this.ended=true;this.end('scourge');return;}
    if(this.countdown>0){this.countdown=Math.max(0,this.countdown-dt);if(this.countdown===0)this.beginWave();return;}
    this.units=this.units.filter(u=>u.alive||now-u.deadAt<3500);
    this.spawnDelay-=dt;if(this.queued>0&&this.spawnDelay<=0&&this.units.filter(u=>u.alive).length<Math.min(30,18+this.players.length*3)&&this.spawnUnit())this.spawnDelay=this.config.entryDelay;
    for(const u of this.units)this.tickUnit(u,dt,now);
    if(this.queued===0&&!this.units.some(u=>u.alive)){for(const p of this.players)if(p.status==='alive')this.award(p,{type:'wave'});this.wave++;this.countdown=8;for(const p of this.players)if(p.status==='dead')this.deploy(p,now);}
  }
  leave(id){for(const p of this.players)if(p.revive?.by===id)p.revive=null;this.stashes=this.stashes.filter(s=>s.owner!==id);}
  dispose(){if(this.disposed)return;this.disposed=true;this.environment.dispose();this.units=[];this.pickups=[];this.clouds=[];this.stashes=[];}
}

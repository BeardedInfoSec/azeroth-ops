// Server-side AI operators ("bots") for LAN rooms.
//
// A bot is an ordinary room member whose input comes from this module instead of a WebSocket. It never
// edits authoritative state directly: every decision becomes the same message a browser would send
// (pose / fire / reload / switch / melee / jump), which is then validated by server/multiplayer.mjs
// exactly like a human's (speed limits, collision, weapon timings, ammo, damage and hit regions).
// No wall hacks: enemies are only known through line of sight inside a vision cone, a short memory of
// where they were last seen, and team callouts of those same sightings. Aim is a finite-speed turn
// toward the target plus a difficulty-dependent error, spread and uncompensated recoil.
//
// The module is deliberately free of sockets and room bookkeeping: the director only needs the small
// context object documented at createBotDirector().
import * as T from 'three';
import {BotNav} from './bot-nav.mjs';
import {spreadDegrees,kickAfterShot,recoverKick} from '../src/engine/aim.mjs';
import {fireModeOf} from '../src/engine/firing-modes.mjs';
import {royaleState} from '../src/battle-royale-rules.mjs';
import {MELEE} from '../src/melee-rules.mjs';
import {classSpeed} from '../src/loadouts.mjs';
import {racialMovement,racialMaxHealth} from '../src/racial-traits.mjs';
import {PLAYER_EYE_HEIGHT,PLAYER_CROUCH_SPEED,playerBodyHeight} from '../src/player-config.js';
import {stanceEye} from '../src/engine/player-stance.js';

// ---------------------------------------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------------------------------------
/**
 * thinkMs        decision interval (perception, target choice, pathing); movement/aim/fire run every server tick
 * reactionMs     [min,max] delay between first seeing an enemy and being allowed to engage it
 * vision, fov    sight range (m) and half-angle (deg) of the forward cone; alertFov applies for a few seconds
 *                after taking damage or while engaged
 * memoryMs       how long a lost enemy stays "last seen"; calloutMs how stale a teammate's sighting must be
 *                before it is shared (radio delay)
 * aimDeg         base angular error (deg, standard deviation per axis); grows with distance and own movement
 * aimResampleMs  how often that error is redrawn (hand tremor / tracking noise)
 * turnDeg        maximum aim turn rate (deg/s)
 * recoilControl  fraction of per-shot view kick the bot cancels
 * fireTolDeg     how settled the aim must be before the trigger is pulled
 * burst          [min,max] rounds per burst for automatic guns, burstPauseMs the pause between bursts
 * rangeScale     scales the weapon's effective firing distance
 * headBias       chance to aim for the head rather than the chest
 * coverUse       chance to retreat to cover when hurt or reloading under fire
 */
export const DIFFICULTY=Object.freeze({
  easy:Object.freeze({thinkMs:200,reactionMs:[600,900],vision:50,fov:55,alertFov:90,memoryMs:3000,calloutMs:2000,aimDeg:1.6,aimResampleMs:420,turnDeg:140,recoilControl:.2,fireTolDeg:3.5,burst:[2,4],burstPauseMs:[650,1200],rangeScale:.75,headBias:0,coverUse:.25,retreatHp:.3,strafe:.6,crouchFight:.1}),
  normal:Object.freeze({thinkMs:150,reactionMs:[320,520],vision:70,fov:65,alertFov:100,memoryMs:5000,calloutMs:1000,aimDeg:.8,aimResampleMs:300,turnDeg:260,recoilControl:.55,fireTolDeg:2.4,burst:[3,6],burstPauseMs:[300,650],rangeScale:1,headBias:.15,coverUse:.6,retreatHp:.35,strafe:.9,crouchFight:.25}),
  hard:Object.freeze({thinkMs:100,reactionMs:[160,260],vision:95,fov:75,alertFov:110,memoryMs:8000,calloutMs:500,aimDeg:.38,aimResampleMs:230,turnDeg:520,recoilControl:.8,fireTolDeg:1.5,burst:[4,9],burstPauseMs:[120,350],rangeScale:1.15,headBias:.35,coverUse:.9,retreatHp:.4,strafe:1.1,crouchFight:.4}),
});
// Preferred engagement band and maximum firing distance (m) per weapon class.
export const WEAPON_BANDS=Object.freeze({
  ar:{min:6,max:40,fire:75},smg:{min:3,max:18,fire:38},lmg:{min:8,max:40,fire:70},
  shotgun:{min:2,max:9,fire:16},pistol:{min:4,max:16,fire:30},sniper:{min:25,max:70,fire:130},
});
export const bandFor=gun=>WEAPON_BANDS[gun?.bolt?'sniper':gun?.class]||WEAPON_BANDS.ar;
// Class presets for bots (indices into src/weapon-data.js GUNS). Weighted; snipers and the LMG are kept
// away from EASY bots. Every bot carries the Five-seven as a sidearm unless it is the primary.
const CLASS_TABLE=[
  {gun:0,weight:3,name:'Bot Assault'},{gun:1,weight:3,name:'Bot Assault'},{gun:6,weight:2,name:'Bot Rifleman'},{gun:7,weight:2,name:'Bot Burst'},
  {gun:4,weight:2,name:'Bot SMG'},{gun:5,weight:2,name:'Bot SMG'},{gun:9,weight:1,name:'Bot Breacher'},
  {gun:8,weight:1,name:'Bot Support',hard:true},{gun:2,weight:1,name:'Bot Marksman',hard:true},{gun:3,weight:1,name:'Bot Marksman',hard:true},{gun:11,weight:1,name:'Bot Marksman',hard:true},
];
export function botLoadout(random,difficulty='normal',clean){
  const table=CLASS_TABLE.filter(e=>!e.hard||difficulty!=='easy'),total=table.reduce((sum,e)=>sum+e.weight,0);
  let pick=random()*total,entry=table[0];for(const e of table){pick-=e.weight;if(pick<0){entry=e;break;}}
  const raw={version:2,name:entry.name,primary:entry.gun,secondary:entry.gun===10?0:10};
  try{const out=clean?clean(raw):raw;if(out&&Number.isInteger(out.primary)&&Number.isInteger(out.secondary))return out;}catch{}
  return clean?clean({primary:0,secondary:1}):raw;
}
export const difficultyOf=name=>DIFFICULTY[name]||DIFFICULTY.normal;

// ---------------------------------------------------------------------------------------------------------
// Small pure helpers (exported for tests)
// ---------------------------------------------------------------------------------------------------------
const RAD=Math.PI/180,TAU=Math.PI*2;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const angleDiff=(a,b)=>{let d=(a-b)%TAU;if(d>Math.PI)d-=TAU;if(d<-Math.PI)d+=TAU;return d;};
/** Deterministic generator for reproducible tests. */
export function mulberry32(seed){let a=seed>>>0;return ()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};}
export function gaussian(random){const u=Math.max(1e-9,random()),v=random();return Math.sqrt(-2*Math.log(u))*Math.cos(TAU*v);}
/** World look direction for a yaw/pitch pair (matches the camera used by the browser). */
export const lookDirection=(yaw,pitch)=>[-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch)];
export function anglesTo(dx,dy,dz){const length=Math.hypot(dx,dy,dz)||1;return {yaw:Math.atan2(-dx,-dz),pitch:Math.asin(clamp(dy/length,-1,1))};}
/** One redraw of the aim error in radians. The spread grows with range and with the bot's own movement. */
export function aimError(random,difficulty,distance,moving=false){
  const cfg=difficultyOf(difficulty),sigma=cfg.aimDeg*(1+Math.max(0,distance)/40)*(moving?1.35:1)*RAD;
  return {yaw:gaussian(random)*sigma,pitch:gaussian(random)*sigma};
}
export function reactionDelay(random,difficulty){const [lo,hi]=difficultyOf(difficulty).reactionMs;return lo+(hi-lo)*random();}
export const walkSpeed=c=>5.2*classSpeed(c.loadout)*racialMovement(c.race);

// Domination objective choice. points: [{id,x,z,radius,owner,progress,side,contested}] (the public snapshot
// shape); mates: [{id,goal,inside}]; threats: [{x,z}] known enemy positions; distance(point)->metres (Infinity if
// unreachable). Pure: higher value wins, so every term is easy to test.
export function chooseDominationGoal({team,self,points,mates=[],threats=[],distance,current=null}){
  let best=null,bestValue=-Infinity;
  for(const p of points){
    const d=distance(p);if(!Number.isFinite(d))continue;
    const mine=p.owner===team,enemyNear=threats.some(t=>Math.hypot(t.x-p.x,t.z-p.z)<p.radius+16),assigned=mates.filter(m=>m.id!==self&&m.goal===p.id),inside=assigned.filter(m=>m.inside).length;
    let value;
    if(mine&&p.progress>=1)value=enemyNear?105:(p.contested?105:20);
    else if(p.contested)value=115;
    else if(p.owner&&!mine)value=110;
    else value=p.progress>0&&p.side===team?95:100;
    // The last operator standing on a safe, owned point keeps guarding it while nobody else covers it.
    if(mine&&p.progress>=1&&!enemyNear&&assigned.length===0&&current===p.id)value+=65;
    value-=d*.9;
    value-=[0,10,40,70][Math.min(3,assigned.length)]+(inside>=3?60:0);
    if(current===p.id)value+=18;
    if(value>bestValue){bestValue=value;best=p.id;}
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------
// Director
// ---------------------------------------------------------------------------------------------------------
const feetOf=(c)=>new T.Vector3(c.position[0],c.position[1]-PLAYER_EYE_HEIGHT,c.position[2]);
const eyeOf=(c)=>stanceEye(new T.Vector3().fromArray(c.position),c.crouched);

/**
 * ctx: {
 *   arena,                 // {trace(from,to)->hit|null, blocked(a,b,pad), floorAt(x,z,top,max), nav?, spawns, origin}
 *   members(),             // every occupant of the room (humans and bots)
 *   mode(),                // 'tdm' | 'domination' | 'royale'
 *   domination(),          // public domination snapshot ({points:[...]}) or null
 *   royale(),              // {plan,startedAt} or null
 *   height(race),          // body height of a race (m)
 *   act(client,message),   // submits a message exactly as a socket would
 *   clock(), random(), difficulty(),
 *   budgetMs?              // soft per-tick CPU budget for decision steps (default 12 ms of the 50 ms tick)
 * }
 */
const NAVS=new WeakMap();
function navFor(arena){
  let nav=NAVS.get(arena);
  if(!nav){nav=arena.nav?BotNav.fromGroundNavigation(arena.nav):BotNav.fromPoints(arena.spawns,{blocked:(a,b)=>!!arena.blocked(a,b,0)});NAVS.set(arena,nav);}
  return nav;
}

export function createBotDirector(ctx){
  const {arena,clock=Date.now,random=Math.random}=ctx,stats={ticks:0,ms:0,maxMs:0,thinks:0,thinkMs:0,traces:0,deferred:0},budgetMs=ctx.budgetMs??12;
  const perf=ctx.perf||(()=>performance.now());
  let nav=ctx.nav||null;
  // One read-only graph per arena (shared by every room playing it).
  const getNav=()=>nav||=navFor(arena);
  const callouts={alliance:new Map(),horde:new Map()};
  const trace=(from,to)=>{stats.traces++;return arena.trace(from,to);};
  let roster=[],byId=new Map(),domSnap=null;

  const friendly=(a,b)=>ctx.mode()!=='royale'&&a.team===b.team;
  const alive=p=>p.hp>0&&p.deployment!=='aboard'&&p.deployment!=='gliding'&&p.deployment!=='eliminated';
  const sameDifficulty=()=>difficultyOf(ctx.difficulty());

  function newBrain(c){
    return {cfg:sameDifficulty(),spawn:c.spawnNumber,nextThink:0,contacts:new Map(),target:null,mode:'objective',goal:null,dest:null,waypoints:[],pathAt:-1e9,roamAt:-1e9,
      aimErr:{yaw:0,pitch:0,at:0},kick:0,burst:{left:0,pauseUntil:0},strafe:{dir:1,until:0},stuck:{pos:null,at:0,count:0,events:0},detour:null,
      alertUntil:0,hurtYaw:null,hurtAt:0,suspect:null,cover:null,lastCoverAt:-1e9,lastSeenAny:0,jumpAt:null,glide:null,lastSent:null,crouchFight:false,
      adsSince:0,idleLook:{yaw:c.yaw,until:0},lastUpdate:0,moveIntent:false,sprint:false};
  }
  function resetBrain(b,c,now,index,count){
    const cfg=sameDifficulty();Object.assign(b,{cfg,spawn:c.spawnNumber,nextThink:now+(count?index/count:0)*cfg.thinkMs,contacts:new Map(),target:null,mode:'objective',goal:null,dest:null,waypoints:[],pathAt:-1e9,roamAt:-1e9,
      kick:0,burst:{left:0,pauseUntil:0},detour:null,alertUntil:0,hurtYaw:null,suspect:null,cover:null,jumpAt:null,glide:null,lastSent:null,lastUpdate:now});
    b.stuck={pos:null,at:now,count:0,events:b.stuck?.events||0};b.aimErr={yaw:0,pitch:0,at:0};b.idleLook={yaw:c.yaw,until:0};
  }

  // ---- Perception: range, forward cone and line of sight -------------------------------------------------
  function senses(me,enemy,cfg,alert){
    const eye=eyeOf(me),feet=feetOf(enemy),body=playerBodyHeight(ctx.height(enemy.race)||1.85,enemy.crouched);
    const chest=new T.Vector3(feet.x,feet.y+body*.62,feet.z),dx=chest.x-eye.x,dy=chest.y-eye.y,dz=chest.z-eye.z,distance=Math.hypot(dx,dy,dz);
    if(distance>cfg.vision)return null;
    if(distance>1.5){
      const look=lookDirection(me.yaw,me.pitch),cos=(look[0]*dx+look[1]*dy+look[2]*dz)/distance;
      if(Math.acos(clamp(cos,-1,1))>(alert?cfg.alertFov:cfg.fov)*RAD)return null;
    }
    if(!trace(eye,chest))return {point:chest,distance,head:false};
    const head=new T.Vector3(feet.x,feet.y+body*.9,feet.z);
    if(!trace(eye,head))return {point:head,distance,head:true};
    return null;
  }

  // ---- Thinking (staggered, a few times per second) ---------------------------------------------------------
  function think(c,b,now){
    const t0=perf(),cfg=b.cfg,mode=ctx.mode(),alert=now<b.alertUntil||!!b.target;
    const enemies=roster.filter(p=>p!==c&&alive(p)&&!friendly(c,p)&&now>=(p.protectedUntil||0));
    // Update contacts from what is actually visible right now.
    for(const e of enemies){
      const s=senses(c,e,cfg,alert);let contact=b.contacts.get(e.id);
      if(s){
        if(!contact||now-contact.lastSeen>400){contact={id:e.id,firstSeen:now,react:reactionDelay(random,ctx.difficulty()),lastSeen:now,pos:feetOf(e),visible:true,head:s.head,distance:s.distance};b.contacts.set(e.id,contact);}
        Object.assign(contact,{lastSeen:now,pos:feetOf(e),visible:true,head:s.head,distance:s.distance});
        if(mode!=='royale'&&callouts[c.team])callouts[c.team].set(e.id,{pos:feetOf(e),at:now,by:c.id});
        b.lastSeenAny=now;
      }else if(contact)contact.visible=false;
    }
    for(const [id,contact] of b.contacts)if(now-contact.lastSeen>cfg.memoryMs||!byId.get(id)||!alive(byId.get(id)))b.contacts.delete(id);
    // Choose a target: nearest engaged contact, sticking with the current one unless another is clearly closer.
    const ready=[...b.contacts.values()].filter(k=>k.visible&&now-k.firstSeen>=k.react);
    let best=null;for(const k of ready)if(!best||k.distance<best.distance)best=k;
    const current=b.target?b.contacts.get(b.target):null;
    if(current&&current.visible&&best&&best.id!==current.id&&best.distance>current.distance*.7)best=current;
    if(best&&best.id!==b.target){b.target=best.id;b.burst={left:0,pauseUntil:now+120};b.aimErr.at=0;b.crouchFight=random()<cfg.crouchFight;b.aimHead=random()<cfg.headBias;}
    else if(!best){b.target=current&&current.visible?b.target:null;}
    // Team callouts: sightings by teammates become "suspected" positions after the radio delay.
    b.suspect=null;
    if(!b.target&&mode!=='royale'&&callouts[c.team]){
      for(const [id,call] of callouts[c.team]){
        const target=byId.get(id);if(!target||!alive(target)||now-call.at>cfg.memoryMs){callouts[c.team].delete(id);continue;}
        if(call.by!==c.id&&now-call.at>=cfg.calloutMs&&(!b.suspect||call.at>b.suspect.at))b.suspect=call;
      }
    }
    const lastSeen=[...b.contacts.values()].filter(k=>!k.visible).sort((x,y)=>y.lastSeen-x.lastSeen)[0];
    // Mode.
    const hurtBadly=c.hp<cfg.retreatHp*racialMaxHealth(100,c.race);
    if(b.target&&hurtBadly&&random()<cfg.coverUse&&now-b.lastCoverAt>2500){const spot=findCover(c,b,b.contacts.get(b.target));if(spot){b.cover={spot,until:now+4500};b.lastCoverAt=now;}}
    if(b.cover&&now>b.cover.until)b.cover=null;
    b.mode=b.cover?'cover':b.target?'engage':(lastSeen||b.suspect)?'search':'objective';
    // Maintenance away from the fight.
    if(!b.target&&now-b.lastSeenAny>1200){
      const w=c.weapon;
      if(w.index!==c.loadout.primary&&(w.inventory[c.loadout.primary]?.ammo>0||w.inventory[c.loadout.primary]?.reserve>0)){ctx.act(c,{type:'switch',gun:c.loadout.primary});}
      else if(w.ammo<w.gun.capacity*.5&&w.reserve>0&&w.reloadLeft<=0)ctx.act(c,{type:'reload'});
      else if(w.index!==c.loadout.primary&&(w.inventory[c.loadout.primary]?.ammo>0||w.inventory[c.loadout.primary]?.reserve>0))ctx.act(c,{type:'switch',gun:c.loadout.primary});
    }
    // Destination.
    let dest=null;
    if(b.mode==='cover')dest=b.cover.spot.clone();
    else if(b.mode==='engage'){const k=b.contacts.get(b.target);dest=k?k.pos.clone():null;}
    else if(b.mode==='search')dest=(lastSeen?lastSeen.pos:b.suspect.pos).clone();
    else dest=objective(c,b,now);
    if(dest){
      route(c,b,dest,now);
      // An unreachable roaming target is dropped so a new one is chosen next time.
      if(!b.waypoints.length&&b.mode==='objective'&&feetOf(c).distanceTo(dest)>3){b.dest=null;b.roamAt=-1e9;}
    }
    // Stuck detection: asked to move but barely moved for a second.
    const st=b.stuck;
    if(!st.pos||now-st.at>=1000){
      const moved=st.pos?feetOf(c).distanceTo(st.pos):99;
      if(st.pos&&b.moveIntent&&moved<.4){st.count++;st.events++;recoverStuck(c,b,now);}else if(moved>=.8)st.count=0;
      st.pos=feetOf(c);st.at=now;
    }
    stats.thinks++;stats.thinkMs+=perf()-t0;
  }

  // Cover: a nearby node the threat cannot see (tested with the same shot-blocking trace used for bullets).
  function findCover(c,b,threat){
    if(!threat)return null;const n=getNav(),from=feetOf(c),eye=threat.pos.clone().add(new T.Vector3(0,1.6,0)),start=n.nearest(from,12);
    if(!start)return null;let best=null,bestHops=Infinity;
    for(let i=0;i<8;i++){
      const node=n.randomNode(from,3,15,random);if(!node)continue;
      const hidden=!!trace(eye,node.point.clone().add(new T.Vector3(0,1.2,0)));if(!hidden)continue;
      const f=n.field(node.point),hops=f?f.distance[start.id]:-1;
      if(hops>=0&&hops<bestHops&&hops<=8){bestHops=hops;best=node.point;}
    }
    return best;
  }
  function recoverStuck(c,b,now){
    const st=b.stuck;
    if(st.count===1){b.detour={dir:random()<.5?1:-1,until:now+700};}
    else if(st.count===2){
      const n=getNav(),node=n.randomNode(feetOf(c),4,9,random);
      if(node){b.waypoints=[node.point.clone()];b.pathAt=now+900;}
    }else{b.goal=null;b.dest=null;b.waypoints=[];b.pathAt=-1e9;st.count=0;}
  }

  // Where to go when nothing is being fought.
  function objective(c,b,now){
    const mode=ctx.mode(),n=getNav(),me=feetOf(c);
    if(mode==='domination'){
      const snap=domSnap;
      if(snap?.points?.length){
        const mates=roster.filter(p=>p.bot&&p!==c&&friendly(c,p)&&alive(p)).map(p=>({id:p.id,goal:p.brain?.goal,inside:p.brain?.goal&&insidePoint(p,snap.points.find(x=>x.id===p.brain.goal))}));
        const threats=[...(callouts[c.team]?.values()||[])].filter(k=>now-k.at<5000).map(k=>({x:k.pos.x,z:k.pos.z}));
        const id=chooseDominationGoal({team:c.team,self:c.id,points:snap.points,mates,threats,current:b.goal,
          distance:p=>{const f=n.field(new T.Vector3(p.x,p.y,p.z));const hops=f?n.hops(me,f):-1;return hops<0?Infinity:hops*2.5;}});
        if(id){b.goal=id;const p=snap.points.find(x=>x.id===id);return new T.Vector3(p.x,p.y,p.z);}
      }
    }
    if(mode==='royale'){
      const r=ctx.royale();
      if(r){
        const elapsed=(clock()-r.startedAt)/1000,zone=royaleState(r.plan,elapsed).zone,safe=Math.max(2,(zone.timeToShrink<12||zone.shrinking?zone.nextRadius:zone.radius)-4),center=new T.Vector3(zone.center[0],me.y,zone.center[2]);
        b.sprint=Math.hypot(me.x-center.x,me.z-center.z)>safe*.9;
        if(Math.hypot(me.x-center.x,me.z-center.z)>safe*.85){const node=n.randomNode(center,0,safe*.6,random);return node?node.point.clone():center;}
        if(!b.dest||now-b.roamAt>8000||me.distanceTo(b.dest)<3){b.roamAt=now;const node=n.randomNode(center,0,Math.max(4,safe*.8),random);return node?node.point.clone():null;}
        return b.dest;
      }
    }
    // Team Deathmatch (and fallback): sweep towards recent callouts, otherwise roam.
    if(b.dest&&b.mode==='objective'&&me.distanceTo(b.dest)>3&&now-b.roamAt<9000)return b.dest;
    b.roamAt=now;const node=n.randomNode(me,18,70,random);return node?node.point.clone():null;
  }
  function insidePoint(p,point){return !!point&&Math.hypot(p.position[0]-point.x,p.position[2]-point.z)<=point.radius;}

  // Pathing: follow the distance field, then skip ahead to the farthest node that is in a clear straight line.
  function route(c,b,dest,now){
    const moved=!b.dest||b.dest.distanceTo(dest)>2.5;
    if(!moved&&b.waypoints.length&&now-b.pathAt<700)return;
    if(!moved&&now-b.pathAt<350)return;
    b.dest=dest.clone();b.pathAt=now;
    const n=getNav(),me=feetOf(c),from=n.nearest(me,15);if(!from){b.waypoints=[];return;}
    const field=n.field(dest);if(!field||field.distance[from.id]<0){b.waypoints=[];return;}
    const nodes=n.path(from,field,14);
    let k=Math.min(nodes.length,4)-1;
    const origin=me.clone().add(new T.Vector3(0,.9,0));
    while(k>0&&arena.blocked(origin,nodes[k].point.clone().add(new T.Vector3(0,.9,0)),.25))k--;
    b.waypoints=nodes.slice(Math.max(0,k)).map(x=>x.point.clone());
    // The last node is the goal node: finish on the exact destination.
    if(!nodes.length||field.distance[nodes.at(-1).id]===0)b.waypoints.push(dest.clone());
  }

  // ---- Per-tick control: movement, aim and trigger ------------------------------------------------------
  // Smooth, rate-limited turn toward `target` (radians). The result stays wrapped to (-pi, pi].
  function slew(current,target,maxStep,dt){
    const d=angleDiff(target,current),next=current+clamp(d*(1-Math.exp(-12*dt)),-maxStep,maxStep);
    return angleDiff(next,0);
  }
  function pickMove(c,b,now,target){
    const cfg=b.cfg,me=feetOf(c),base=walkSpeed(c);let dir=null,speed=0,crouch=false;
    const point=domSnap?.points?.find(p=>p.id===b.goal)||null;
    if(target){
      const to=target.pos.clone().sub(me);to.y=0;const dist=to.length()||1;to.divideScalar(dist);
      const band=bandFor(c.weapon.gun),perpendicular=new T.Vector3(-to.z,0,to.x),onPoint=!!point&&Math.hypot(me.x-point.x,me.z-point.z)<=point.radius;
      if(dist>band.max*1.15&&!onPoint){dir=followPath(c,b,me)||to;speed=base;}
      else if(dist<band.min&&band.min>4){dir=to.clone().multiplyScalar(-1);speed=base*.8;}
      else if(b.crouchFight&&dist>14){crouch=true;}
      else{
        if(now>=b.strafe.until)b.strafe={dir:random()<.5?1:-1,until:now+700+random()*1100};
        if(b.detour&&now<b.detour.until)b.strafe.dir=b.detour.dir;
        dir=perpendicular.clone().multiplyScalar(b.strafe.dir);
        // Domination: never wander off the point being held.
        if(point){const away=new T.Vector3(me.x-point.x,0,me.z-point.z);if(away.length()>point.radius-1.5)dir=away.negate().normalize();}
        speed=base*cfg.strafe*.7;
      }
    }else{
      dir=followPath(c,b,me);
      // Travelling bots sprint (the browser's 9 m/s); retreating to cover is a hurried walk.
      if(dir)speed=base*(b.mode==='cover'?1.15:9/5.2);
      if(dir&&b.detour&&now<b.detour.until){const side=new T.Vector3(-dir.z,0,dir.x).multiplyScalar(b.detour.dir*.9);dir=dir.clone().add(side).normalize();}
    }
    b.moveIntent=!!dir&&speed>0;
    return {dir,speed:crouch?base*PLAYER_CROUCH_SPEED:speed,crouch};
  }
  function followPath(c,b,me){
    while(b.waypoints.length){
      const w=b.waypoints[0],d=Math.hypot(w.x-me.x,w.z-me.z);
      if(d<(b.waypoints.length===1?.5:.8)){b.waypoints.shift();continue;}
      return new T.Vector3((w.x-me.x)/d,0,(w.z-me.z)/d);
    }
    return null;
  }
  function floorFor(c,x,z){
    const feetY=c.position[1]-PLAYER_EYE_HEIGHT,hit=arena.floorAt(x,z,feetY+1.1,3.2);
    if(!hit||Math.abs(hit.point.y-feetY)>.85||(hit.face?.normal&&hit.face.normal.y<.6))return null;
    return hit.point.y;
  }

  function control(c,b,now){
    const cfg=b.cfg,dt=clamp((now-(b.lastUpdate||now))/1000,0.001,.25);b.lastUpdate=now;
    const w=c.weapon,gun=w.gun,eye=eyeOf(c);
    // Refresh the engaged target through a real line-of-sight check; position is only updated while it is visible.
    let target=b.target?b.contacts.get(b.target):null;
    if(target){
      const enemy=byId.get(target.id);
      if(!enemy||!alive(enemy)){b.contacts.delete(target.id);b.target=null;target=null;}
      else{
        const feet=feetOf(enemy),body=playerBodyHeight(ctx.height(enemy.race)||1.85,enemy.crouched);
        // Aim for the head when this engagement rolled a headshot attempt (and it is exposed), otherwise the chest.
        const chest=new T.Vector3(feet.x,feet.y+body*.62,feet.z),head=new T.Vector3(feet.x,feet.y+body*.9,feet.z);
        const first=b.aimHead?head:chest,second=b.aimHead?chest:head;
        const point=!trace(eye,first)?first:!trace(eye,second)?second:null;
        if(point){target.pos=feet;target.lastSeen=now;target.visible=true;target.point=point;target.distance=eye.distanceTo(point);b.lastSeenAny=now;}
        else{target.visible=false;}
      }
    }
    const engaged=!!target&&target.visible&&now-target.firstSeen>=target.react;
    // Movement.
    const move=pickMove(c,b,now,engaged?target:null);
    const wantAds=engaged&&(gun.bolt||gun.class==='sniper'||(target.distance>22&&gun.class!=='shotgun'&&gun.class!=='pistol'&&gun.class!=='smg')||target.distance>38);
    if(wantAds&&!b.adsSince)b.adsSince=now;if(!wantAds)b.adsSince=0;
    let speed=move.speed;if(wantAds)speed=Math.min(speed,3*classSpeed(c.loadout)*racialMovement(c.race));
    let position=c.position,crouched=!!move.crouch;
    if(crouched&&!c.crouched)speed=0; // stance changes stand still for a tick, like a key press
    let moved=false;
    if(move.dir&&speed>.01){
      const step=speed*dt,nx=c.position[0]+move.dir.x*step,nz=c.position[2]+move.dir.z*step,y=floorFor(c,nx,nz);
      if(y!==null){position=[nx,y+PLAYER_EYE_HEIGHT,nz];moved=true;}
      else b.strafe.until=0;
      if(!moved&&b.mode==='engage')b.strafe.dir*=-1;
    }
    // Aim.
    let yaw=c.yaw,pitch=c.pitch,desired=null,settled=false;
    b.kick=recoverKick(b.kick,dt);
    if(engaged){
      const aimAt=target.point||target.pos.clone().add(new T.Vector3(0,1.2,0));
      if(now-b.aimErr.at>=cfg.aimResampleMs){b.aimErr={...aimError(random,ctx.difficulty(),target.distance,moved),at:now};}
      const dx=aimAt.x-eye.x,dy=aimAt.y-eye.y,dz=aimAt.z-eye.z,ideal=anglesTo(dx,dy,dz);
      desired={yaw:ideal.yaw+b.aimErr.yaw,pitch:ideal.pitch+b.aimErr.pitch-b.kick*(1-cfg.recoilControl)};
      const max=cfg.turnDeg*RAD*dt;
      yaw=slew(c.yaw,desired.yaw,max,dt);pitch=slew(c.pitch,desired.pitch,max*.8,dt);
      settled=Math.hypot(angleDiff(desired.yaw,yaw)*Math.cos(desired.pitch),desired.pitch-pitch)<=cfg.fireTolDeg*RAD;
    }else{
      // Look where we are going, toward a damage source or the last known position; otherwise scan gently.
      let want=null;
      if(b.hurtYaw!==null&&now-b.hurtAt<2500&&now-b.hurtAt>=cfg.reactionMs[0]*.6)want=b.hurtYaw;
      else if(move.dir)want=Math.atan2(-move.dir.x,-move.dir.z);
      else if(b.mode==='search'&&b.dest){want=Math.atan2(-(b.dest.x-c.position[0]),-(b.dest.z-c.position[2]));}
      else{if(now>=b.idleLook.until)b.idleLook={yaw:c.yaw+(random()-.5)*2.2,until:now+900+random()*1600};want=b.idleLook.yaw;}
      const max=cfg.turnDeg*.6*RAD*dt;
      yaw=slew(c.yaw,want,max,dt);pitch=slew(c.pitch,0,max*.5,dt);
    }
    // Send the pose (movement, facing, stance, aim and trigger flags) only when something changed.
    const wantTrigger=engaged&&settled&&shouldFire(c,b,target,now),last=b.lastSent;
    if(!last||moved||Math.abs(angleDiff(yaw,last.yaw))>.001||Math.abs(pitch-last.pitch)>.001||crouched!==last.crouched||wantAds!==last.aim||wantTrigger!==last.trigger){
      ctx.act(c,{type:'pose',position,yaw,pitch,crouched,aim:wantAds,trigger:wantTrigger});b.lastSent={yaw,pitch,crouched,aim:wantAds,trigger:wantTrigger};
    }
    // Weapon timeline: bots tick their own weapon in sub-steps so a 20 Hz server cannot slow a 15 rounds/s gun.
    weaponStep(c,b,now,engaged,wantTrigger,target);
  }

  // Burst control, friendly-in-line check, range and ADS gating.
  function shouldFire(c,b,target,now){
    const w=c.weapon,gun=w.gun,band=bandFor(gun);
    if(!target||!target.visible||now<b.burst.pauseUntil)return false;
    if(target.distance>band.fire*b.cfg.rangeScale)return false;
    if(c.deployment&&c.deployment!=='landed'&&ctx.mode()==='royale')return false;
    if(w.reloadLeft>0&&!w.canInterruptReload())return false;
    if(w.ammo<=0)return false;
    if((gun.bolt||gun.class==='sniper')&&w.ads<.85)return false;
    if(c.weapon.ads>0&&c.weapon.ads<.5&&b.adsSince&&now-b.adsSince<500)return false;
    // Do not shoot through a teammate standing in the line.
    if(ctx.mode()!=='royale'){
      // A teammate whose body the line passes through (0.55 m sideways, anywhere from feet to head) is in the way.
      const eye=eyeOf(c),end=target.point||target.pos,dx=end.x-eye.x,dz=end.z-eye.z,dy=end.y-eye.y,flat=Math.hypot(dx,dz)||1;
      for(const p of roster){
        if(p===c||p.hp<=0||p===byId.get(target.id)||p.team!==c.team)continue;
        const px=p.position[0]-eye.x,pz=p.position[2]-eye.z,along=(px*dx+pz*dz)/flat;
        if(along<=0||along>=flat)continue;
        const lateral=Math.abs(px*dz-pz*dx)/flat,lineY=eye.y+dy*along/flat,feetY=p.position[1]-PLAYER_EYE_HEIGHT,body=playerBodyHeight(ctx.height(p.race)||1.85,p.crouched);
        if(lateral<.55&&lineY>=feetY-.1&&lineY<=feetY+body+.1)return false;
      }
    }
    return true;
  }
  function weaponStep(c,b,now,engaged,wantTrigger,target){
    const w=c.weapon,cfg=b.cfg,mode=fireModeOf(w.gun);
    // Out of ammunition: sidearm, reload, or knife.
    if(engaged&&w.ammo<=0&&w.reloadLeft<=0){
      const other=[c.loadout.primary,c.loadout.secondary].find(i=>i!==w.index&&w.inventory[i]?.ammo>0);
      if(other!==undefined)ctx.act(c,{type:'switch',gun:other});
      else if(target.point&&target.distance<=MELEE.range+.6){ctx.act(c,{type:'melee',target:target.point.toArray()});}
      else if(w.reserve>0){ctx.act(c,{type:'reload'});if(random()<cfg.coverUse&&now-b.lastCoverAt>2500){const spot=findCover(c,b,target);if(spot){b.cover={spot,until:now+4000};b.lastCoverAt=now;}}}
      else if(target.distance<18){b.mode='engage';b.waypoints=[target.pos.clone()];}
    }
    // Close range with an unready or awkward weapon: use the knife.
    if(engaged&&target.point&&target.distance<=MELEE.range&&!w.inventory.some(s=>s.ammo>0))ctx.act(c,{type:'melee',target:target.point.toArray()});
    // Own the weapon timeline for this tick.
    let remaining=clamp((now-c.lastTick)/1000,0,.2);c.lastTick=now;
    let fired=0;
    if(wantTrigger&&engaged){
      const from=eyeOf(c).add(new T.Vector3(0,-.35,0));
      for(let guard=0;guard<8;guard++){
        const ready=w.ammo>0&&(w.reloadLeft<=0||w.canInterruptReload());
        if(!ready||w.cooldown>remaining+1e-9)break;
        const trig=mode==='auto'||w.burstLeft>0;
        const wait=w.cooldown;w.tick(wait,c.aim,trig);remaining-=wait;
        const before=w.ammo;
        const dist=clamp(target.distance,6,150),aimDir=lookDirection(c.yaw,c.pitch+b.kick*(1-cfg.recoilControl)),spread=spreadDegrees(w.gun,w.ads,moving(c,b))*RAD;
        const radius=Math.tan(spread)*Math.sqrt(random()),angle=random()*TAU;
        const dir=new T.Vector3(...aimDir);
        // Perturb inside the spread disc, perpendicular to the aim direction.
        const right=new T.Vector3(-dir.z,0,dir.x).normalize(),up=new T.Vector3().crossVectors(right,dir).normalize();
        dir.addScaledVector(right,Math.cos(angle)*radius).addScaledVector(up,Math.sin(angle)*radius).normalize();
        const aimPoint=from.clone().addScaledVector(dir,dist);
        ctx.act(c,{type:'fire',target:aimPoint.toArray()});
        if(w.ammo<before){
          fired++;b.kick=kickAfterShot(b.kick,w.gun);
          if(mode==='auto'||mode==='burst'){
            b.burst.left=(b.burst.left>0?b.burst.left:cfg.burst[0]+Math.floor(random()*(cfg.burst[1]-cfg.burst[0]+1)))-1;
            if(b.burst.left<=0){b.burst.pauseUntil=now+cfg.burstPauseMs[0]+random()*(cfg.burstPauseMs[1]-cfg.burstPauseMs[0]);b.burst.left=0;break;}
          }else{
            // Semi, pump and bolt guns: one press per round, then release.
            w.tick(0,c.aim,false);b.burst.pauseUntil=now+(mode==='bolt'?w.gun.cycle*1000:cfg.burstPauseMs[0]*.15);
          }
        }else break;
      }
    }
    w.tick(remaining,c.aim,c.trigger);
    return fired;
  }
  const moving=(c,b)=>b.moveIntent?walkSpeed(c):0;

  // ---- Battle Royale: ride the zeppelin, jump, glide to a chosen safe node -----------------------------------
  function royaleAir(c,b,now){
    const r=ctx.royale();if(!r)return;
    const elapsed=(now-r.startedAt)/1000;
    if(c.deployment==='aboard'){
      if(b.jumpAt===null||b.jumpAt===undefined){
        const n=getNav(),plan=r.plan,center=new T.Vector3(plan.center[0],0,plan.center[2]);
        // Half of the bots drop towards the middle (where the last circles end); the rest spread out.
        const node=n.randomNode(center,0,random()<.5?plan.initialRadius*.5:plan.initialRadius*.9,random);
        b.glide={goal:node?node.point.clone():center.clone()};
        b.jumpAt=1+random()*(plan.flight.duration-3);
      }
      if(elapsed>=b.jumpAt)ctx.act(c,{type:'jump'});
      return;
    }
    if(c.deployment==='gliding'&&b.glide){
      const gx=b.glide.goal.x-c.position[0],gz=b.glide.goal.z-c.position[2],d=Math.hypot(gx,gz);
      const dt=clamp((now-(c.lastPose||now))/1000,0,.3),step=Math.min(d,8.5*dt);
      const x=d>0.01?c.position[0]+gx/d*step:c.position[0],z=d>0.01?c.position[2]+gz/d*step:c.position[2];
      const yaw=d>0.5?Math.atan2(-gx,-gz):c.yaw;
      ctx.act(c,{type:'pose',position:[x,c.position[1],z],yaw,pitch:-.5});
    }
  }

  // ---- Entry points ---------------------------------------------------------------------------------------------
  function tick(now=clock()){
    const t0=perf();
    roster=ctx.members();byId=new Map(roster.map(p=>[p.id,p]));domSnap=ctx.mode()==='domination'?ctx.domination():null;
    const bots=roster.filter(p=>p.bot);
    bots.forEach((c,index)=>{
      const b=c.brain||(c.brain=newBrain(c));
      if(b.spawn!==c.spawnNumber||!b.lastUpdate)resetBrain(b,c,now,index,bots.length);
      if(c.hp<=0){c.trigger=false;c.aim=false;return;}
      if(ctx.mode()==='royale'&&c.deployment!=='landed'){royaleAir(c,b,now);return;}
      // Per-tick CPU budget: when a tick has already spent it, remaining bots postpone their (ray-casting) decision
      // step to the next tick. Movement, aim and fire are cheap and always run.
      if(now>=b.nextThink){
        if(perf()-t0<budgetMs){b.nextThink=now+b.cfg.thinkMs*(.85+.3*random());think(c,b,now);}else stats.deferred++;
      }
      control(c,b,now);
    });
    const spent=perf()-t0;stats.ticks++;stats.ms+=spent;stats.maxMs=Math.max(stats.maxMs,spent);
  }
  // A bot was damaged: it turns toward the source after a reaction delay (like a hit marker) and widens its view.
  function hurt(victim,killer,now=clock()){
    const b=victim.brain;if(!b||!killer)return;
    b.alertUntil=now+4000;b.hurtAt=now;
    b.hurtYaw=Math.atan2(-(killer.position[0]-victim.position[0]),-(killer.position[2]-victim.position[2]));
    b.strafe.until=0;
  }
  return {tick,hurt,stats,callouts,get nav(){return getNav();},reset(){callouts.alliance.clear();callouts.horde.clear();}};
}

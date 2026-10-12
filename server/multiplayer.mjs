import {WebSocketServer} from 'ws';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import * as T from 'three';
import {loadArena} from './world.mjs';
import {createRoyalePlan,royaleState,advanceGlide} from '../src/battle-royale-rules.mjs';
import {GUNS} from '../src/weapon-data.js';
import {WeaponSimulation,damageAt,hitRegion} from '../src/engine/weapon-simulation.mjs';
import {pelletDirections,tracerCount} from '../src/engine/firing-modes.mjs';
import {MELEE,tryMelee,selectMeleeTarget} from '../src/melee-rules.mjs';
import {Killstreaks} from '../src/streaks.mjs';
import {cleanLoadout,classWeapons,classSpeed,classRegen} from '../src/loadouts.mjs';
import {createProfileStore,publicProfile,validToken,hashToken} from './profiles.mjs';
import {createLedger,awardXp,breakdown,rankName,isUnlocked,unlockInfo,requiredLevel} from '../src/progression.mjs';
import {PLAYER_EYE_HEIGHT,PLAYER_CROUCH_SPEED,playerEyeHeight,playerBodyHeight} from '../src/player-config.js';
import {stanceEye} from '../src/engine/player-stance.js';
import {ZombieMatch} from './zombies.mjs';
import {racialWeapons,racialMaxHealth,racialMovement,racialRegenDelay,racialRegenRate} from '../src/racial-traits.mjs';
import {defaultLayout} from '../src/map-layout.mjs';
import {acceptCallsign,checkTag,uniqueName,defaultCallsign,formatName,NAME_CHANGE_COOLDOWN_MS} from '../src/names.mjs';
import {botsSupported,botAddProblem,balancedTeam,fillPlan,cleanBotSettings,defaultBotSettings,pickBotName,BOT_LIMITS,roomCapacity} from '../src/bot-rules.mjs';
import {createBotDirector,botLoadout} from './bots.mjs';
import {isCityId} from '../src/districts.mjs';
import {placeCapturePoints,createDominationState,presenceAt,stepDomination,dominationWinner,spawnObjectiveWeight,dominationSnapshot,dominationTargets,defaultTarget,isTeamMode} from '../src/domination-rules.mjs';
const RACES={alliance:['human','dwarf','nightelf','gnome','draenei'],horde:['orc','forsaken','tauren','troll','bloodelf']};
const HEIGHT={human:1.85,dwarf:1.45,nightelf:2.15,gnome:1.05,draenei:2.25,orc:2.05,forsaken:1.8,tauren:2.5,troll:2.25,bloodelf:1.9};
const vector=a=>new T.Vector3().fromArray(a),finite=a=>Array.isArray(a)&&a.length===3&&a.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<10000);
const other=t=>t==='alliance'?'horde':'alliance';
export function attachMultiplayer(server,{arenaLoader=loadArena,clock=Date.now,autoTick=true,zombieFactory=options=>new ZombieMatch(options),profiles=null,graceMs=60000}={}){
  const wss=new WebSocketServer({server,path:'/multiplayer',maxPayload:8192,perMessageDeflate:false}),rooms=new Map(),clients=new Map(),sessions=new Map();
  function send(c,m){if(c.ws.readyState!==1||c.ws.bufferedAmount>=256000)return false;c.ws.send(JSON.stringify(m));return true;}
  function correct(c){send(c,{type:'correct',position:c.position,crouched:!!c.crouched});}
  // Bots are room members without sockets: they live beside the connection table, never count against its 100 limit,
  // and are skipped by heartbeats, reconnect sessions and host selection (their fake socket is never OPEN).
  const botClients=new Map(),who=id=>clients.get(id)||botClients.get(id);
  function all(room,m){for(const id of room.members){const c=who(id);if(c)send(c,m);}}
  function members(room){return room.members.map(who).filter(Boolean);}
  function recovery(p){return p.selfRecovery?{left:Math.max(0,p.selfRecovery.until-clock())/1000,hold:p.selfRecovery.hold||0,required:p.selfRecovery.required}:null;}
  function publicPlayer(p){const zombies=roomOf(p)?.zombies;return {deployment:p.deployment||'landed',id:p.id,name:p.name,tag:p.tag||'',bot:!!p.bot,team:p.team,race:p.race,ready:p.ready,loaded:p.loaded,loadProgress:p.loaded?1:p.loadProgress||0,loadStage:p.loaded?'Ready':p.loadStage||'Waiting for map',loadout:p.loadout,pending:p.pending,position:p.position,crouched:!!p.crouched,yaw:p.yaw,pitch:p.pitch,gun:p.weapon.index,hp:p.hp,maxHealth:zombies&&p.survival?zombies.maxHealth(p):racialMaxHealth(100,p.race),kills:p.kills,deaths:p.deaths,revives:p.revives||0,spawn:p.spawnNumber,shield:Math.max(0,p.protectedUntil-clock())/1000,respawn:Math.max(0,p.respawnAt-clock())/1000,status:zombies?p.status||'dead':p.hp>0?'alive':'dead',bleedout:Math.max(0,(p.bleedoutAt||0)-clock())/1000,revive:p.revive||null,selfRecovery:recovery(p),survival:zombies?.playerSnapshot(p)||null};}
  function snapshot(room){const now=clock();return {serverNow:now,startsAt:room.startsAt||0,layoutRevision:room.layoutRevision||null,loadGeneration:room.loadGeneration||0,...(!room.arena?{layout:null}:{}),mode:room.mode,zombies:room.zombies?.snapshot()||null,domination:room.domination?dominationSnapshot(room.domination):null,royale:room.mode==='royale'&&room.royale?{...royaleState(room.royale.plan,(now-room.royale.startedAt)/1000),phase:room.phase==='ended'?'ended':royaleState(room.royale.plan,(now-room.royale.startedAt)/1000).phase,alive:members(room).filter(p=>p.hp>0).length,winnerId:room.royale.winnerId||null,winnerName:room.royale.winnerName||null}:null,bots:room.bots?{...room.bots,supported:botsSupported(room.mode),count:members(room).filter(p=>p.bot).length}:null,code:room.code,host:room.host,city:room.city,target:room.target,duration:room.duration,phase:room.phase,score:room.score,winner:room.winner,remaining:Math.max(0,(room.endsAt-now)/1000),countdown:Math.max(0,(room.startsAt-now)/1000),players:members(room).map(publicPlayer),sentries:room.sentries.map(s=>({id:s.id,team:s.team,position:s.position}))};}
  function sendRoom(c,room,base,forceLayout=false){const key=room.code+':'+room.layoutRevision,include=!!room.arena&&(c.layoutSentRevision!==key||forceLayout),packet=include?{...base,layout:room.layout}:base;if(send(c,{type:'room',room:packet})&&include)c.layoutSentRevision=key;}
  function publish(room){const base=snapshot(room);for(const c of members(room))sendRoom(c,room,base);}
  function list(c){send(c,{type:'rooms',rooms:[...rooms.values()].filter(r=>r.phase==='waiting').map(r=>({code:r.code,city:r.city,mode:r.mode,count:r.members.length,host:clients.get(r.host)?.name}))});}
  function lists(){for(const c of clients.values())if(!c.room)list(c);}
  function reject(c,message){send(c,{type:'error',message});}
  // ---- Reconnect sessions, profiles and XP (logic lives in profiles.mjs / progression.mjs) ----
  let store=profiles;const getStore=()=>store||=createProfileStore();
  const HOLD_PHASES=['loading','countdown','playing','ended'];
  function award(p,event){if(p?.ledger)p.ledger=awardXp(p.ledger,event).ledger;}
  function sendProfile(c){if(c.profile)send(c,{type:'profile',profile:publicProfile(c.profile)});}
  function drop(c){leave(c);clients.delete(c.id);if(c.sessionId&&sessions.get(c.sessionId)===c)sessions.delete(c.sessionId);}
  function hold(c,room){
    c.dropped=true;c.dropUntil=clock()+graceMs;c.trigger=c.aim=false;c.weapon.releaseTrigger();
    if(room.host===c.id){const next=members(room).find(p=>!p.dropped&&p.ws.readyState===1);if(next){room.host=next.id;all(room,{type:'notice',message:next.name+' is now lobby leader.'});}}
    publish(room);
  }
  function disconnected(c){const room=roomOf(c);if(c.sessionId&&room&&HOLD_PHASES.includes(room.phase))hold(c,room);else drop(c);}
  function resume(fresh,held){
    held.ws=fresh.ws;held.dropped=false;held.dropUntil=0;held.alive=true;held.rate=0;held.layoutSentRevision=null;
    clients.delete(fresh.id);fresh.replacedBy=held;
    send(held,{type:'welcome',id:held.id,resumed:true});sendProfile(held);
    const room=roomOf(held);
    if(room){send(held,{type:'notice',message:'Reconnected to your match.'});publish(room);personal(held);if(held.xpSummary)send(held,held.xpSummary);}else list(held);
  }
  function hello(c,m){
    if(!validToken(m.token))return reject(c,'Invalid session token');
    const id=hashToken(m.token);
    if(c.sessionId)return c.sessionId===id?undefined:reject(c,'Session already established');
    const held=sessions.get(id);
    if(held){if(!held.dropped)return reject(c,'This session is already connected from another window');return resume(c,held);}
    c.sessionId=id;sessions.set(id,c);c.profile=getStore().resolve(m.token);if(!c.nameSet&&!roomOf(c)){c.baseName=c.profile.callsign;c.tag=c.profile.tag||'';c.name=c.baseName;}sendProfile(c);
  }
  function profileMeta(c,m){
    if(!c.profile)return;
    if(m.title!==undefined||m.emblem!==undefined||m.camo!==undefined){if(!getStore().setCosmetics(c.profile,m))reject(c,'Some cosmetics are still locked');sendProfile(c);}
  }
  function profileLoadout(c,m){
    const slot='slot:'+(m.slot+1);
    if(c.profile&&Number.isInteger(m.slot)&&!isUnlocked(c.profile,slot))return reject(c,'Class '+(m.slot+1)+' unlocks at level '+requiredLevel(slot));
    const violations=[];c.pending=cleanLoadout(m.loadout,c.profile,violations);
    if(violations.length)reject(c,'Locked until you level up: '+[...new Set(violations)].map(id=>(unlockInfo(id)?.name||id)+' (LVL '+requiredLevel(id)+')').join(', '));
  }
  function finishXp(room,winner){
    for(const p of members(room)){
      if(!p.ledger)continue;
      award(p,{type:'matchComplete'});
      const won=room.mode==='royale'?winner===p.id:room.mode!=='zombies'&&winner===p.team;
      if(won)award(p,{type:'win'});
      if(!p.profile)continue;
      const counts=p.ledger.counts,result=getStore().applyMatch(p.profile,p.ledger.total,{kills:Math.max(0,p.kills-(p.botKills||0)),deaths:p.deaths,headshots:(counts.headshot||0)+(counts.zombieHeadshot||0),captures:counts.capture||0,waves:counts.wave||0,wins:won?1:0,matches:1},{botXp:p.ledger.botXp||0});
      p.xpSummary={type:'xp',xp:p.ledger.total-(result.botXpCut||0),breakdown:breakdown(p.ledger),capped:p.ledger.capped>0,won,...result,rank:rankName(result.levelAfter),unlockedItems:result.unlocked.map(id=>({id,...unlockInfo(id)})),profile:publicProfile(p.profile)};
      send(p,p.xpSummary);
    }
  }
  function roomOf(c){return rooms.get(c.room);}
  function end(room,winner){if(room.phase!=='playing')return;room.phase='ended';room.winner=winner;room.sentries=[];finishXp(room,winner);publish(room);}
  function resetWaiting(room){room.zombies?.dispose();room.zombies=null;room.phase='waiting';room.loadGeneration=(room.loadGeneration||0)+1;room.arena=null;room.layout=null;room.layoutRevision=null;room.loadDeadline=0;room.startsAt=0;room.endsAt=0;room.sentries=[];room.royale=null;room.domination=null;room.director=null;for(const p of members(room)){p.ready=!!p.bot;p.loaded=!!p.bot;p.loadProgress=p.bot?1:0;p.loadStage=p.bot?'Ready':'Waiting for map';p.hp=0;p.crouched=false;p.deployment='landed';p.survival=null;p.status='dead';p.revive=p.selfRecovery=null;p.bleedoutAt=0;}}
  function royaleWinner(room){
    if(room.mode!=='royale'||room.phase!=='playing'||!room.royale)return;
    const alive=members(room).filter(p=>p.hp>0&&p.deployment!=='eliminated');
    if(alive.length>1)return;
    room.royale.winnerId=alive[0]?.id||null;room.royale.winnerName=alive[0]?formatName(alive[0]):null;
    end(room,alive[0]?.id||'draw');
  }
  function leave(c){
    const room=roomOf(c);c.room=null;if(!room)return;
    room.members=room.members.filter(id=>id!==c.id);room.sentries=room.sentries.filter(s=>s.owner!==c.id);
    c.name=c.baseName||c.name;room.zombies?.leave(c.id);
    if(!members(room).some(p=>!p.bot))clearBots(room);
    if(!room.members.length){room.zombies?.dispose();rooms.delete(room.code);}
    else{
      if(room.host===c.id){room.host=members(room).find(p=>p.ws.readyState===1)?.id||room.members[0];all(room,{type:'notice',message:(clients.get(room.host)?.name||'A squad member')+' is now lobby leader.'});}
      const insufficient=room.mode==='zombies'?false:room.mode==='royale'?room.members.length<2:!members(room).some(p=>p.team==='alliance')||!members(room).some(p=>p.team==='horde');
      if(['loading','countdown'].includes(room.phase)&&insufficient)resetWaiting(room);
      if(room.bots?.fill&&room.phase==='waiting')rebalanceBots(room);
      if(room.mode==='royale')royaleWinner(room);
      else if(isTeamMode(room.mode)&&room.phase==='playing'&&!members(room).some(p=>p.team===c.team))end(room,other(c.team));
      publish(room);
    }
    send(c,{type:'left'});lists();
  }
  // ---- Callsigns: src/names.mjs holds the rules, this is the authoritative enforcement ----
  const roomNames=(room,except)=>room?members(room).filter(p=>p!==except).map(p=>p.name):[];
  const shownName=(c,room=roomOf(c))=>uniqueName(c.baseName,roomNames(room,c));
  function callsignReply(c,extra={}){send(c,{type:'callsign',name:c.name,baseName:c.baseName,tag:c.tag||'',...extra});}
  function identity(c,m){
    if(m.name===undefined&&m.tag===undefined)return;
    const first=!c.nameSet;let name=c.baseName,tag=c.tag||'',notice=null,problem=null;
    if(m.name!==undefined){
      const r=acceptCallsign(m.name);
      if(r.ok){name=r.name;notice=r.replaced?r.notice:null;}
      else if(first){const saved=c.profile?.callsign;name=saved&&saved!=='Operator'?saved:defaultCallsign();problem=r.reason;notice='Callsign rejected: '+r.reason+'. '+(name===saved?'Your saved callsign was kept.':'A default callsign was assigned.');}
      else problem=r.reason;
    }
    if(m.tag!==undefined){const t=checkTag(m.tag);if(t.ok)tag=t.tag;else problem=problem||t.reason;}
    if(name===c.baseName&&tag===(c.tag||'')){c.nameSet=true;if(problem||notice)callsignReply(c,{ok:!problem,reason:problem,notice});return;}
    const room=roomOf(c);
    if(room&&!['waiting','ended'].includes(room.phase))return callsignReply(c,{ok:false,reason:'Callsign changes are locked during a match'});
    if(c.nameSet){
      const wait=(c.nameChangedAt||0)+NAME_CHANGE_COOLDOWN_MS-clock();
      if(wait>0)return callsignReply(c,{ok:false,reason:'Wait '+Math.ceil(wait/1000)+' s before changing your callsign again'});
      c.nameChangedAt=clock();
    }
    c.baseName=name;c.tag=tag;c.nameSet=true;c.name=shownName(c,room);
    if(c.profile){getStore().setCallsign(c.profile,name,tag);sendProfile(c);}
    callsignReply(c,{ok:!problem,reason:problem,notice});
  }
  // ---- Bots: server-run operators that occupy normal slots (AI lives in server/bots.mjs) ----
  const BOT_SOCKET=Object.freeze({readyState:3,bufferedAmount:0,send(){},ping(){},terminate(){},close(){}});
  const botList=room=>members(room).filter(p=>p.bot);
  const botRows=room=>members(room).map(p=>({id:p.id,team:p.team,bot:!!p.bot}));
  function addBot(room,team){
    const id='bot-'+randomBytes(4).toString('hex'),name=pickBotName(members(room).map(p=>p.name)),loadout=botLoadout(Math.random,room.bots.difficulty,cleanLoadout);
    const c={id,bot:true,ws:BOT_SOCKET,name,baseName:name,tag:'',nameSet:true,nameChangedAt:0,team,race:RACES[team][Math.floor(Math.random()*RACES[team].length)],ready:true,loaded:true,loadProgress:1,loadStage:'Ready',room:room.code,loadout,pending:loadout,position:[0,0,0],crouched:false,yaw:0,pitch:0,hp:0,kills:0,deaths:0,botKills:0,spawnNumber:0,protectedUntil:0,respawnAt:0,weapon:new WeaponSimulation(GUNS),streak:new Killstreaks(),uavUntil:0,lastTick:clock(),rate:0,rateAt:clock(),alive:true,deployment:'landed',status:'dead',ledger:null};
    c.weapon.select(loadout.primary);botClients.set(id,c);room.members.push(id);return c;
  }
  function removeBot(room,bot){botClients.delete(bot.id);room.members=room.members.filter(id=>id!==bot.id);room.sentries=room.sentries.filter(s=>s.owner!==bot.id);}
  function clearBots(room){for(const bot of botList(room))removeBot(room,bot);}
  // Fill mode keeps the lobby at the host's occupant target: bots are added or trimmed, humans never are.
  function rebalanceBots(room){
    if(!room.bots||!room.bots.fill||room.phase!=='waiting')return false;
    const plan=fillPlan({mode:room.mode,players:botRows(room),target:room.bots.target});let changed=false;
    for(const id of plan.remove){const bot=botClients.get(id);if(bot){removeBot(room,bot);changed=true;}}
    for(const team of plan.add){addBot(room,team);changed=true;}
    return changed;
  }
  // A joining human may take a seat from a bot (preferring a bot of the faction they want) when the lobby or faction is full.
  function makeSeat(room,c){
    const factionFull=isTeamMode(room.mode)&&members(room).filter(p=>p.team===c.team).length>=5;
    if(factionFull){const b=botList(room).find(p=>p.team===c.team);if(b)removeBot(room,b);}
    if(room.members.length>=roomCapacity(room.mode)){const b=botList(room).find(p=>p.team===c.team)||botList(room).at(-1);if(b)removeBot(room,b);}
    return room.members.length<roomCapacity(room.mode);
  }
  function botCommand(c,room,m){
    const rows=botRows(room);
    if(m.type==='bot-add'){
      const team=m.team===undefined?balancedTeam(room.mode,rows):m.team;
      if(typeof team!=='string')return reject(c,'Choose Alliance or Horde');
      const problem=botAddProblem(room.mode,rows,team);if(problem)return reject(c,problem);
      addBot(room,team);if(room.bots.fill)room.bots.target=Math.max(BOT_LIMITS.minOccupants,room.members.length);
    }else if(m.type==='bot-remove'){
      const bot=typeof m.id==='string'?botClients.get(m.id):null;
      if(!bot||bot.room!==room.code)return reject(c,'No such bot in this lobby');
      removeBot(room,bot);if(room.bots.fill)room.bots.target=Math.max(BOT_LIMITS.minOccupants,room.members.length);
    }else{
      const result=cleanBotSettings(m,room.bots);if(!result.ok)return reject(c,result.reason);
      if(m.fill===true&&!botsSupported(room.mode))return reject(c,'Bots are not available in this mode');
      Object.assign(room.bots,result.settings);
    }
    rebalanceBots(room);publish(room);lists();
  }
  function profile(c,m){profileMeta(c,m);identity(c,m);if(m.loadout)profileLoadout(c,m);const room=roomOf(c);if(room&&room.phase!=='waiting'){return;}if(RACES[m.team]){if(room&&isTeamMode(room.mode)){const mates=members(room).filter(p=>p.id!==c.id&&p.team===m.team);if(mates.length>=5&&mates.some(p=>p.bot))removeBot(room,mates.find(p=>p.bot));}if(!room||!isTeamMode(room.mode)||members(room).filter(p=>p.id!==c.id&&p.team===m.team).length<5)c.team=m.team;}
    if(RACES[c.team].includes(m.race))c.race=m.race;else if(!RACES[c.team].includes(c.race))c.race=RACES[c.team][0];c.loadout=c.pending;c.ready=false;if(room?.bots?.fill)rebalanceBots(room);
  }
  function applyClass(c){c.loadout=c.pending;c.weapon=new WeaponSimulation(racialWeapons(classWeapons(GUNS,c.loadout),c.race));c.weapon.select(c.loadout.primary);c.weapon.releaseTrigger();c.lastTick=clock();c.melee={};}
  function spawn(c,room){const state=room.domination,point=room.arena.spawn(members(room).filter(p=>p!==c),c.team,c.lastSpawn,state?(p=>spawnObjectiveWeight(p,state,c.team)):null);if(!point){c.respawnAt=clock()+500;return false;}applyClass(c);c.hp=racialMaxHealth(100,c.race);c.position=point;c.crouched=false;c.lastSpawn=point;c.spawnNumber++;c.respawnAt=0;c.protectedUntil=clock()+2000;c.lastPose=clock();c.lastRegenTick=clock();c.yaw=room.arena.spawnYaw?.(point)??Math.atan2(-(room.arena.origin.x-point[0]),-(room.arena.origin.z-point[2]));c.pitch=0;c.aim=false;c.trigger=false;c.lastHurt=0;return true;}
  function personal(c){if(c.bot)return;const room=roomOf(c);send(c,{type:'self',gun:c.weapon.index,ammo:c.weapon.ammo,reserve:c.weapon.reserve,inventory:c.weapon.inventory,reloadLeft:c.weapon.reloadLeft,cooldown:c.weapon.cooldown,meleeLeft:Math.max(0,(c.melee?.nextAt||0)-clock())/1000,streak:c.streak.kills,rewards:c.streak.ready,uav:Math.max(0,c.uavUntil-clock())/1000,...(room?.zombies?{survival:room.zombies.playerSnapshot(c),status:c.status,bleedout:Math.max(0,(c.bleedoutAt||0)-clock())/1000,revive:c.revive||null,selfRecovery:recovery(c)}:{})});}
  function hurt(room,victim,amount,killer=null,credit=true,meta=null){
    if(room.mode==='zombies')return false;
    const royale=room.mode==='royale';
    if(victim.hp<=0||(!royale&&victim.team===killer?.team)||clock()<victim.protectedUntil||room.phase!=='playing')return false;
    if(royale&&killer&&victim.deployment==='aboard')return false;
    victim.hp=Math.max(0,victim.hp-amount);victim.lastHurt=clock();if(victim.bot)room.director?.hurt(victim,killer,clock());
    if(victim.hp===0){
      victim.deaths++;victim.streak.death();victim.uavUntil=0;victim.trigger=false;victim.aim=false;victim.crouched=false;
      room.sentries=room.sentries.filter(s=>s.owner!==victim.id);
      victim.respawnAt=royale?0:clock()+3000;if(royale)victim.deployment='eliminated';
      if(killer){killer.kills++;if(killer!==victim)award(killer,{type:'kill',victimId:victim.id,headshot:!!meta?.headshot,knife:!!meta?.knife,bot:!!victim.bot});if(victim.bot&&killer!==victim)killer.botKills=(killer.botKills||0)+1;if(credit&&!royale&&!killer.bot){const rewards=killer.streak.kill();for(const r of rewards)send(killer,{type:'notice',message:r.name+' READY / '+r.key});}}
      if(!royale&&killer&&room.mode!=='domination')room.score[killer.team]++;
      all(room,{type:'elimination',killer:killer?formatName(killer):'The storm',victim:formatName(victim),team:killer?.team||null});
      if(!royale&&killer&&room.mode!=='domination'&&room.score[killer.team]>=room.target)end(room,killer.team);
    }
    return true;
  }
  function safeLanding(room,position,exclude){
    const center=room.royale.plan.center,radius=room.royale.plan.initialRadius;
    const ground=room.arena.spawns.filter(p=>Math.hypot(p.x-center[0],p.z-center[2])<=radius);
    const occupied=members(room).filter(p=>p!==exclude&&p.hp>0&&p.deployment==='landed');
    const clear=ground.filter(p=>occupied.every(a=>Math.hypot(p.x-a.position[0],p.z-a.position[2])>=1.5));
    return (clear.length?clear:ground).reduce((best,p)=>!best||Math.hypot(p.x-position[0],p.z-position[2])<Math.hypot(best.x-position[0],best.z-position[2])?p:best,null);
  }
  function beginRoyale(room,now){
    const origin=room.arena.origin.clone();origin.y-=PLAYER_EYE_HEIGHT;
    room.royale={plan:createRoyalePlan(room.arena.spawns,origin),startedAt:now,lastTick:now,winnerId:null,winnerName:null};
    const flight=royaleState(room.royale.plan,0).flight;
    for(const c of members(room)){applyClass(c);c.hp=racialMaxHealth(100,c.race);c.position=flight.position.slice();c.crouched=false;c.spawnNumber++;c.deployment='aboard';c.protectedUntil=0;c.respawnAt=0;c.lastPose=now;c.lastHurt=now;c.yaw=-Math.PI/2;c.pitch=0;c.aim=c.trigger=false;}
  }
  function prepareCountdown(room,now){
    room.startsAt=now+3000;
    if(room.mode==='royale')beginRoyale(room,room.startsAt);
    else if(room.mode==='zombies')room.zombies.prepare(now);
    else{if(room.mode==='domination')room.domination=createDominationState(placeCapturePoints(room.arena.coreSpawns||room.arena.spawns));for(const p of members(room))if(!spawn(p,room))throw new Error('No safe deployment for every player. Adjust the layout or retry.');}
    room.phase='countdown';
    // Everyone receives the same authoritative positions before the countdown.
    // Inputs remain ignored until the server changes phase to playing.
    for(const p of members(room)){p.aim=p.trigger=false;p.weapon.releaseTrigger();personal(p);}
  }
  const currentLoad=(room,m)=>!!room.arena&&!!room.layoutRevision&&m.code===room.code&&m.loadGeneration===room.loadGeneration&&m.layoutRevision===room.layoutRevision;
  function jump(c,room){if(room.mode!=='royale'||c.hp<=0||c.deployment!=='aboard')return;c.deployment='gliding';c.crouched=false;c.lastPose=clock();c.aim=c.trigger=false;correct(c);}
  function tickRoyale(room,now){
    const r=room.royale,dt=Math.min(.25,Math.max(0,(now-r.lastTick)/1000));r.lastTick=now;
    const state=royaleState(r.plan,(now-r.startedAt)/1000);
    for(const c of members(room)){
      if(c.hp<=0)continue;
      if(c.deployment==='aboard'){c.position=state.flight.position.slice();if(state.elapsed>=state.flight.duration)jump(c,room);}
      if(c.deployment==='gliding'){
        const ground=safeLanding(room,c.position,c);
        if(ground){const step=advanceGlide(c.position,ground,dt);c.position=step.position;if(step.landed){c.deployment='landed';c.lastPose=now;correct(c);}}
      }
      if(state.elapsed>=state.flight.duration&&(state.zone.radius<=0||Math.hypot(c.position[0]-state.zone.center[0],c.position[2]-state.zone.center[2])>state.zone.radius))hurt(room,c,state.zone.damage*dt);
      advance(c,now);personal(c);
    }
    royaleWinner(room);
  }
  function advance(c,now){c.weapon.tick(Math.min(.2,(now-c.lastTick)/1000),c.aim,c.trigger);c.lastTick=now;}
  function shoot(c,m,room){if(c.hp<=0||clock()<(c.melee?.nextAt||0)||(room.mode==='royale'&&c.deployment!=='landed')||!finite(m.target))return;advance(c,clock());if(room.mode==='zombies'){room.zombies.shoot(c,m.target);personal(c);return;}if(!c.weapon.fire({trustCooldown:true}))return;c.protectedUntil=0;
    const from=stanceEye(vector(c.position),c.crouched).add(new T.Vector3(0,-.35,0)),direction=vector(m.target).sub(from);if(direction.length()<.001)return;direction.normalize();
    // One authoritative ray per pellet (count comes from the weapon data, capped), damage summed per victim.
    const gun=c.weapon.gun,dirs=pelletDirections(gun,direction.toArray(),{ads:c.weapon.ads}),struck=new Map(),ends=[];
    for(const d of dirs){
      const ray=new T.Ray(from,vector(d)),far=ray.at(300,new T.Vector3()),wall=room.arena.trace(from,far);let distance=wall?from.distanceTo(wall.point):300,point=wall?.point||far,victim=null;
      for(const p of members(room)){if(p===c||p.hp<=0)continue;const feet=vector(p.position).add(new T.Vector3(0,-PLAYER_EYE_HEIGHT,0));const box=new T.Box3(feet.clone().add(new T.Vector3(-.34,0,-.34)),feet.clone().add(new T.Vector3(.34,playerBodyHeight(HEIGHT[p.race],p.crouched),.34))),hit=ray.intersectBox(box,new T.Vector3());if(hit&&from.distanceTo(hit)<distance){distance=from.distanceTo(hit);point=hit;victim=p;}}
      ends.push(point.toArray());
      if(victim){const region=hitRegion((point.y-(victim.position[1]-PLAYER_EYE_HEIGHT))/playerBodyHeight(HEIGHT[victim.race],victim.crouched)),entry=struck.get(victim)||{damage:0,headshot:false};entry.damage+=damageAt(gun,distance,region);entry.headshot||=region==='locHead';struck.set(victim,entry);}
    }
    let hit=false;for(const [victim,entry] of struck)hit=hurt(room,victim,entry.damage,c,true,{headshot:entry.headshot})||hit;
    all(room,{type:'shot',id:c.id,gun:c.weapon.index,from:from.toArray(),to:ends[0],hit,...(dirs.length>1?{pellets:dirs.length,tos:ends.slice(0,tracerCount(gun))}:{}),...(gun.quiet?{quiet:true}:{})});personal(c);if(room.mode==='royale')royaleWinner(room);
  }
  function streak(c,m,room){if(!isTeamMode(room.mode)||c.hp<=0||!c.streak.ready[m.id])return;if(m.id==='sentry'){if(room.sentries.some(s=>s.owner===c.id))return reject(c,'Your sentry is already deployed');const at=stanceEye(vector(c.position),c.crouched).add(new T.Vector3(-Math.sin(c.yaw)*1.8,0,-Math.cos(c.yaw)*1.8)),ground=room.arena.floorAt(at.x,at.z,at.y,4);if(!ground||room.arena.trace(stanceEye(vector(c.position),c.crouched),ground.point.clone().add(new T.Vector3(0,1.2,0))))return reject(c,'No clear sentry placement');room.sentries.push({id:randomUUID(),owner:c.id,team:c.team,position:ground.point.toArray(),expires:clock()+25000,next:0});}c.streak.consume(m.id);if(m.id==='uav')c.uavUntil=clock()+30000;if(m.id==='supply'){c.hp=racialMaxHealth(100,c.race);c.weapon.refill();}personal(c);}
  function melee(c,m,room){
    if(c.hp<=0||!finite(m.target)||(room.mode==='royale'&&c.deployment!=='landed'))return;
    const from=stanceEye(vector(c.position),c.crouched).add(new T.Vector3(0,-.35,0)),direction=vector(m.target).sub(from);if(direction.lengthSq()<1e-8)return;
    advance(c,clock());
    if(room.mode==='zombies'){room.zombies.melee(c,m.target);personal(c);return;}
    if(!tryMelee(c.weapon,c.melee??={},clock()))return;c.protectedUntil=0;
    const contact=selectMeleeTarget({origin:from.toArray(),direction:direction.toArray(),candidates:members(room).filter(p=>p!==c&&p.hp>0&&p.deployment!=='aboard').map(p=>({id:p.id,position:[p.position[0],p.position[1]-PLAYER_EYE_HEIGHT,p.position[2]],height:playerBodyHeight(HEIGHT[p.race],p.crouched),player:p})),blocked:(a,b)=>!!room.arena.trace(vector(a),vector(b))});
    const hit=!!contact&&hurt(room,contact.candidate.player,MELEE.playerDamage,c,true,{knife:true});
    all(room,{type:'melee',id:c.id,from:from.toArray(),to:contact?.point||from.addScaledVector(direction.normalize(),MELEE.range).toArray(),hit,killed:!!hit&&contact.candidate.player.hp===0});personal(c);if(room.mode==='royale')royaleWinner(room);
  }
  async function message(c,m){
    if(!m||typeof m.type!=='string')return;let room=roomOf(c);
    if(m.type==='hello')return hello(c,m);
    if(m.type==='list')return list(c);
    if(m.type==='leave')return leave(c);
    if(m.type==='profile'){profile(c,m);if(room)publish(room);return;}
    if(m.type==='create'){
      if(c.room)return reject(c,'Leave your current lobby first');if(rooms.size>=20)return reject(c,'Server lobby limit reached');let code;do{code=randomBytes(3).toString('hex').toUpperCase();}while(rooms.has(code));
      const mode=['royale','zombies','domination'].includes(m.mode)?m.mode:'tdm';room={mode,bots:defaultBotSettings(),director:null,domination:null,royale:null,zombies:null,code,host:c.id,members:[c.id],city:'stormwind',target:defaultTarget(mode),duration:600,phase:'waiting',score:{alliance:0,horde:0},winner:null,sentries:[],endsAt:0,startsAt:0};rooms.set(code,room);c.room=code;c.ready=false;c.name=shownName(c,room);publish(room);lists();return;
    }
    if(m.type==='join'){
      if(c.room)return reject(c,'Leave your current lobby first');room=rooms.get(String(m.code).toUpperCase());if(!room||room.phase!=='waiting'||!makeSeat(room,c))return reject(c,'Lobby is unavailable or full');if(isTeamMode(room.mode)&&members(room).filter(p=>p.team===c.team).length>=5){c.team=other(c.team);c.race=RACES[c.team][0];}room.members.push(c.id);c.room=room.code;c.ready=false;c.name=shownName(c,room);rebalanceBots(room);publish(room);lists();return;
    }
    if(!room)return reject(c,'Join a lobby first');
    if(m.type==='transfer-host'){
      if(room.host!==c.id)return reject(c,'Only the lobby leader can transfer leadership');
      const target=clients.get(m.targetId);if(!target||target.id===c.id||target.room!==room.code||!room.members.includes(target.id)||target.ws.readyState!==1)return reject(c,'Choose another connected player in this lobby');
      room.host=target.id;all(room,{type:'notice',message:target.name+' is now lobby leader.'});publish(room);lists();return;
    }
    if(m.type==='bot-add'||m.type==='bot-remove'||m.type==='bot-settings'){
      if(room.host!==c.id)return reject(c,'Only the lobby leader can manage bots');
      if(room.phase!=='waiting')return reject(c,'Bots can only be changed in the lobby');
      return botCommand(c,room,m);
    }
    if(m.type==='settings'&&room.phase==='waiting'&&room.host===c.id){if(['tdm','royale','zombies','domination'].includes(m.mode)){const humans=members(room).filter(p=>!p.bot);if(isTeamMode(m.mode)&&['alliance','horde'].some(t=>humans.filter(p=>p.team===t).length>5))return reject(c,'Team modes allow five players per faction');if(m.mode==='zombies'&&humans.length>4)return reject(c,'Undead co-op allows four survivors');if(!botsSupported(m.mode))clearBots(room);else if(isTeamMode(m.mode))for(const t of ['alliance','horde'])for(const b of botList(room).filter(p=>p.team===t).slice(0,Math.max(0,members(room).filter(p=>p.team===t).length-5)))removeBot(room,b);room.mode=m.mode;}if(isCityId(m.city))room.city=m.city;if(dominationTargets(room.mode).includes(m.target))room.target=m.target;else if(!dominationTargets(room.mode).includes(room.target))room.target=defaultTarget(room.mode);if([300,600,900].includes(m.duration))room.duration=m.duration;for(const p of members(room))p.ready=!!p.bot;rebalanceBots(room);publish(room);lists();return;}
    if(m.type==='ready'&&room.phase==='waiting'){c.ready=!!m.ready;publish(room);return;}
    if(m.type==='start'&&room.phase==='waiting'&&room.host===c.id){
      const players=members(room),enough=room.mode==='zombies'?players.length>=1&&players.length<=4:players.length>=2;
      if(!enough||!players.every(p=>p.ready)||(isTeamMode(room.mode)&&(!players.some(p=>p.team==='alliance')||!players.some(p=>p.team==='horde'))))return reject(c,room.mode==='zombies'?'Need one to four survivors and every player ready':room.mode==='royale'?'Need at least two players and every player ready':'Need two teams and every player ready');
      room.phase='loading';const generation=room.loadGeneration=(room.loadGeneration||0)+1;room.arena=null;room.layout=null;room.layoutRevision=null;room.nextLayoutSync=0;room.loadDeadline=clock()+120000;room.score={alliance:0,horde:0};room.winner=null;
      for(const p of players){p.loaded=!!p.bot;p.loadProgress=p.bot?1:0;p.loadStage=p.bot?'Ready':'Waiting for host map';p.nextProgressAt=0;p.hp=0;p.crouched=false;p.kills=p.deaths=p.botKills=0;p.ledger=p.bot?null:createLedger();p.xpSummary=null;p.domAcc=0;p.streak.reset();p.uavUntil=0;p.lastSpawn=null;p.survival=null;p.status='dead';p.revive=p.selfRecovery=null;p.bleedoutAt=0;}publish(room);lists();
      try{const arena=await arenaLoader(room.city);if(rooms.get(room.code)===room&&room.phase==='loading'&&room.loadGeneration===generation){room.arena=arena;room.layout=arena.layout??defaultLayout(room.city);room.layoutRevision=generation+':'+createHash('sha256').update(JSON.stringify(room.layout)).digest('hex').slice(0,20);room.nextLayoutSync=clock()+1000;if(room.mode==='zombies')room.zombies=zombieFactory({award,arena,city:room.city,players:()=>members(room),clock,send,broadcast:m=>all(room,m),end:winner=>end(room,winner)});publish(room);}}
      catch(e){if(rooms.get(room.code)!==room||room.phase!=='loading'||room.loadGeneration!==generation)return;resetWaiting(room);all(room,{type:'error',message:'Map failed to load: '+e.message});publish(room);lists();}return;
    }
    if(m.type==='load-progress'&&room.phase==='loading'){
      if(!currentLoad(room,m)||c.loaded||!Number.isFinite(m.progress)||clock()<(c.nextProgressAt||0))return;
      c.loadProgress=Math.max(0,Math.min(1,m.progress));c.loadStage=typeof m.stage==='string'?m.stage.replace(/[\x00-\x1f]/g,' ').slice(0,64):'Loading map';c.nextProgressAt=clock()+250;publish(room);return;
    }
    if(m.type==='loaded'&&room.phase==='loading'){if(!currentLoad(room,m)||c.loaded)return;c.loaded=true;c.loadProgress=1;c.loadStage='Ready';publish(room);return;}
    if(m.type==='return'&&room.phase==='ended'&&room.host===c.id){resetWaiting(room);if(room.bots?.fill){clearBots(room);rebalanceBots(room);}publish(room);lists();return;}
    if(room.phase!=='playing')return;
    if(m.type==='melee')return melee(c,m,room);
    if(room.mode==='zombies'){
      if(m.type==='interact'){room.zombies.interact(c,m);return;}
      if(m.type==='pose'){
        if(c.status!=='alive'||!finite(m.position)||!Number.isFinite(m.yaw)||!Number.isFinite(m.pitch))return;
        if(!room.zombies.pose(c,vector(m.position),clock(),m.crouched)||typeof m.crouched==='boolean'&&m.crouched!==c.crouched)correct(c);
        c.yaw=m.yaw;c.pitch=Math.max(-1.45,Math.min(1.45,m.pitch));c.aim=!!m.aim;c.trigger=!!m.trigger;if(!c.trigger)c.weapon.releaseTrigger();return;
      }
      if(m.type==='fire')return shoot(c,m,room);
      if(m.type==='reload'){advance(c,clock());room.zombies.reload(c);personal(c);return;}
      if(m.type==='switch'){room.zombies.switchWeapon(c,m.gun);personal(c);return;}
      return;
    }
    if(m.type==='jump')return jump(c,room);
    if(m.type==='pose'&&room.mode==='royale'&&c.hp>0&&c.deployment!=='landed'){
      if(c.deployment==='gliding'&&finite(m.position)&&Number.isFinite(m.yaw)&&Number.isFinite(m.pitch)){
        const now=clock(),dt=Math.min(.3,Math.max(0,(now-c.lastPose)/1000)),d=Math.hypot(m.position[0]-c.position[0],m.position[2]-c.position[2]),plan=room.royale.plan;c.lastPose=now;
        if(d<=10*dt+1e-6&&Math.hypot(m.position[0]-plan.center[0],m.position[2]-plan.center[2])<=plan.initialRadius+5){c.position[0]=m.position[0];c.position[2]=m.position[2];}else correct(c);
        c.yaw=m.yaw;c.pitch=Math.max(-1.45,Math.min(1.45,m.pitch));
      }return;
    }
    if(m.type==='pose'&&c.hp>0&&finite(m.position)&&Number.isFinite(m.yaw)&&Number.isFinite(m.pitch)){
      const now=clock(),elapsed=Math.min(.3,Math.max(0,(now-c.lastPose)/1000)+.04),next=vector(m.position),old=vector(c.position),d=next.clone().sub(old),horizontal=Math.hypot(d.x,d.z);c.lastPose=now;
      const requested=typeof m.crouched==='boolean'?m.crouched:!!c.crouched,deniedStand=!requested&&!!c.crouched&&room.arena.canStand&&(!room.arena.canStand(old)||!room.arena.canStand(next)),crouched=requested||!!deniedStand;
      // A stance-change packet also contains movement made in the previous stance.
      const speed=(crouched&&c.crouched?5.2*PLAYER_CROUCH_SPEED:10)*classSpeed(c.loadout)*racialMovement(c.race),bodyOffset=new T.Vector3(0,-playerEyeHeight(crouched)*.4,0);
      if(horizontal<=speed*elapsed+.15&&Math.abs(d.y)<=12*elapsed+.3&&next.distanceTo(room.arena.origin)<75&&!room.arena.blocked(stanceEye(old,crouched).add(bodyOffset),stanceEye(next,crouched).add(bodyOffset))){next.add(room.arena.resolve(next,crouched));c.position=next.toArray();c.crouched=crouched;if(deniedStand)correct(c);}else correct(c);
      c.yaw=m.yaw;c.pitch=Math.max(-1.45,Math.min(1.45,m.pitch));c.aim=!!m.aim;c.trigger=!!m.trigger;if(!c.trigger)c.weapon.releaseTrigger();return;
    }
    if(m.type==='fire')return shoot(c,m,room);
    if(m.type==='reload'&&c.hp>0&&clock()>=(c.melee?.nextAt||0)&&(room.mode!=='royale'||c.deployment==='landed')){advance(c,clock());c.weapon.reload();personal(c);return;}
    if(m.type==='switch'&&c.hp>0&&(room.mode!=='royale'||c.deployment==='landed')&&[c.loadout.primary,c.loadout.secondary].includes(m.gun)){c.weapon.select(m.gun);personal(c);return;}
    if(m.type==='streak')return streak(c,m,room);
  }
  wss.on('connection',(ws,req)=>{
    if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host){ws.close(1008);return;}}catch{ws.close(1008);return;}}
    if(clients.size>=100){ws.close(1013);return;}const c={id:randomUUID(),ws,name:'Operator',baseName:'Operator',tag:'',nameSet:false,nameChangedAt:0,team:'alliance',race:'human',ready:false,loaded:false,room:null,loadout:cleanLoadout(),pending:cleanLoadout(),position:[0,0,0],crouched:false,yaw:0,pitch:0,hp:0,kills:0,deaths:0,spawnNumber:0,protectedUntil:0,respawnAt:0,weapon:new WeaponSimulation(GUNS),streak:new Killstreaks(),uavUntil:0,lastTick:clock(),rate:0,rateAt:clock(),alive:true};clients.set(c.id,c);send(c,{type:'welcome',id:c.id});list(c);
    const me=()=>c.replacedBy||c;ws.on('pong',()=>{me().alive=true;});ws.on('error',()=>{});ws.on('message',raw=>{const c=me();if(clock()-c.rateAt>1000){c.rateAt=clock();c.rate=0;}if(++c.rate>100){ws.close(1008,'Too many requests');return;}try{Promise.resolve(message(c,JSON.parse(raw))).catch(e=>{console.error(e);reject(c,'Request failed');});}catch{reject(c,'Invalid message');}});ws.on('close',()=>{const c=me();if(c.ws!==ws||c.dropped)return;disconnected(c);});
  });
  function dominationXp(d,mine,events,dt){
    for(const e of events)if(e.type==='capture')for(const {p,i} of mine)if(i>=0&&d.points[i].id===e.point&&p.team===e.team)award(p,{type:'capture'});
    for(const {p,i} of mine){const pt=d.points[i];if(!pt)continue;if(pt.owner===p.team||Math.sign(pt.control)===(p.team==='alliance'?1:-1)){p.domAcc=(p.domAcc||0)+dt;if(p.domAcc>=5){p.domAcc-=5;award(p,{type:'domTick'});}}}
  }
  function tickDomination(room,now){
    const d=room.domination;if(!d||room.phase!=='playing')return;
    const dt=Math.min(.25,Math.max(0,(now-(d.lastTick??now))/1000));d.lastTick=now;
    const live=members(room).filter(p=>p.hp>0).map(p=>({team:p.team,x:p.position[0],y:p.position[1]-PLAYER_EYE_HEIGHT,z:p.position[2]}));
    const mine=members(room).filter(p=>p.hp>0).map(p=>({p,i:presenceAt(d.points,[{team:p.team,x:p.position[0],y:p.position[1]-PLAYER_EYE_HEIGHT,z:p.position[2]}]).findIndex(x=>x[p.team]>0)}));
    const events=stepDomination(d,presenceAt(d.points,live),dt,room.score);
    for(const e of events)if(e.type==='capture'||e.type==='neutralize')all(room,{type:'notice',message:'POINT '+e.point+(e.type==='capture'?' CAPTURED BY '+e.team.toUpperCase():' NEUTRALIZED')});
    dominationXp(d,mine,events,dt);
    const winner=dominationWinner(room.score,room.target,now>=room.endsAt);if(winner)end(room,winner);
  }
  function runBots(room,now){
    if(!room.arena||!botList(room).length)return;
    room.director||=createBotDirector({arena:room.arena,clock,members:()=>members(room),mode:()=>room.mode,domination:()=>room.domination?dominationSnapshot(room.domination):null,royale:()=>room.royale,height:race=>HEIGHT[race],difficulty:()=>room.bots.difficulty,
      act:(bot,m)=>{try{Promise.resolve(message(bot,m)).catch(e=>console.error('bot action failed',e));}catch(e){console.error('bot action failed',e);}}});
    // A fault in the AI must never take the LAN server down: after three failures the room's bots simply stop acting.
    try{room.director.tick(now);}catch(e){console.error('bot AI failed',e);room.botFaults=(room.botFaults||0)+1;if(room.botFaults>=3)room.director={tick(){},hurt(){}};}
  }
  function tick(){const now=clock();
    for(const c of [...clients.values()])if(c.dropped){const room=roomOf(c);if(now>=c.dropUntil||!room||!HOLD_PHASES.includes(room.phase))drop(c);}
    for(const room of rooms.values()){
    if(room.phase==='loading'){if(room.arena&&members(room).every(p=>p.loaded)){try{prepareCountdown(room,now);publish(room);}catch(error){resetWaiting(room);all(room,{type:'error',message:'Deployment failed: '+error.message});publish(room);lists();}}else if(now>room.loadDeadline){resetWaiting(room);all(room,{type:'error',message:'Map loading timed out. Ready up to retry.'});publish(room);lists();}else if(room.arena&&now>=room.nextLayoutSync){room.nextLayoutSync=now+1000;const base=snapshot(room);for(const c of members(room))if(!c.loaded)sendRoom(c,room,base,true);}continue;}
    if(room.phase==='countdown'&&now>=room.startsAt){room.phase='playing';room.endsAt=room.startsAt+room.duration*1000;if(room.mode==='zombies'){room.endsAt=0;room.zombies.start(now);}for(const p of members(room)){p.lastPose=p.lastTick=p.lastRegenTick=now;p.aim=p.trigger=false;p.weapon.releaseTrigger();if(room.mode!=='royale')p.protectedUntil=now+2000;}if(room.domination)room.domination.lastTick=now;}
    if(room.phase==='playing'&&room.mode!=='zombies')runBots(room,now);
    if(room.phase==='playing'&&room.mode==='royale')tickRoyale(room,now);
    if(room.phase==='playing'&&room.mode==='zombies'){room.zombies.tick(now);for(const c of members(room))personal(c);}
    if(room.phase==='playing'&&isTeamMode(room.mode)){
      for(const c of members(room)){const dt=Math.max(0,Math.min(.2,(now-(c.lastRegenTick??now))/1000));c.lastRegenTick=now;advance(c,now);if(c.hp<=0&&now>=c.respawnAt)spawn(c,room);const max=racialMaxHealth(100,c.race);if(c.hp>0&&c.hp<max&&now-c.lastHurt>racialRegenDelay(c.race)*1000)c.hp=Math.min(max,c.hp+racialRegenRate(c.race)*(room.mode==='royale'?1:classRegen(c.loadout))*dt);personal(c);}
      room.sentries=room.sentries.filter(s=>s.expires>now);for(const s of room.sentries){const owner=clients.get(s.owner);if(!owner||s.next>now)continue;const from=vector(s.position).add(new T.Vector3(0,1.15,0));const targets=members(room).filter(p=>p.hp>0&&p.team!==s.team).sort((a,b)=>vector(a.position).distanceTo(from)-vector(b.position).distanceTo(from));for(const p of targets){const to=vector(p.position).add(new T.Vector3(0,playerBodyHeight(HEIGHT[p.race],p.crouched)*.65-PLAYER_EYE_HEIGHT,0));if(to.distanceTo(from)<40&&!room.arena.trace(from,to)){s.next=now+200;hurt(room,p,32,owner,false);all(room,{type:'shot',id:s.id,from:from.toArray(),to:to.toArray(),hit:false});break;}}}
      if(room.mode==='domination')tickDomination(room,now);
      else if(now>=room.endsAt)end(room,room.score.alliance===room.score.horde?'draw':room.score.alliance>room.score.horde?'alliance':'horde');
    }
    if(['playing','countdown'].includes(room.phase))publish(room);
  }}
  const timer=autoTick?setInterval(tick,50):null;timer?.unref();
  const heartbeat=setInterval(()=>{for(const c of clients.values()){if(c.dropped)continue;if(!c.alive)c.ws.terminate();else{c.alive=false;c.ws.ping();}}},15000);heartbeat.unref();
  return {rooms,clients,sessions,bots:botClients,tick,close(){store?.close?.();clearInterval(timer);clearInterval(heartbeat);for(const room of rooms.values())room.zombies?.dispose();for(const c of clients.values())c.ws.terminate();wss.close();}};
}

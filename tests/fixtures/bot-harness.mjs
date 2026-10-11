// Minimal stand-in for the room/server around createBotDirector() so the AI core can be unit-tested without
// sockets. `act` applies the same pose rules the server enforces (speed envelope, blocked path, capsule push)
// and records every other message. Weapons are the real WeaponSimulation.
import * as T from 'three';
import {createBotDirector,mulberry32} from '../../server/bots.mjs';
import {WeaponSimulation} from '../../src/engine/weapon-simulation.mjs';
import {GUNS} from '../../src/weapon-data.js';
import {classWeapons,cleanLoadout,classSpeed} from '../../src/loadouts.mjs';
import {racialWeapons,racialMovement} from '../../src/racial-traits.mjs';
import {PLAYER_EYE_HEIGHT,playerEyeHeight} from '../../src/player-config.js';
import {stanceEye} from '../../src/engine/player-stance.js';

export const HEIGHTS={human:1.85,dwarf:1.45,nightelf:2.15,gnome:1.05,draenei:2.25,orc:2.05,forsaken:1.8,tauren:2.5,troll:2.25,bloodelf:1.9};
export function makeClient({id,team='alliance',race=team==='alliance'?'human':'orc',at=[0,0],yaw=0,primary=0,secondary=10,bot=true,now=0,hp=100}){
  const loadout=cleanLoadout({version:2,name:'Test',primary,secondary}),weapon=new WeaponSimulation(racialWeapons(classWeapons(GUNS,loadout),race));
  weapon.select(primary);weapon.releaseTrigger();
  return {id,bot,team,race,loadout,weapon,position:[at[0],PLAYER_EYE_HEIGHT,at[1]],yaw,pitch:0,crouched:false,hp,protectedUntil:0,deployment:'landed',spawnNumber:1,aim:false,trigger:false,melee:{},lastTick:now,lastPose:now,kills:0,deaths:0};
}
export function makeHarness({arena,mode='tdm',difficulty='normal',seed=7,clients=[],domination=null,royale=null,start=100000}){
  let now=start;const rng=mulberry32(seed),log=[],stats={poses:0,rejected:0};
  const roster=clients;
  const act=(c,m)=>{
    log.push({t:now,id:c.id,m});
    if(m.type==='pose'){
      stats.poses++;
      const elapsed=Math.min(.3,Math.max(0,(now-c.lastPose)/1000)+.04),old=new T.Vector3().fromArray(c.position),next=new T.Vector3().fromArray(m.position);
      const crouched=!!m.crouched,speed=(crouched&&c.crouched?5.2*.5:10)*classSpeed(c.loadout)*racialMovement(c.race),off=new T.Vector3(0,-playerEyeHeight(crouched)*.4,0);
      c.lastPose=now;
      const ok=Math.hypot(next.x-old.x,next.z-old.z)<=speed*elapsed+.15&&Math.abs(next.y-old.y)<=12*elapsed+.3&&!arena.blocked(stanceEye(old,crouched).add(off),stanceEye(next,crouched).add(off))&&(!harness.gate||harness.gate(old,next,c));
      if(ok){next.add(arena.resolve(next,crouched));c.position=next.toArray();c.crouched=crouched;}else stats.rejected++;
      c.yaw=m.yaw;c.pitch=Math.max(-1.45,Math.min(1.45,m.pitch));c.aim=!!m.aim;c.trigger=!!m.trigger;if(!c.trigger)c.weapon.releaseTrigger();
    }else if(m.type==='fire'){
      const elapsed=Math.min(.2,(now-c.lastTick)/1000);c.weapon.tick(elapsed,c.aim,c.trigger);c.lastTick=now;
      const before=c.weapon.ammo,ok=c.weapon.fire({trustCooldown:true});
      if(!ok)stats.badFire=(stats.badFire||0)+1;else c.protectedUntil=0;
    }else if(m.type==='reload'){c.weapon.tick(Math.min(.2,(now-c.lastTick)/1000),c.aim,c.trigger);c.lastTick=now;c.weapon.reload();}
    else if(m.type==='switch'){if([c.loadout.primary,c.loadout.secondary].includes(m.gun))c.weapon.select(m.gun);}
    else if(m.type==='jump'){c.deployment='gliding';c.lastPose=now;}
  };
  const harness={arena,roster,log,stats,gate:null,rng,
    get now(){return now;},
    director:createBotDirector({arena,clock:()=>now,random:rng,members:()=>roster,mode:()=>mode,domination:()=>domination,royale:()=>royale,height:r=>HEIGHTS[r],difficulty:()=>difficulty,act}),
    // Advance `ms` of game time in 50 ms server ticks.
    run(ms,{each=null}={}){
      for(let t=0;t<ms;t+=50){
        now+=50;harness.director.tick(now);
        for(const c of roster){c.weapon.tick(Math.min(.2,(now-c.lastTick)/1000),c.aim,c.trigger);c.lastTick=now;}
        each?.(now);
      }
    },
    setDifficulty(name){difficulty=name;},
    shots(id){return log.filter(e=>e.id===id&&e.m.type==='fire');},
  };
  return harness;
}

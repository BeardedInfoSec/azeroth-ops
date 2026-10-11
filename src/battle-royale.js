import * as THREE from 'three';
import {createRoyalePlan,royaleState,advanceGlide} from './battle-royale-rules.mjs';
import {PLAYER_EYE_HEIGHT} from './player-config.js';
import {clearSpawn} from './spawns.js';
import {ROSTERS} from './rules.mjs';
export class SoloRoyale{
  constructor({combat,spawn,getPlayer,getHP,damagePlayer,notify}){
    Object.assign(this,{combat,getPlayer,getHP,damagePlayer,notify});this.elapsed=0;this.deployment='aboard';this.winnerName=null;this.winnerId=null;this.ended=false;
    this.points=combat.nav.reachable.filter(n=>n.edges.length>=2&&n.point.distanceTo(spawn)<49&&clearSpawn(n.point,combat.floorAt,combat.blocked)).map(n=>n.point.clone());this.plan=createRoyalePlan(this.points,spawn);this.center=new THREE.Vector3().fromArray(this.plan.center);
    const races=Object.entries(ROSTERS).flatMap(([team,races])=>races.map(race=>({race,team}))).filter(p=>p.race!==combat.race).slice(0,9),spots=[];
    for(let i=0;i<races.length;i++){let point=this.points[0],score=-Infinity;for(const p of this.points){const spread=spots.length?Math.min(...spots.map(s=>s.distanceTo(p))):p.distanceTo(this.center);const value=spread+Math.random()*2;if(value>score){point=p;score=value;}}spots.push(point);const unit=combat.add(races[i].race,races[i].team,point,i);unit.deployment='aboard';unit.jumpAt=3+i*1.4;unit.dropTarget=point.clone();unit.ring.visible=unit.label.visible=false;unit.playerName=races[i].race.toUpperCase();}
    this.getPlayer().fromArray(royaleState(this.plan,0).flight.position);this.notify('AZEROTH BATTLE ROYALE / SPACE TO JUMP',4);
  }
  jump(){if(this.deployment!=='aboard'||this.ended)return false;this.deployment='gliding';this.notify('WASD TO GLIDE / FIND SAFE GROUND',3);return true;}
  nearest(position){let best=this.points[0],score=Infinity;for(const p of this.points){const d=Math.hypot(p.x-position.x,p.z-position.z);if(d<score){best=p;score=d;}}return best;}
  movePlayer(dt,input){const player=this.getPlayer();if(this.deployment==='aboard'){player.fromArray(this.state.flight.position);return;}if(this.deployment!=='gliding')return;const next=player.clone().addScaledVector(input,8*dt);if(Math.hypot(next.x-this.center.x,next.z-this.center.z)<=this.plan.initialRadius){player.x=next.x;player.z=next.z;}const landing=this.nearest(player),step=advanceGlide(player,landing,dt);player.fromArray(step.position);if(step.landed){this.deployment='landed';this.notify('LANDED / LAST PLAYER STANDING WINS',3);}}
  tick(dt){if(this.ended)return;this.elapsed+=dt;const state=this.state;if(this.elapsed>=this.plan.flight.duration)this.jump();
    for(const unit of this.combat.units){unit.mesh.visible=unit.deployment!=='aboard';if(!unit.alive){unit.deployment='eliminated';continue;}if(unit.deployment==='aboard'){unit.mesh.position.fromArray(state.flight.position).y-=PLAYER_EYE_HEIGHT;if(this.elapsed>=unit.jumpAt)unit.deployment='gliding';}
      if(unit.deployment==='gliding'){const eyes=unit.mesh.position.clone().add(new THREE.Vector3(0,PLAYER_EYE_HEIGHT,0)),delta=unit.dropTarget.clone().sub(eyes);delta.y=0;if(delta.length()>0)eyes.addScaledVector(delta.normalize(),Math.min(8*dt,Math.hypot(unit.dropTarget.x-eyes.x,unit.dropTarget.z-eyes.z)));const step=advanceGlide(eyes,unit.dropTarget,dt);unit.mesh.position.fromArray(step.position).y-=PLAYER_EYE_HEIGHT;if(step.landed){unit.deployment='landed';unit.cooldown=1;unit.waypoint=null;}}
      if(unit.deployment==='landed'){const d=Math.hypot(unit.mesh.position.x-state.zone.center[0],unit.mesh.position.z-state.zone.center[2]);unit.royaleEscape=d>Math.max(0,state.zone.radius-4)?this.center:null;if(state.zone.radius<=0||d>state.zone.radius){unit.hp=Math.max(0,unit.hp-state.zone.damage*dt);if(unit.hp===0){unit.alive=false;unit.deployment='eliminated';unit.gun.visible=false;unit.actor.animate('death',true);}}}
    }
    if(this.getHP()<=0)this.deployment='eliminated';else if(this.deployment!=='aboard'&&state.phase!=='flight'){const p=this.getPlayer();if(state.zone.radius<=0||Math.hypot(p.x-state.zone.center[0],p.z-state.zone.center[2])>state.zone.radius)this.damagePlayer(state.zone.damage*dt);}
    if(this.getHP()<=0)this.deployment='eliminated';const alive=this.combat.units.filter(u=>u.alive);const total=alive.length+(this.getHP()>0?1:0);if(total<=1){this.ended=true;this.winnerId=this.getHP()>0?'you':alive[0]?.id??null;this.winnerName=this.getHP()>0?'YOU':alive[0]?.playerName||'DRAW';this.combat.winner=this.winnerName;this.notify(this.winnerName==='YOU'?'VICTORY / LAST PLAYER STANDING':this.winnerName+' WINS / ESC TO RESTART',30);}
  }
  get state(){return {...royaleState(this.plan,this.elapsed),phase:this.ended?'ended':this.elapsed<this.plan.flight.duration?'flight':'combat',alive:this.combat.units.filter(u=>u.alive).length+(this.getHP()>0?1:0),winnerId:this.winnerId,winnerName:this.winnerName};}
  dispose(){}
}

import {GUNS} from './weapon-data.js';
import {damageAt} from './engine/weapon-simulation.mjs';
import {clearSpawn,selectSpawns} from './spawns.js';
import {PLAYER_EYE_HEIGHT,playerBodyHeight} from './player-config.js';
import * as THREE from 'three';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {installSkinnedRaycast} from './engine/skinned-raycast.js';
const clone=source=>installSkinnedRaycast(cloneSkeleton(source));
import {createCharacter,characterInfo,FACTIONS} from './characters.js';
import {ROSTERS,opposite,friendly,rosterFor,waveSettings,awardScore} from './rules.mjs';
import {GroundNavigation} from './navigation.js';
const up=new THREE.Vector3(0,1,0);
export class Combat {
  constructor({createSurvival=null,onPlayerKill=()=>{},onBotShot=()=>{},scene,floorAt,blocked,shotBlocked,notify,tracer,damagePlayer,refill,getPlayer,gunModels}){Object.assign(this,{createSurvival,onPlayerKill,onBotShot,scene,floorAt,blocked,shotBlocked,notify,tracer,damagePlayer,refill,getPlayer,gunModels});this.units=[];this.score={alliance:0,horde:0};this.wave=1;this.countdown=0;this.winner=null;this.playerKills=0;this.playerDeaths=0;this.playerRespawn=0;this.elapsed=0;}
  clear(){for(const b of this.units){b.actor.dispose();b.ring.geometry.dispose();b.ring.material.dispose();b.label.material.map.dispose();b.label.material.dispose();if(b.gun)b.gun.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.dispose();});this.scene.remove(b.mesh);}this.units.length=0;}
  reset(mode,faction,race,spawn,yaw){
    this.survival?.dispose();this.survival=null;this.waveQueue=0;this.spawnDelay=0;this.nextUndeadId=0;this.clear();this.mode=mode;this.faction=faction;this.race=race;this.spawn=spawn.clone();this.yaw=yaw;this.score={alliance:0,horde:0};this.wave=1;this.countdown=0;this.winner=null;this.playerKills=0;this.playerDeaths=0;this.playerRespawn=0;this.elapsed=0;
    if(mode==='explore')return;
    this.nav=new GroundNavigation(spawn,this.floorAt,this.blocked);
    const forward=new THREE.Vector3(-Math.sin(yaw),0,-Math.cos(yaw));
    this.positions=this.nav.reachable.filter(n=>{const d=n.point.clone().sub(spawn);return n.edges.length>=2&&d.length()>7&&d.length()<49&&Math.abs(d.y+PLAYER_EYE_HEIGHT)<1.2&&clearSpawn(n.point,this.floorAt,this.blocked);}).map(n=>({point:n.point,score:n.point.clone().sub(spawn).normalize().dot(forward)}));
    if(this.positions.length<10)throw new Error('Not enough reachable ground for combat');
    if(mode==='royale')return;
    if(mode==='undead'&&this.createSurvival)this.survival=this.createSurvival(this);
    if(mode==='factions'){
      const enemy=opposite(faction),enemyPoints=this.pickSpawns(5,true);
      ROSTERS[enemy].forEach((id,i)=>this.add(id,enemy,enemyPoints[i],i));
      const allies=rosterFor(faction,race),allyPoints=this.pickSpawns(allies.length,false);
      allies.forEach((id,i)=>this.add(id,faction,allyPoints[i],i+5));
    }else this.startWave();
  }
  pickSpawns(count,forward=true){
    const player=this.getPlayer().clone().add(new THREE.Vector3(0,-PLAYER_EYE_HEIGHT,0));
    const candidates=this.positions.filter(p=>!forward||this.mode!=='undead'||!this.shotBlocked(p.point.clone().add(new THREE.Vector3(0,1,0)),player.clone().add(new THREE.Vector3(0,1,0))));
    const points=selectSpawns(candidates.map(p=>p.point),count,{threats:forward?[player]:[],occupied:this.units.filter(b=>b.alive).map(b=>b.mesh.position),minDistance:forward?20:7,spacing:4,
      hidden:(p,t)=>this.mode==='factions'&&this.shotBlocked(p.clone().add(new THREE.Vector3(0,1.4,0)),t.clone().add(new THREE.Vector3(0,1.4,0))),
      rank:p=>{const entry=this.positions.find(c=>c.point===p);return(forward?entry.score:-entry.score)*7-Math.abs(p.distanceTo(player)-(forward?29:12));}});
    if(points.length<count)throw new Error('Not enough clear, separated spawn locations');return points;
  }
  respawnPoint(faction){
    const player=this.getPlayer().clone().add(new THREE.Vector3(0,-PLAYER_EYE_HEIGHT,0));
    const enemies=this.units.filter(b=>b.alive&&b.faction!==faction).map(b=>b.mesh.position);
    if(faction!==this.faction&&this.playerRespawn<=0)enemies.push(player);
    const occupied=this.units.filter(b=>b.alive).map(b=>b.mesh.position);if(this.playerRespawn<=0)occupied.push(player);
    const points=selectSpawns(this.positions.map(p=>p.point),1,{threats:enemies,occupied,minDistance:12,spacing:3,
      hidden:(p,t)=>this.shotBlocked(p.clone().add(new THREE.Vector3(0,1.4,0)),t.clone().add(new THREE.Vector3(0,1.4,0))),
      rank:p=>-Math.abs(p.distanceTo(this.spawn)-24)});
    return points[0]||null;
  }
  playerSpawn(){return this.respawnPoint(this.faction);}

  startWave(){
    this.clear();this.countdown=0;
    this.waveConfig=this.survival?this.survival.waveSettings(this.wave):waveSettings(this.wave);
    if(this.survival){this.survival.startWave(this.wave);this.waveQueue=this.waveConfig.count;this.spawnDelay=1;}
    else{const points=this.pickSpawns(this.waveConfig.count,true);for(let i=0;i<this.waveConfig.count;i++)this.add(i%3===2?'ghoul':'zombie','scourge',points[i],i,this.waveConfig.health);}
    this.notify('WAVE '+this.wave+' / THE SCOURGE APPROACHES',3);
  }
  checkWaveClear(){
    if(this.mode!=='undead'||this.countdown>0||this.winner||this.waveQueue>0||!this.units.every(b=>!b.alive))return;
    this.countdown=this.survival?8:5;this.notify(this.survival?'WAVE CLEARED / NEXT WAVE IN 8':'WAVE CLEARED / RESUPPLY IN 5',this.countdown);
  }
  add(race,faction,position,id,health=100){
    const actor=createCharacter(race),mesh=actor.root;mesh.position.copy(position);mesh.name=faction+'-'+race;
    const color=FACTIONS[faction]?.color??0xa2c75c;
    const ring=new THREE.Mesh(new THREE.RingGeometry(.45,.49,32),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.55}));ring.rotation.x=-Math.PI/2;ring.position.y=.025;ring.raycast=()=>{};mesh.add(ring);
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=48;const ctx=canvas.getContext('2d');ctx.fillStyle='#07131bc9';ctx.fillRect(0,0,256,48);ctx.fillStyle='#'+new THREE.Color(color).getHexString();ctx.font='bold 19px Segoe UI';ctx.textAlign='center';ctx.fillText(characterInfo(race).name.toUpperCase(),128,30);
    const label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(canvas),depthTest:true,transparent:true}));label.position.y=actor.height+.28;label.scale.set(1.9,.36,1);label.raycast=()=>{};mesh.add(label);
    if(this.survival&&faction==='scourge')ring.visible=label.visible=false;
    let gun=null;if(faction!=='scourge'){gun=clone(this.gunModels[id%2]);gun.visible=true;gun.rotation.y=-Math.PI/2;mesh.add(gun);}
    const unit={id,actor,mesh,ring,label,gun,faction,race,hp:health,maxHp:health,alive:true,base:position.clone(),cooldown:2+id*.15,attackTime:0,respawn:0,navTimer:0,target:null};
    actor.meshes.forEach(m=>{m.userData.bot=unit;m.userData.characterBody=true;});if(gun)gun.traverse(o=>{if(o.isMesh)o.userData.bot=unit;});
    actor.animate(faction==='scourge'?'walk':'rifle');this.scene.add(mesh);this.units.push(unit);this.equip(unit);return unit;
  }
  equip(b){if(!b.gun)return;b.mesh.updateMatrixWorld(true);const p=b.actor.grip.getWorldPosition(new THREE.Vector3());b.gun.position.copy(b.mesh.worldToLocal(p));b.gun.position.y-=.035;}
  hit(unit,damage,killer=this.faction,headshot=false){
    if(!Number.isFinite(damage)||damage<=0||!unit.alive||(this.mode!=='royale'&&friendly(unit.faction,killer))||this.winner)return false;
    unit.hp-=damage;if(unit.hp>0)return true;
    unit.alive=false;unit.radarShot=null;unit.respawn=4;unit.ring.visible=false;unit.label.visible=false;if(unit.gun)unit.gun.visible=false;unit.actor.animate('death',true);
    if(killer===this.faction&&this.lastShotByPlayer){this.playerKills++;if(!this.survival)this.notify(headshot?'HEADSHOT +100':'ELIMINATION +100',1);this.onPlayerKill();}
    if(this.mode==='factions'){
      this.winner=awardScore(this.score,unit.faction,killer);
      if(this.winner)this.notify(FACTIONS[this.winner].name.toUpperCase()+' VICTORY',30);
    }else if(this.mode!=='royale')this.checkWaveClear();
    return true;
  }
  playerShot(unit,damage,headshot){const actualDamage=Math.min(unit.hp,damage);this.lastShotByPlayer=true;const result=this.hit(unit,damage,this.faction,headshot);this.lastShotByPlayer=false;if(result&&this.survival)this.survival.awardHit(unit.id,actualDamage,headshot,!unit.alive);return result;}
  playerDown(){
    this.playerDeaths++;if(this.mode==='royale'){this.playerRespawn=0;this.notify('ELIMINATED / SPECTATING',5);return;}this.playerRespawn=3;
    if(this.mode==='factions'){this.winner=awardScore(this.score,this.faction,opposite(this.faction));this.notify(this.winner?FACTIONS[this.winner].name.toUpperCase()+' VICTORY':'FALLEN · RESPAWNING IN 3',this.winner?30:3);}
    else{this.winner='scourge';this.notify('OVERRUN · '+this.playerKills+' ELIMINATIONS · ESC TO RESTART',30);}
  }
  tick(dt){
    this.elapsed+=dt;
    for(const b of this.units){b.actor.update(dt);this.equip(b);}
    if(this.winner||this.mode==='explore')return;
    this.survival?.tick(dt);
    if(this.playerRespawn>0){this.playerRespawn-=dt;if(this.playerRespawn<=0){if(this.playerSpawn())this.refill(true);else this.playerRespawn=.5;}}
    if(this.countdown>0){this.countdown-=dt;if(this.countdown<=0){this.wave++;if(!this.survival)this.refill(false);this.startWave();}return;}
    if(this.survival){
      this.spawnDelay=Math.max(0,this.spawnDelay-dt);
      if(this.waveQueue>0&&this.spawnDelay<=0&&this.units.filter(b=>b.alive).length<24){
        const entry=this.survival.nextEntry();
        if(entry){const id=this.nextUndeadId++,unit=this.add(id%3===2?'ghoul':'zombie','scourge',entry.spawnPoint||entry.outside,id,this.waveConfig.health);unit.entry=entry;unit.cooldown=.3;this.waveQueue--;this.spawnDelay=this.waveConfig.spawnInterval;}
        else this.spawnDelay=.25;
      }
      this.checkWaveClear();if(this.countdown>0)return;
    }
    const player=this.getPlayer();
    for(const b of this.units){
      if(!b.alive){b.respawn-=dt;if(b.respawn<=0&&this.mode==='factions'){const point=this.respawnPoint(b.faction);if(!point){b.respawn=.5;continue;}b.alive=true;b.hp=b.maxHp;b.mesh.position.copy(point);b.waypoint=null;b.ring.visible=b.label.visible=true;if(b.gun)b.gun.visible=true;b.actor.animate('rifle');b.cooldown=2;}continue;}
      if(this.mode==='royale'&&b.deployment!=='landed')continue;
      if(b.stunLeft>0){b.stunLeft=Math.max(0,b.stunLeft-dt);b.actor.animate('idle');continue;}
      if(this.survival?.playerHidden&&b.target?.isPlayer){b.target=null;b.navTimer=0;}
      b.cooldown-=dt;b.attackTime=Math.max(0,b.attackTime-dt);b.navTimer-=dt;
      if(this.survival&&b.entry){
        b.target=null;
        if(this.survival.approachEntry&&!this.survival.approachEntry(b))continue;
        if(b.entry.boards<=0||b.entry.retired||b.breaching){b.breaching=true;this.survival.releaseEntry(b);if(b.entry)continue;}
        else{
          const toward=b.entry.inside||player;b.mesh.lookAt(toward.x,b.mesh.position.y,toward.z);b.target=null;
          if(b.cooldown<=0){b.cooldown=1;b.attackTime=.75;b.actor.animate('attack');this.survival.attackEntry(b.entry,this.wave);}
          else if(b.attackTime<=0)b.actor.animate('idle');
          continue;
        }
        b.navTimer=0;
      }
      if(b.navTimer<=0){
        b.navTimer=.35;
        const possible=this.units.filter(n=>n.alive&&(this.mode==='royale'?n!==b&&n.deployment==='landed':!friendly(n.faction,b.faction)));
        if((this.mode==='royale'?this.royalePlayerAlive:!friendly(b.faction,this.faction))&&this.playerRespawn<=0&&!this.survival?.playerHidden)possible.push({isPlayer:true,mesh:{position:player.clone().add(new THREE.Vector3(0,-PLAYER_EYE_HEIGHT,0))},actor:{height:PLAYER_EYE_HEIGHT+.15}});
        possible.sort((a,c)=>a.mesh.position.distanceToSquared(b.mesh.position)-c.mesh.position.distanceToSquared(b.mesh.position));b.target=possible[0]||null;
      }
      const target=b.target;if(!target||target.alive===false){b.actor.animate('idle');continue;}
      const targetPos=target.isPlayer?player.clone().add(new THREE.Vector3(0,-PLAYER_EYE_HEIGHT,0)):target.mesh.position;
      const distance=b.mesh.position.distanceTo(targetPos);b.mesh.lookAt(targetPos.x,b.mesh.position.y,targetPos.z);
      const from=b.mesh.position.clone().add(new THREE.Vector3(0,b.actor.height*.7,0)),to=targetPos.clone().add(new THREE.Vector3(0,(target.isPlayer?playerBodyHeight(PLAYER_EYE_HEIGHT+.15,this.playerCrouched):target.actor.height)*.65,0));
      const visible=!this.shotBlocked(from,to);
      let moving=false;
      if(b.faction==='scourge'){
        if(distance>1.5)moving=this.nav.step(b,targetPos,this.waveConfig.speed*(b.race==='ghoul'?1.2:1),dt);
        if(distance<1.8&&visible&&b.cooldown<=0){b.cooldown=1.1;b.attackTime=.75;b.actor.animate('attack');this.damagePlayer(this.survival?this.waveConfig.damage:12);}
      }else{
        if(this.mode==='royale'&&b.royaleEscape)moving=this.nav.step(b,b.royaleEscape,5.5,dt);else if(distance>19||!visible)moving=this.nav.step(b,targetPos,this.mode==='royale'?3.5:2.4,dt);
        from.copy(b.mesh.position).y+=b.actor.height*.7;
        if(visible&&!this.shotBlocked(from,to)&&distance<50&&b.cooldown<=0){
          b.cooldown=1.15+Math.random()*.6;b.attackTime=.55;b.actor.animate('shoot');this.tracer(from,to,FACTIONS[b.faction].color);this.onBotShot(from,to,b.id%2,b);
          if(Math.random()<.6){if(target.isPlayer)this.damagePlayer(damageAt(GUNS[b.id%2],distance,'locTorsoUpper'));else this.hit(target,damageAt(GUNS[b.id%2],distance,'locTorsoUpper'),b.faction);}
        }
      }
      if(b.attackTime<=0)b.actor.animate(moving?(b.faction==='scourge'?(this.survival&&b.race==='ghoul'&&this.wave>=3?'run':'walk'):'run'):(b.faction==='scourge'?'idle':'rifle'));
      // Avoid agents occupying exactly the same spot without pushing through city walls.
      for(const other of this.units){if(other===b||!other.alive)continue;const d=b.mesh.position.clone().sub(other.mesh.position);d.y=0;const len=d.length();if(len>.01&&len<.7){const wanted=b.mesh.position.clone().add(d.multiplyScalar(.4/len));this.nav.step(b,wanted,.6,dt);}}
    }
  }
}

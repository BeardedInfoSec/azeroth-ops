import {assetFetch} from './asset-cache.mjs';
import {MELEE,tryMelee,selectMeleeTarget} from './melee-rules.mjs';
import {createKnifeView} from './knife.js';
import {loadPerkModels,perkModelStatus} from './perk-models.js';
import {loadSentryModel,createSentryModel,yawToDirection} from './sentry-model.js';
import {CityAtmosphere} from './atmosphere.js';
import {survivalWeapons} from './survival-rules.mjs';
import {WeaponAudio} from './weapon-audio.js';
import {SoloRoyale} from './battle-royale.js';
import {BattleRoyaleView,loadZeppelin,zeppelinStatus} from './battle-royale-view.js';
import {Survival} from './survival.js';
import {CoopSurvival} from './coop-survival.js';
import {GroundNavigation} from './navigation.js';
import {raceTraits,racialWeapons,racialMaxHealth,racialMovement,racialRegenDelay,racialRegenRate,racialSpread,racialRecoil} from './racial-traits.mjs';
import {Lobby} from './lobby.js';
import {formatName} from './names.mjs';
import {MatchUI,renderDominationHud} from './match-ui.js';
import {DominationView} from './domination-view.js';
import {dominationHudModel} from './domination-rules.mjs';
import {inMatchPhase,matchStamp,sameDeployment,loadStageProgress} from './match-session.mjs';
import {GroundJump,groundStepHeight} from './engine/ground-movement.js';
import {stanceEye,canStandAt} from './engine/player-stance.js';
import {classWeapons,classSpeed} from './loadouts.mjs';
import {spreadDegrees,kickAfterShot,recoverKick} from './engine/aim.mjs';
import {pelletDirections,tracerCount,isShellReload} from './engine/firing-modes.mjs';
import {CharacterCollision} from './engine/character-collision.js';
import {installSkinnedRaycast} from './engine/skinned-raycast.js';
import {TracerPool} from './engine/tracer-pool.js';
import {resolveFortificationMove} from './engine/fortification-motion.js';
import {SimulationClock} from './engine/clock.mjs';
import {WeaponSimulation,damageAt,hitRegion} from './engine/weapon-simulation.mjs';
import {Killstreaks,REWARDS} from './streaks.mjs';
import {recordRadarShot,radarContact} from './radar.mjs';
import {createMuzzle,createMuzzleLights,createWorldMuzzlePool,muzzleAssetsReady} from './muzzle.js';
import {clearSpawn} from './spawns.js';
import {PLAYER_EYE_HEIGHT,PLAYER_RADIUS,PLAYER_CROUCH_SPEED,playerEyeHeight,playerHeightOffset,playerBodyHeight} from './player-config.js';
import {traceShot,shotBlocked} from './ballistics.js';
import * as THREE from 'three';
import {loadWorld,ARENAS} from './world.js';
import {GUNS,loadWeapons} from './weapons.js';
import {loadCharacters,createCharacter,characterInfo,FACTIONS} from './characters.js';
import {Combat} from './combat.js';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
const clone=source=>installSkinnedRaycast(cloneSkeleton(source));
const $=id=>document.getElementById(id);
const renderer=new THREE.WebGLRenderer({canvas:$('game'),antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene();const camera=new THREE.PerspectiveCamera(78,innerWidth/innerHeight,.08,1800);camera.rotation.order='YXZ';scene.add(camera);
const hemi=new THREE.HemisphereLight(0xd2e6ff,0x4c422f,2.5);scene.add(hemi);const sun=new THREE.DirectionalLight(0xffe0aa,2);sun.position.set(60,100,30);scene.add(sun);
const ambient=new THREE.AmbientLight(0xffffff,.65);scene.add(ambient);
const atmosphere=new CityAtmosphere({scene,hemi,sun,ambient});
const knife=createKnifeView(camera),meleeState={};
const perkModelsReady=loadPerkModels();void loadSentryModel();
let gunIndex=0,gunModels=[],gunsReady=false,charactersReady=false,combat=null,operatorActor=null,playerUnit=null,thirdPerson=false;
const simulation=new WeaponSimulation(GUNS),groundJump=new GroundJump();
let matchUI=null,autoDeployStamp='',networkLoadAttempt=0,pendingMatchCapture=null;
const weaponAudio=new WeaponAudio({volume:.65,maxVoices:24});
let world=null,city='stormwind',ready=false,active=false,paused=false,mode='undead',elapsed=0,kills=0,hp=100,lastHurt=-100,noticeTime=0,hitTime=0,damageTime=0,recoil=0,viewKick=0,grounded=false,aim=false,shooting=false,won=false;
let airbornePeak=null;
let yaw=0,pitch=0,vertical=0,loadToken=0,frameCount=0,fpsTime=0;
let crouched=false,crouchToggle=false;
const hitPoint=new THREE.Vector3();
const keys=new Set(),player=new THREE.Vector3(),spawn=new THREE.Vector3(),velocity=new THREE.Vector3();
const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),scratch=new THREE.Vector3();ray.firstHitOnly=true;
let lobby=null,networkActive=false,networkLoading=false,networkSpawn=0,networkPoseTime=0,networkClass=null,networkShield=0;const networkSentries=new Map();
let networkMaxHealth=100,networkStatus='alive',networkSurvivalSignature='';
let dominationView=null;
let soloRoyale=null,royaleView=null,royaleDeployment=null,spectateIndex=0;
let bots=[];const effects=[];const weapon=new THREE.Group();camera.add(weapon);
const metal=new THREE.MeshStandardMaterial({color:0x262d2c,roughness:.56,metalness:.65});const tan=new THREE.MeshStandardMaterial({color:0x817052,roughness:.85});const black=new THREE.MeshStandardMaterial({color:0x111717,roughness:.5});
function box(parent,size,pos,mat){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),mat);mesh.position.set(...pos);parent.add(mesh);return mesh;}
// Original placeholder assault rifle. The installed BO2 files are not modified.
box(weapon,[.13,.17,.5],[0,0,-.28],metal);box(weapon,[.115,.12,.30],[0,0,-.65],tan);
box(weapon,[.055,.055,.29],[0,.005,-.91],black);box(weapon,[.07,.09,.04],[0,.03,-1.045],metal);
box(weapon,[.10,.25,.15],[0,-.16,-.21],black).rotation.x=-.15;
box(weapon,[.08,.20,.09],[0,-.13,-.02],tan).rotation.x=-.25;
box(weapon,[.11,.14,.25],[0,-.015,.10],tan);
box(weapon,[.045,.05,.65],[0,.11,-.38],black);
for(let i=0;i<8;i++)box(weapon,[.14,.015,.018],[0,.075,-.5-i*.03],black);
box(weapon,[.025,.09,.025],[0,.15,-.85],metal);
box(weapon,[.10,.045,.035],[0,.15,-.12],metal);
box(weapon,[.018,.055,.03],[-.043,.195,-.12],metal);box(weapon,[.018,.055,.03],[.043,.195,-.12],metal);
const glove=new THREE.MeshStandardMaterial({color:0x3c453d,roughness:1});
box(weapon,[.14,.14,.22],[-.08,-.14,-.60],glove).rotation.z=-.25;
box(weapon,[.15,.15,.23],[.035,-.23,0],glove).rotation.x=-.35;
const muzzleLights=createMuzzleLights(scene),worldMuzzles=createWorldMuzzlePool(scene,muzzleLights),tracers=new TracerPool(scene,shotCover);
const muzzle=createMuzzle(muzzleLights),flash=muzzle.group;flash.position.set(0,0,-1.18);weapon.add(flash);weapon.visible=false;
const streaks=new Killstreaks();let uavTime=0,sentry=null;
const scope=document.createElement('div');scope.id='scope';scope.hidden=true;const scopeImage=document.createElement('img');scope.append(scopeImage);$('hud').prepend(scope);
// Scope overlays are DOM images, so retain these two blob URLs for the page's
// lifetime. They share the same persistent asset cache as model textures.
const scopeURLs=new Map();
async function loadScopeOverlays(){
  for(const url of new Set(GUNS.map(gun=>gun.scope).filter(Boolean))){
    const response=await assetFetch(url);
    if(!response.ok)throw new Error('Scope overlay '+url+': HTTP '+response.status);
    scopeURLs.set(url,URL.createObjectURL(await response.blob()));
  }
}
const streakHud=document.createElement('div');streakHud.id='streaks';$('hud').append(streakHud);let streakDisplay='';
const fallbackParts=weapon.children.filter(o=>o!==flash);
const assetsReady=Promise.all([loadWeapons(),loadCharacters(),muzzleAssetsReady,weaponAudio.load(),loadScopeOverlays(),knife.ready,perkModelsReady]).then(([models])=>{
  gunModels=models;for(const part of fallbackParts){weapon.remove(part);part.geometry?.dispose();}
  for(const model of models)weapon.add(model);gunsReady=charactersReady=true;
  combat=new Combat({createSurvival:createSurvivalMode,onPlayerKill:earnStreak,onBotShot:(from,to,index,unit)=>{recordRadarShot(unit,from);worldMuzzle(from,to);playWeaponShot(index,from);},scene,floorAt,blocked,shotBlocked:(from,to)=>shotBlocked(from,to,shotCover()),notify,tracer,damagePlayer,refill:refillPlayer,getPlayer:()=>player.clone(),gunModels});
  $('loadout').replaceChildren(...GUNS.map((g,i)=>{const o=document.createElement('option');o.value=i;o.textContent=g.key+' / '+g.name+' / '+g.capacity+' ROUNDS';return o;}));selectGun(0);updateRaceOptions();selectOperator();
}).catch(e=>{console.error(e);$('loading').textContent='Asset import failed: '+e.message;throw e;});
function selectGun(index,force=false){if(!Number.isInteger(index)||!GUNS[index])return false;if(!force&&(meleeRemaining()>0||combat?.survival?.recovery||combat?.survival?.reviving))return false;if(!force&&isRoyale()&&royaleDeployment!=='landed')return false;if(combat?.survival&&(mode==='undead'||isCoop())&&!combat.survival.rules.owned.has(index)){notify('BUY THIS WEAPON AT A WALL RACK',1.5);return false;}if(networkActive&&!isCoop()&&networkClass&&![networkClass.primary,networkClass.secondary].includes(index))return false;if(networkActive&&(!force||simulation.index!==index))lobby.send({type:'switch',gun:index});weaponAudio.cancelReload();simulation.select(index);gunIndex=index;gunModels.forEach((m,i)=>m.visible=i===index);const g=simulation.gun;$('gun-name').textContent=g.name;$('gun-caliber').textContent=g.caliber;flash.position.fromArray(gunModels[index].userData.flash);if(GUNS[index].scope)scopeImage.src=scopeURLs.get(GUNS[index].scope)||GUNS[index].scope;else scopeImage.removeAttribute('src');$('loadout').value=String(index);if(playerUnit){playerUnit.gun.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.dispose();});playerUnit.mesh.remove(playerUnit.gun);playerUnit.gun=clone(gunModels[index]);playerUnit.gun.visible=true;playerUnit.gun.rotation.y=-Math.PI/2;playerUnit.mesh.add(playerUnit.gun);}updateHUD();}
function floorAt(x,z,top=80,max=200){if(!world)return null;ray.set(new THREE.Vector3(x,top,z),down);ray.far=max;const h=ray.intersectObject(world.collider)[0];return h||null;}
function locateSpawn(){
  const a=ARENAS[city],base=a.spawn;
  // Prefer a walkable surface close to the intended street elevation, below roof level.
  let best=null;
  for(let radius=0;radius<=24;radius+=3)for(let k=0;k<16;k++){
    const x=base[0]+Math.cos(k*Math.PI/8)*radius,z=base[2]+Math.sin(k*Math.PI/8)*radius;
    const h=floorAt(x,z,base[1]+8,50);
    if(!h||h.face.normal.y<.7||!clearSpawn(h.point,floorAt,blocked,1.2,PLAYER_EYE_HEIGHT+.2))continue;
    ray.set(h.point.clone().add(new THREE.Vector3(0,.15,0)),new THREE.Vector3(0,1,0));ray.far=PLAYER_EYE_HEIGHT+.2;
    if(ray.intersectObject(world.collider).length)continue;
    const score=radius+Math.abs(h.point.y-base[1])*2;
    if(!best||score<best.score)best={point:h.point,score};
  }
  if(!best)throw new Error('Could not find a safe spawn in this city.');
  spawn.copy(best.point).add(new THREE.Vector3(0,PLAYER_EYE_HEIGHT,0));player.copy(spawn);yaw=a.yaw;pitch=0;vertical=0;
}
async function changeCity(id,layoutOverride=null,onProgress=null){
  const token=++loadToken;ready=false;$('play').disabled=true;$('play').textContent='LOADING CITY…';
  document.querySelectorAll('.map').forEach(b=>b.classList.toggle('selected',b.dataset.map===id));
  try{
    const next=await loadWorld(id,text=>{if(token===loadToken){$('loading').textContent=text;onProgress?.(text);}},layoutOverride);
    if(token!==loadToken){next.dispose();return;}
    if(world){scene.remove(world.group);world.dispose();}clearBots();world=next;city=id;scene.add(world.group);
    setAtmosphere(true);
    locateSpawn();await assetsReady;if(token!==loadToken)return;ready=true;paused=false;active=false;setMenuCamera();
    $('loading').textContent=`${ARENAS[id].subtitle} · LOCAL OPERATIONS · Ready to deploy`;
    $('play').disabled=false;$('play').textContent='DEPLOY TO '+ARENAS[id].name.toUpperCase();
    $('city-name').textContent=ARENAS[id].name.toUpperCase();
    document.documentElement.dataset.ready='true';
  }catch(e){console.error(e);$('loading').textContent=e.message;$('play').textContent='RETRY LOAD';$('play').disabled=false;}
}
function setAtmosphere(zombies){if(world)atmosphere.apply(world,ARENAS[city],zombies?world.layout?.settings?.lighting:'day');}
function meleeRemaining(){return Math.max(0,((meleeState.nextAt||0)-performance.now())/1000);}
function resetKnife(){meleeState.nextAt=0;knife.reset();groundJump.reset();}
function equipKnife(unit,visible){
  if(visible&&!unit.knife){unit.knife=clone(knife.root.children[0]);unit.knife.rotation.y=Math.PI;unit.knife.traverse(object=>{object.raycast=()=>{};});unit.mesh.add(unit.knife);}
  if(unit.knife){unit.knife.visible=!!visible;if(visible){unit.mesh.updateMatrixWorld(true);unit.knife.position.copy(unit.mesh.worldToLocal(unit.actor.grip.getWorldPosition(new THREE.Vector3())));}}
  if(unit.gun)unit.gun.visible=!visible&&(unit===playerUnit?hp>0:unit.alive);
}
function quickKnife(){
  if(!canPlayInput())return false;
  if(!active||!ready||!combat||combat.winner||combat.survival?.recovery)return false;
  if(!tryMelee(simulation,meleeState,performance.now(),{alive:hp>0&&(!networkActive||networkStatus==='alive'),reviving:!!combat.survival?.reviving,landed:!isRoyale()||royaleDeployment==='landed'}))return false;
  aim=false;simulation.ads=0;scope.hidden=true;document.body.classList.remove('aim');muzzle.reset();knife.swing();weapon.visible=false;
  if(playerUnit){playerUnit.actor.animate('attack',true);equipKnife(playerUnit,true);}
  const origin=stanceEye(player,crouched).add(new THREE.Vector3(0,-.35,0));
  // Aim comes from the player, so switching to third person cannot extend reach.
  const direction=new THREE.Vector3(-Math.sin(yaw)*Math.cos(pitch),Math.sin(pitch),-Math.cos(yaw)*Math.cos(pitch));
  if(networkActive){lobby.send({type:'melee',target:origin.clone().addScaledVector(direction,MELEE.range).toArray()});updateHUD();return true;}
  const contact=selectMeleeTarget({origin:origin.toArray(),direction:direction.toArray(),candidates:bots.filter(unit=>unit.alive).map(unit=>({id:unit.id,position:unit.mesh.position.toArray(),height:playerBodyHeight(unit.actor.height,unit.crouched),unit})),blocked:(from,to)=>shotBlocked(new THREE.Vector3().fromArray(from),new THREE.Vector3().fromArray(to),shotCover())});
  if(contact){const unit=contact.candidate.unit;if(combat.playerShot(unit,unit.faction==='scourge'?MELEE.damage:MELEE.playerDamage,false)){hitTime=.2;hitPoint.fromArray(contact.point);sound('hit');}else if(unit.faction===combat.faction)notify('FRIENDLY / HOLD FIRE',.7);kills=combat.playerKills;}
  updateHUD();return true;
}
function setMenuCamera(){if(playerUnit)playerUnit.mesh.visible=false;camera.position.copy(spawn).add(new THREE.Vector3(0,.4,0));camera.rotation.set(-.07,ARENAS[city].yaw,0);weapon.visible=false;}
function notify(text,seconds=2){$('notice').textContent=text;noticeTime=seconds;}
const survivalCover=new THREE.Object3D();survivalCover.raycast=(caster,hits)=>{caster.intersectObject(world.shotCollider,true,hits);const cover=combat?.survival?.environment.shotCollider;if(cover)caster.intersectObject(cover,true,hits);};
function shotCover(){return combat?.survival?survivalCover:world.shotCollider;}
function survivalSound(type,point){if(!active)return;try{audioCtx??=new AudioContext();if(audioCtx.state==='suspended')audioCtx.resume();const now=audioCtx.currentTime,osc=audioCtx.createOscillator(),gain=audioCtx.createGain(),distance=point?.distanceTo(player)||0;osc.type=type==='board'?'triangle':'sawtooth';osc.frequency.setValueAtTime(type==='breach'?85:type==='board'?170:440,now);osc.frequency.exponentialRampToValueAtTime(type==='breach'?30:65,now+.18);gain.gain.setValueAtTime(Math.max(.008,.07/(1+distance*.12)),now);gain.gain.exponentialRampToValueAtTime(.001,now+.23);osc.connect(gain);gain.connect(audioCtx.destination);osc.start();osc.stop(now+.24);}catch{}}
function currentRace(){return networkActive?lobby?.room?.players.find(p=>p.id===lobby.id)?.race||$('race').value:combat?.race||$('race').value;}
function isCoop(){return networkActive&&lobby?.room?.mode==='zombies';}
function healthLimit(){return networkActive?networkMaxHealth:racialMaxHealth(combat?.survival?.rules.maxHealth||100,currentRace());}
const packedMaterials=new WeakMap(),originalWeaponMaterials=new WeakMap();
function stylePackedWeapons(){for(let index=0;index<gunModels.length;index++)gunModels[index].traverse(mesh=>{if(!mesh.isMesh)return;if(!originalWeaponMaterials.has(mesh))originalWeaponMaterials.set(mesh,mesh.material);const packed=combat?.survival?.rules.packed.has(index),convert=material=>{if(!packedMaterials.has(material)){const upgraded=material.clone();if(upgraded.color)upgraded.color.lerp(new THREE.Color(0x8a78ff),.32);if(upgraded.emissive){upgraded.emissive.set(0x453078);upgraded.emissiveIntensity=.32;}packedMaterials.set(material,upgraded);}return packedMaterials.get(material);};const original=originalWeaponMaterials.get(mesh);mesh.material=packed?(Array.isArray(original)?original.map(convert):convert(original)):original;});}
function applySurvivalUpgrades({refillIndex,removedIndex}={}){
  const rules=combat?.survival?.rules;simulation.guns=racialWeapons(rules?survivalWeapons(GUNS,rules):GUNS,currentRace());
  for(let i=0;i<simulation.inventory.length;i++){const g=simulation.guns[i],slot=simulation.inventory[i];slot.ammo=Math.min(slot.ammo,g.capacity);slot.reserve=Math.min(slot.reserve,g.reserve);}
  if(Number.isInteger(removedIndex))simulation.inventory[removedIndex]={ammo:0,reserve:0};
  if(Number.isInteger(refillIndex))simulation.inventory[refillIndex]={ammo:simulation.guns[refillIndex].capacity,reserve:simulation.guns[refillIndex].reserve};
  hp=Math.min(hp,healthLimit());weaponAudio.cancelReload();simulation.reloadLeft=0;simulation.ads=0;stylePackedWeapons();
  const next=Number.isInteger(refillIndex)?refillIndex:rules&&!rules.owned.has(gunIndex)?[...rules.owned][0]:gunIndex;if(gunModels.length)selectGun(next,true);updateHUD();
}
function relocatePlayer(position){
  player.copy(position);vertical=0;airbornePeak=null;velocity.set(0,0,0);grounded=false;groundJump.reset();
  const fort=combat?.survival?.environment;
  if(world&&!canStandAt(player,world.collider,fort?.movementColliders||[]))crouched=true;
}
function createSurvivalMode(c){return new Survival({combat:c,scene,spawn,gunModels,city,layout:world.layout,getPlayer:()=>player.clone(),getEye:()=>stanceEye(player,crouched),getLook:()=>camera.getWorldDirection(new THREE.Vector3()),isHolding:()=>active&&(hp>0||combat?.survival?.recovery?.type==='ghost')&&keys.has('KeyE'),notify,sound:survivalSound,worldCollider:world.shotCollider,getGun:()=>gunIndex,getHealth:()=>hp,setHealth:value=>{hp=Math.max(0,Math.min(value,healthLimit()));lastHurt=elapsed;updateHUD();},applyUpgrades:applySurvivalUpgrades,relocate:relocatePlayer,getAmmo:()=>({ammo:simulation.ammo,reserve:simulation.reserve,capacity:simulation.gun.capacity,maxReserve:simulation.gun.reserve}),addAmmo:amount=>{simulation.reserve=Math.min(simulation.gun.reserve,simulation.reserve+amount);updateHUD();},resetWeaponLoadout:()=>{applySurvivalUpgrades();simulation.refill();selectGun(0,true);}});}

function blocked(from,to,padding=0){if(combat?.survival?.environment.isMoveBlocked(from,to,padding))return true;const dir=to.clone().sub(from),distance=dir.length();if(distance<.001)return false;ray.set(from,dir.normalize());ray.far=distance+padding;return !!ray.intersectObject(world.collider)[0];}
function clearShotEffects(){knife.reset();muzzle.reset();worldMuzzles.reset();muzzleLights.reset();tracers.reset();}
function clearBots(){resetKnife();for(const unit of bots)unit.knife?.traverse(object=>{if(object.isSkinnedMesh)object.skeleton.dispose();});clearShotEffects();clearRoyale();combat?.survival?.dispose();if(combat)combat.survival=null;clearSentry();combat?.clear();bots=[];stylePackedWeapons();}
function isRoyale(){return networkActive?lobby?.room?.mode==='royale':!!soloRoyale;}
function ensureRoyaleView(){royaleView??=new BattleRoyaleView({scene,camera,getPlayer:()=>player,onJump:jumpRoyale});}
function clearRoyale(){dominationView?.dispose();dominationView=null;renderDominationHud($('domination-hud'),null);royaleView?.dispose();royaleView=null;soloRoyale?.dispose();soloRoyale=null;royaleDeployment=null;spectateIndex=0;}
function jumpRoyale(){if(!canPlayInput())return;if(!isRoyale()||royaleDeployment!=='aboard'||hp<=0)return;if(networkActive)lobby.send({type:'jump'});else{soloRoyale.jump();royaleDeployment=soloRoyale.deployment;}grounded=false;vertical=0;}
function moveRoyaleAir(dt){groundJump.reset();aim=false;const input=new THREE.Vector3((keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0),0,(keys.has('KeyS')?1:0)-(keys.has('KeyW')?1:0));if(input.lengthSq())input.normalize().applyAxisAngle(new THREE.Vector3(0,1,0),yaw);grounded=false;vertical=0;velocity.set(0,0,0);if(soloRoyale){soloRoyale.movePlayer(dt,input);royaleDeployment=soloRoyale.deployment;}else if(royaleDeployment==='gliding'){const zone=lobby.room.royale?.zone,next=player.clone().addScaledVector(input,8*dt);if(zone&&Math.hypot(next.x-zone.center[0],next.z-zone.center[2])<=48){player.x=next.x;player.z=next.z;}player.y-=6*dt;}}
function updateRoyaleView(dt){if(!royaleView||!isRoyale())return;const state=networkActive?lobby.room.royale:soloRoyale.state;if(!state)return;royaleView.setState(state,{phase:royaleDeployment,position:player.toArray(),thirdPerson});royaleView.tick(dt);if((active||networkActive)&&royaleDeployment==='aboard'){const ship=new THREE.Vector3().fromArray(state.flight.position),offset=new THREE.Vector3(22,13,28).applyAxisAngle(new THREE.Vector3(0,1,0),yaw);camera.position.copy(ship).add(offset);camera.lookAt(ship.add(new THREE.Vector3(0,4,0)));if(playerUnit)playerUnit.mesh.visible=false;}if((active||networkActive)&&hp<=0){weapon.visible=false;if(playerUnit)playerUnit.mesh.visible=false;const alive=bots.filter(b=>b.alive),target=alive[((spectateIndex%alive.length)+alive.length)%alive.length];if(target){const center=target.mesh.position.clone().add(new THREE.Vector3(0,1.6,0)),offset=new THREE.Vector3(0,3,6).applyAxisAngle(new THREE.Vector3(0,1,0),yaw);camera.position.copy(center).add(offset);camera.lookAt(center);}}}
function refillPlayer(respawn){hp=healthLimit();simulation.refill();if(respawn){crouched=crouchToggle=false;resetKnife();const safe=combat?.playerSpawn();player.copy(safe?safe.clone().add(new THREE.Vector3(0,PLAYER_EYE_HEIGHT,0)):spawn);velocity.set(0,0,0);vertical=0;notify('REDEPLOYED',1.5);}updateHUD();}
function damagePlayer(amount){if(networkActive)return;if(hp<=0||combat?.winner||combat?.playerRespawn>0||combat?.survival?.damageImmune)return;hp=Math.max(0,hp-amount);lastHurt=elapsed;damageTime=.35;if(hp===0){groundJump.reset();weaponAudio.cancelReload();streaks.death();uavTime=0;clearSentry();viewKick=0;hitTime=0;if(!combat.survival?.onLethal())combat.playerDown();}updateHUD();}
function resetRound(){
  resetKnife();clearRoyale();
  clearShotEffects();clearSentry();streaks.reset();uavTime=0;viewKick=0;hitTime=0;mode=$('mode').value;refillPlayer(false);kills=0;elapsed=0;lastHurt=-100;noticeTime=0;$('notice').textContent='';damageTime=0;won=false;
  crouched=crouchToggle=false;player.copy(spawn);velocity.set(0,0,0);yaw=ARENAS[city].yaw;pitch=0;vertical=0;
  setAtmosphere(mode==='undead');combat.reset(mode,$('faction').value,$('race').value,spawn,yaw);if(mode==='royale'){soloRoyale=new SoloRoyale({combat,spawn,getPlayer:()=>player,getHP:()=>hp,damagePlayer,notify});royaleDeployment='aboard';ensureRoyaleView();}bots=combat.units;
  applySurvivalUpgrades();simulation.refill();hp=healthLimit();airbornePeak=null;if(combat.survival)selectGun(0);document.querySelector('.hud-hint').textContent=isRoyale()?'SPACE Jump | WASD Glide / Move | Q Knife | C Crouch | Q / E Spectate when eliminated | R Reload | RMB Aim | ESC Menu':combat.survival?'HOLD E Repair / Buy | 1 / 2 / 6 / 7 Owned weapons | Q Knife | C Crouch | R Reload | RMB Aim | V Camera | ESC Menu':'1 / 2 Rifles | 6 / 7 Snipers | Q Knife | C Crouch | R Reload | RMB Aim | V Camera | ESC Menu | F Reset position';selectOperator();updateHUD();
}
function canPlayInput(){return !networkActive||lobby?.room?.phase==='playing';}
function refreshMatchScreen(){
  const room=lobby?.room,inSession=inMatchPhase(room?.phase);
  document.body.classList.toggle('match-session',inSession);
  if(inSession){$('multiplayer-panel').hidden=true;$('menu').hidden=true;$('hud').hidden=!networkActive||room.phase==='loading';}
  else{$('menu').hidden=active;$('hud').hidden=!active;$('multiplayer-panel').hidden=!document.body.classList.contains('lobby-open');}
  matchUI?.update({locked:active,focused:document.hasFocus()&&!document.hidden});
}
async function captureMatchControls(){
  if(pendingMatchCapture)return pendingMatchCapture;
  if(!networkActive||lobby?.room?.phase!=='playing'||document.hidden||!document.hasFocus())return;
  const stamp=matchStamp(lobby.room);weaponAudio.unlock();
  let request;
  try{request=$('game').requestPointerLock();}catch{refreshMatchScreen();return;}
  pendingMatchCapture=Promise.resolve(request).then(()=>{
    if(!sameDeployment(lobby?.room,stamp)||lobby?.room?.phase!=='playing'||document.hidden||!document.hasFocus())releaseMouse();
  }).catch(()=>refreshMatchScreen()).finally(()=>{pendingMatchCapture=null;});
  return pendingMatchCapture;
}
function autoDeploy(room){
  if(!networkActive||room.phase!=='playing')return;
  const stamp=JSON.stringify(matchStamp(room));if(autoDeployStamp===stamp)return;autoDeployStamp=stamp;
  // Everybody enters the scene; cursor capture may require a browser gesture.
  // Returning focus never triggers a new automatic cursor capture.
  if(document.hasFocus()&&!document.hidden&&!active)void captureMatchControls();
}
async function deploy(){weaponAudio.unlock();if(networkActive){await captureMatchControls();return;}if(lobby?.room)return;if(!ready){changeCity(city);return;}try{if(!paused){if($('mode').value==='royale')await loadZeppelin();resetRound();}await $('game').requestPointerLock();}catch(e){console.error(e);$('loading').textContent=e.message;}}
$('loadout').addEventListener('change',()=>{if(gunsReady)selectGun(Number($('loadout').value));});
$('play').addEventListener('click',deploy);$('game').addEventListener('click',()=>{if(ready&&!active)deploy();});
$('restart').addEventListener('click',()=>{paused=false;deploy();});
document.querySelectorAll('.map').forEach(b=>b.addEventListener('click',()=>{if(!active)changeCity(b.dataset.map);}));
$('mode').addEventListener('change',()=>{if($('mode').value==='royale')void loadZeppelin().catch(error=>{$('loading').textContent=error.message;});paused=false;$('play').textContent='DEPLOY TO '+ARENAS[city].name.toUpperCase();});
document.addEventListener('pointerlockchange',()=>{
  active=document.pointerLockElement===$('game');document.body.classList.toggle('playing',active);$('menu').hidden=active;$('hud').hidden=!active;weapon.visible=active&&!thirdPerson;
  keys.clear();shooting=false;aim=false;scope.hidden=true;document.body.classList.remove('aim');
  if(!active){clearShotEffects();groundJump.reset();velocity.set(0,0,0);}
  if(!networkActive&&!networkLoading&&!active&&ready){paused=true;$('play').textContent='RESUME EXERCISE';$('loading').textContent='Paused · Choose a different city or resume';}
  $('restart').hidden=!paused;refreshMatchScreen();
});
document.addEventListener('mousemove',e=>{if(active){yaw-=e.movementX*.002*(1-simulation.ads*(1-(simulation.guns?.[gunIndex]?.adsFov??GUNS[gunIndex].adsFov)/78));pitch=THREE.MathUtils.clamp(pitch-e.movementY*.002*(1-simulation.ads*(1-(simulation.guns?.[gunIndex]?.adsFov??GUNS[gunIndex].adsFov)/78)),-1.45,1.45);}});
document.addEventListener('keydown',e=>{if(!active||!canPlayInput())return;if(['Space','KeyW','KeyA','KeyS','KeyD','KeyC'].includes(e.code))e.preventDefault();keys.add(e.code);if(e.code==='KeyC'&&!e.repeat&&hp>0&&(!isRoyale()||royaleDeployment==='landed')){crouchToggle=!crouchToggle;}if(e.code==='Tab'&&networkActive){e.preventDefault();$('match-scoreboard').hidden=false;}if(!e.repeat&&['Digit3','Digit4','Digit5'].includes(e.code))activateStreak(REWARDS[Number(e.code.slice(-1))-3].id);if(e.code==='KeyV'){thirdPerson=!thirdPerson;notify(thirdPerson?'THIRD PERSON':'FIRST PERSON',1);}if(e.code==='KeyR')reload();if(e.code==='KeyQ'&&!e.repeat&&hp>0){e.preventDefault();quickKnife();}if(['Digit1','Digit2','Digit6','Digit7'].includes(e.code)){if(selectGun(networkActive&&!isCoop()?(e.code==='Digit1'?(networkClass?.primary??0):e.code==='Digit2'?(networkClass?.secondary??1):-1):['Digit1','Digit2','Digit6','Digit7'].indexOf(e.code))!==false)notify(GUNS[gunIndex].name+' EQUIPPED');}if(e.code==='KeyF'&&!networkActive&&!combat?.survival&&!isRoyale()){player.copy(spawn);vertical=0;notify('RETURNED TO DEPLOYMENT');}if(isRoyale()&&hp<=0&&['KeyQ','KeyE'].includes(e.code)&&!e.repeat)spectateIndex+=e.code==='KeyE'?1:-1;if(e.code==='Space'&&isRoyale()&&royaleDeployment==='aboard'){jumpRoyale();}else if(e.code==='Space'&&!e.repeat&&hp>0&&(!isRoyale()||royaleDeployment==='landed')){crouchToggle=false;groundJump.press(elapsed);}});
document.addEventListener('keyup',e=>{keys.delete(e.code);if(e.code==='Tab')$('match-scoreboard').hidden=true;});
document.addEventListener('mousedown',e=>{if(!active||!canPlayInput())return;if(e.button===0)shooting=true;if(e.button===2){aim=true;document.body.classList.add('aim');}});
document.addEventListener('mouseup',e=>{if(e.button===0){shooting=false;simulation.releaseTrigger();}if(e.button===2){aim=false;document.body.classList.remove('aim');}});
function releaseMouse(){groundJump.reset();velocity.set(0,0,0);if(isCoop())combat?.survival?.cancel();weaponAudio.stopAll();$('match-scoreboard').hidden=true;keys.clear();shooting=false;aim=false;scope.hidden=true;if(document.pointerLockElement)document.exitPointerLock();}
document.addEventListener('keydown',e=>{if(e.code==='Escape')releaseMouse();});
document.addEventListener('contextmenu',e=>e.preventDefault());window.addEventListener('blur',releaseMouse);
document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseMouse();refreshMatchScreen();});
window.addEventListener('focus',refreshMatchScreen);
let audioCtx;
function sound(type){
  if(type!=='hit')return;
  try{audioCtx??=new AudioContext();if(audioCtx.state==='suspended')audioCtx.resume();const t=audioCtx.currentTime,osc=audioCtx.createOscillator(),gain=audioCtx.createGain();osc.connect(gain);gain.connect(audioCtx.destination);osc.type='sine';osc.frequency.setValueAtTime(950,t);osc.frequency.exponentialRampToValueAtTime(120,t+.12);gain.gain.setValueAtTime(.05,t);gain.gain.exponentialRampToValueAtTime(.001,t+.14);osc.start();osc.stop(t+.15);}catch{}
}
function playWeaponShot(index,position=null){if(!active)return;weaponAudio.shot(index,{remote:!!position,position,listenerPosition:camera.position,listenerQuaternion:camera.quaternion});}

function reload(){if(!canPlayInput())return;if(meleeRemaining()>0||combat?.survival?.recovery||combat?.survival?.reviving)return;if(hp<=0||(isRoyale()&&royaleDeployment!=='landed'))return;if(!simulation.reload())return;if(networkActive)lobby.send({type:'reload'});weaponAudio.reload(gunIndex,{empty:simulation.ammo===0,duration:isShellReload(simulation.gun)?undefined:simulation.reloadDuration});combat?.survival?.onReload({fractionEmpty:1-simulation.ammo/simulation.gun.capacity});notify('RELOADING',simulation.reloadDuration);}
function tracer(from,to,color,originAt=null){tracers.trigger(from,to,color,originAt);}
// Damage keeps its body-origin cover test; visible rounds start at the rendered barrel.
function weaponShotEffect(body,to,unit=null){
  const local=!unit,firstPerson=local&&(!thirdPerson||simulation.ads>.05),gun=local?playerUnit?.gun:unit.gun;
  const tag=firstPerson?flash:gun?.getObjectByName('tag_flash');
  const originAt=tag?()=>tag.getWorldPosition(new THREE.Vector3()):null;
  tracer(body,to,0xffd490,originAt);
  if(!firstPerson){const start=originAt?.()||body;if(!shotBlocked(body,start,shotCover()))worldMuzzle(start,to);}
}
function worldMuzzle(from,to){worldMuzzles.trigger(from);}
function earnStreak(){if(isRoyale())return;for(const reward of streaks.kill())notify(reward.name+' READY / PRESS '+reward.key,3);}
function disposeSentryMesh(mesh){const model=mesh.userData.sentry;mesh.removeFromParent();if(model){model.dispose();return;}mesh.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}
function clearSentry(){if(!sentry)return;disposeSentryMesh(sentry.mesh);sentry=null;}
function activateStreak(id){if(!canPlayInput())return;if(isRoyale()||isCoop())return;
  if(networkActive){lobby.send({type:'streak',id});return;}
  if(!active||hp<=0||combat?.winner||mode==='explore'||!streaks.ready[id])return;
  if(id==='sentry'){
    if(sentry){notify('SENTRY ALREADY DEPLOYED',1);return;}
    const at=player.clone().add(new THREE.Vector3(-Math.sin(yaw)*1.8,0,-Math.cos(yaw)*1.8));const h=floorAt(at.x,at.z,player.y,PLAYER_EYE_HEIGHT+1);
    if(!h||h.face.normal.y<.7||shotBlocked(player,h.point.clone().add(new THREE.Vector3(0,1.1,0)),shotCover())){notify('NO CLEAR SENTRY PLACEMENT',1.5);return;}
    const model=createSentryModel();let mesh,head=null;
    if(model){mesh=model.group;model.setYaw(yawToDirection(-Math.sin(yaw),-Math.cos(yaw)));}
    else{mesh=new THREE.Group();const material=new THREE.MeshStandardMaterial({color:0x434e4b,metalness:.65,roughness:.5});box(mesh,[.18,1.05,.18],[0,.525,0],material);for(const x of [-.4,.4])box(mesh,[.12,.12,.9],[x,.06,0],material);
    head=new THREE.Group();head.position.y=1.15;mesh.add(head);box(head,[.35,.3,.55],[0,0,0],material);box(head,[.09,.09,.65],[0,0,-.55],material);}
    mesh.position.copy(h.point);scene.add(mesh);sentry={mesh,head,model,time:25,cooldown:0};
  }
  streaks.consume(id);
  if(id==='uav'){uavTime=30;notify('UAV ONLINE / 30 SECONDS',3);}
  if(id==='supply'){refillPlayer(false);notify('RESUPPLIED / AMMO AND HEALTH RESTORED',3);}
  if(id==='sentry')notify('SENTRY DEPLOYED / 25 SECONDS',3);
  updateHUD();
}
// The server owns turret targeting and sends no aim; the visual turns toward the nearest enemy in range.
function tickNetworkSentries(dt){
  for(const mesh of networkSentries.values()){const model=mesh.userData.sentry;if(!model)continue;model.update(dt);
    const origin=mesh.position.clone().add(new THREE.Vector3(0,1.15,0));let best=null,bestDistance=1600;
    for(const unit of combat?.units||[]){if(!unit.alive||unit.faction===mesh.userData.team||!unit.mesh?.visible)continue;const distance=unit.mesh.position.distanceToSquared(origin);if(distance<bestDistance){best=unit;bestDistance=distance;}}
    if(best)model.aimAt(origin,best.mesh.position.clone().add(new THREE.Vector3(0,best.actor.height*.65,0)));}
}
function tickStreaks(dt){
  uavTime=Math.max(0,uavTime-dt);if(!sentry)return;
  sentry.model?.update(dt);sentry.time-=dt;sentry.cooldown-=dt;if(sentry.time<=0||combat?.winner){clearSentry();return;}
  const origin=sentry.mesh.position.clone().add(new THREE.Vector3(0,1.15,0));
  const targets=bots.filter(b=>b.alive&&b.faction!==combat.faction).sort((a,b)=>a.mesh.position.distanceToSquared(origin)-b.mesh.position.distanceToSquared(origin));
  for(const target of targets){const to=target.mesh.position.clone().add(new THREE.Vector3(0,target.actor.height*.65,0));if(origin.distanceTo(to)>40||shotBlocked(origin,to,shotCover()))continue;
    if(sentry.model)sentry.model.aimAt(origin,to);else sentry.head.rotation.y=Math.atan2(-(to.x-origin.x),-(to.z-origin.z));
    if(sentry.cooldown<=0){sentry.cooldown=.2;const impact=traceShot(origin,to,shotCover(),bots.filter(b=>b.alive).map(b=>b.mesh));const muzzleAt=sentry.model?sentry.model.muzzleWorld():origin;sentry.model?.fire();tracer(origin,impact.point,0xffcc7e,sentry.model?()=>sentry.model.muzzleWorld():null);worldMuzzle(muzzleAt,to);const victim=impact.hit?.object.userData.bot;if(victim)combat.hit(victim,32,combat.faction);}
    break;
  }
}
function fire(){
  if(!canPlayInput())return;
  if(hp<=0||meleeRemaining()>0||combat?.survival?.recovery||combat?.survival?.reviving||combat?.winner||(isRoyale()&&royaleDeployment!=='landed'))return;if(simulation.ammo<=0){if(simulation.reserve<=0)quickKnife();else reload();return;}const interrupted=simulation.reloadLeft>0;if(!simulation.fire())return;if(interrupted)weaponAudio.cancelReload();combat?.survival?.onShot(gunIndex);recoil=.07;muzzle.trigger(gunIndex);playWeaponShot(gunIndex);
  camera.updateMatrixWorld(true);const spread=THREE.MathUtils.degToRad(spreadDegrees(simulation.gun,simulation.ads,velocity.length())*(combat?.survival?.rules.spreadMultiplier||1)*racialSpread(currentRace()));const radius=Math.tan(spread)*Math.sqrt(Math.random()),angle=Math.random()*Math.PI*2;ray.setFromCamera(new THREE.Vector2(0,0),camera);ray.ray.direction.add(new THREE.Vector3(Math.cos(angle)*radius,Math.sin(angle)*radius,0).applyQuaternion(camera.quaternion)).normalize();ray.far=300;
  // Actor poses can change between fixed steps; city geometry is static.
  const actors=bots.filter(b=>b.alive).map(b=>{b.mesh.updateMatrixWorld(true);return b.mesh;});
  const aimPoint=traceShot(ray.ray.origin,ray.ray.at(300,new THREE.Vector3()),shotCover(),actors).point;
  // Resolve from the player's body, not the offset third-person camera or a barrel poking through cover.
  const origin=stanceEye(player,crouched).add(new THREE.Vector3(0,-.35,0));
  if(networkActive){lobby.send({type:'fire',target:aimPoint.toArray()});viewKick+=(kickAfterShot(viewKick,simulation.gun)-viewKick)*(combat?.survival?.rules.recoilMultiplier||1)*racialRecoil(currentRace());updateHUD();return;}
  // Pellet guns trace one ray per pellet around the (already spread) aim ray; damage is summed per target.
  const gun=simulation.gun,dirs=pelletDirections(gun,ray.ray.direction.toArray(),{ads:simulation.ads,speed:velocity.length()}),struck=new Map(),endpoints=[];
  for(let i=0;i<dirs.length;i++){
    let pelletAim=aimPoint;
    if(dirs.length>1){ray.ray.direction.fromArray(dirs[i]);pelletAim=traceShot(ray.ray.origin,ray.ray.at(300,new THREE.Vector3()),shotCover(),actors).point;}
    const impact=traceShot(origin,pelletAim,shotCover(),actors),hit=impact.hit;endpoints.push(impact.point);
    if(hit){
      const bot=hit.object.userData.bot;
      if(bot){const region=hit.object.userData.characterBody?hitRegion((hit.point.y-bot.mesh.position.y)/playerBodyHeight(bot.actor.height,bot.crouched)):'locGun',entry=struck.get(bot)||{damage:0,head:false,point:hit.point};
        entry.damage+=damageAt(gun,origin.distanceTo(hit.point),region);entry.head=entry.head||region==='locHead';struck.set(bot,entry);}
    }
  }
  for(const [bot,entry] of struck){
    if(combat.playerShot(bot,entry.damage,entry.head)){hitTime=.2;hitPoint.copy(entry.point);sound('hit');}
    else if(bot.faction===combat.faction)notify('FRIENDLY · HOLD FIRE',.7);
    kills=combat.playerKills;
  }
  const endpoint=endpoints[0];for(let i=1;i<tracerCount(gun);i++)tracer(origin,endpoints[i],0xffd490);
  weaponShotEffect(origin,endpoint);viewKick+=(kickAfterShot(viewKick,simulation.gun)-viewKick)*(combat?.survival?.rules.recoilMultiplier||1)*racialRecoil(currentRace());updateHUD();
}
function updateHUD(){
  $('hp').textContent=Math.ceil(hp);$('healthbar').style.width=(hp/healthLimit()*100)+'%';$('rounds').textContent=String(simulation.ammo).padStart(2,'0');$('reserve').textContent=simulation.reserve;
  if(!combat)return;
  streakHud.hidden=mode==='explore'||isRoyale()||isCoop();const nextStreakDisplay='<small>'+streaks.kills+' KILL STREAK'+(uavTime>0?' / UAV '+Math.ceil(uavTime)+'s':'')+'</small>'+REWARDS.map(r=>'<div class="'+(streaks.ready[r.id]?'available':'')+'"><kbd>'+r.key+'</kbd> '+r.name+' <b>'+(streaks.ready[r.id]?'READY x'+streaks.ready[r.id]:r.kills+' KILLS')+'</b></div>').join('');if(nextStreakDisplay!==streakDisplay){streakHud.innerHTML=nextStreakDisplay;streakDisplay=nextStreakDisplay;}
  const identity=FACTIONS[$('faction').value].name+' / '+(characterInfo($('race').value)?.name||'');$('player-identity').textContent=identity.toUpperCase();
  if(isRoyale()){const r=networkActive?lobby.room.royale:soloRoyale?.state;$('kills').textContent=(r?.alive??10)+' ALIVE';$('objective').textContent=r?.winnerName?r.winnerName+' WINS':hp<=0?'Eliminated / Q and E change spectator':'Free-for-all / Last player standing';}
  else if(isCoop()){const r=lobby.room,z=r.zombies;$('kills').textContent='WAVE '+(z?.wave||1)+' / '+r.players.filter(p=>p.status==='alive').length+' STANDING';$('objective').textContent=r.phase==='ended'?'SQUAD OVERRUN / ESC FOR LOBBY':networkStatus==='downed'?'DOWNED / WAIT FOR A TEAMMATE':networkStatus==='dead'?'BLEEDOUT / RETURN NEXT WAVE':z?.countdown>0?(z.wave===1?'PREPARE / WAVE 1 IN ':'WAVE CLEARED / NEXT WAVE IN ')+Math.ceil(z.countdown):((z?.units?.filter(u=>u.alive).length||0)+(z?.queued||0))+' UNDEAD REMAINING / '+kills+' ELIMINATIONS';}
  else if(networkActive){const r=lobby.room;$('kills').textContent='ALLIANCE '+r.score.alliance+' : '+r.score.horde+' HORDE';$('objective').textContent=r.phase==='ended'?(r.winner==='draw'?'DRAW':r.winner.toUpperCase()+' VICTORY / ESC FOR LOBBY'):hp<=0?'RESPAWNING IN '+Math.ceil(combat.playerRespawn):networkShield>0?'SPAWN PROTECTION '+Math.ceil(networkShield)+'s / FIRING ENDS IT':(r.mode==='domination'?'DOMINATION / HOLD A B C / FIRST TO ':'TEAM DEATHMATCH / FIRST TO ')+r.target;}
  else if(mode==='explore'){$('kills').textContent='FREE ROAM';$('objective').textContent='Explore Azeroth · V switches camera';}
  else if(mode==='factions'){$('kills').textContent='ALLIANCE '+combat.score.alliance+' : '+combat.score.horde+' HORDE';$('objective').textContent=combat.winner?FACTIONS[combat.winner].name+' victory':'First faction to 20 · Friendly fire disabled';}
  else{$('kills').textContent='WAVE '+combat.wave;$('objective').textContent=combat.winner?'Overrun · Escape to restart':(bots.filter(b=>b.alive).length+(combat.waveQueue||0))+' undead remaining · '+combat.playerKills+' eliminations';}
}

const characterCollision=new CharacterCollision(PLAYER_EYE_HEIGHT,PLAYER_RADIUS);
function collide(){characterCollision.height=playerEyeHeight(crouched);const delta=characterCollision.resolve(stanceEye(player,crouched),world.collider);if(characterCollision.grounded&&vertical<=0){grounded=true;vertical=0;}if(characterCollision.ceiling&&vertical>0)vertical=0;player.add(delta);}
function resolvePlayerCover(from,to,colliders){return resolveFortificationMove(stanceEye(from,crouched),stanceEye(to,crouched),colliders,PLAYER_RADIUS,playerEyeHeight(crouched)).add(new THREE.Vector3(0,playerHeightOffset(crouched),0));}
function updateCrouch(){
  const before=crouched,fort=combat?.survival?.environment;
  if(isRoyale()&&royaleDeployment!=='landed'){crouched=crouchToggle=false;}
  else if(crouchToggle)crouched=true;
  else if(crouched&&canStandAt(player,world.collider,fort?.movementColliders||[...(fort?.barriers||[]),...(fort?.machineColliders||[])]))crouched=false;
  if(combat)combat.playerCrouched=crouched;
  if(before!==crouched&&networkActive&&lobby?.room?.phase==='playing'){networkPoseTime=0;lobby.send({type:'pose',position:player.toArray(),yaw,pitch,crouched,aim:active&&aim,trigger:active&&shooting});}
}

function move(dt){
  updateCrouch();
  if(isRoyale()&&royaleDeployment!=='landed'){moveRoyaleAir(dt);updateViewPose(dt,false,new THREE.Vector3());weapon.visible=false;$('reticle').style.visibility='hidden';return;}
  const jump=groundJump.update(elapsed,{grounded,vertical,enabled:hp>0&&!crouched&&!combat?.survival?.recovery});if(jump!==null){vertical=jump;grounded=false;}
  const wasGrounded=grounded;if(!grounded)airbornePeak=Math.max(airbornePeak??player.y,player.y);
  const sprint=!crouched&&keys.has('ShiftLeft')&&!aim;let x=active?((keys.has('KeyD')?1:0)-(keys.has('KeyA')?1:0)):0,z=active?((keys.has('KeyS')?1:0)-(keys.has('KeyW')?1:0)):0;
  const v=new THREE.Vector3(x,0,z);if(v.lengthSq())v.normalize();v.applyAxisAngle(new THREE.Vector3(0,1,0),yaw).multiplyScalar((aim?3:sprint?9:5.2)*(crouched?PLAYER_CROUCH_SPEED:1)*(networkActive&&!isCoop()?classSpeed(networkClass):(combat?.survival?.rules.movementMultiplier||1))*racialMovement(currentRace()));
  if(x===0&&z===0)velocity.set(0,0,0);else if(crouched)velocity.copy(v);else velocity.lerp(v,1-Math.exp(-12*dt));
  const steps=4,step=dt/steps;
  for(let i=0;i<steps;i++){
    const fort=combat?.survival?.environment,colliders=fort?.movementColliders||[...(fort?.barriers||[]),...(fort?.machineColliders||[])];
    let next=new THREE.Vector3(player.x+velocity.x*step,player.y,player.z+velocity.z*step);
    if(fort)next=resolvePlayerCover(player,next,colliders);
    const nx=next.x,nz=next.z;
    const support=groundStepHeight(player,next,{grounded,vertical,floorAt,height:PLAYER_EYE_HEIGHT});if(support!==null)player.y=support;
    player.x=nx;player.z=nz;vertical-=20*step;player.y+=vertical*step;grounded=false;collide();
    // Imported city collision can push a capsule into an added cabinet or wall.
    // Alternate the solvers, ending outside fortifications so backing away works.
    if(fort)for(let pass=0;pass<3;pass++){const corrected=resolvePlayerCover(player,player,colliders);if(corrected.distanceToSquared(player)<1e-10)break;player.copy(corrected);if(pass<2)collide();}
  }
  if(player.y<spawn.y-30||player.distanceTo(spawn)>(mode!=='explore'?75:750)){player.copy(spawn);vertical=0;velocity.set(0,0,0);notify(mode!=='explore'?'RETURNED TO COMBAT AREA':'RETURNED TO SAFE GROUND');}
  if(grounded&&!wasGrounded){combat?.survival?.onLand(Math.max(0,(airbornePeak??player.y)-player.y));airbornePeak=null;}else if(!grounded)airbornePeak=Math.max(airbornePeak??player.y,player.y);
  updateViewPose(dt,sprint,v);
  if(combat?.survival?.recovery){weapon.visible=false;scope.hidden=true;}
}
function updateViewPose(dt,sprint=false,v=new THREE.Vector3()){
  viewKick=recoverKick(viewKick,dt);camera.position.copy(stanceEye(player,crouched));camera.rotation.set(THREE.MathUtils.clamp(pitch+viewKick,-1.45,1.45),yaw,0);
  if(thirdPerson&&simulation.ads<.05&&hp>0){const offset=new THREE.Vector3(.6,.35,3.2).applyAxisAngle(new THREE.Vector3(0,1,0),yaw);const distance=offset.length();ray.set(camera.position,offset.normalize());ray.far=distance;const obstruction=ray.intersectObject(world.collider)[0];camera.position.add(offset.multiplyScalar(obstruction?Math.max(.3,obstruction.distance-.2):distance));}
  weapon.visible=active&&!knife.active&&(!thirdPerson||simulation.ads>.05)&&hp>0&&!(GUNS[gunIndex].scope&&simulation.ads>.88);
  if(playerUnit){playerUnit.mesh.position.copy(player).add(new THREE.Vector3(0,-PLAYER_EYE_HEIGHT,0));playerUnit.mesh.rotation.y=yaw+Math.PI;playerUnit.mesh.visible=thirdPerson&&hp>0&&simulation.ads<.05;playerUnit.actor.setCrouched?.(crouched&&hp>0);playerUnit.actor.animate(knife.active?'attack':velocity.length()>.5?(crouched?'walk':'run'):shooting?'shoot':'rifle',knife.active);playerUnit.actor.update(dt);combat.equip(playerUnit);equipKnife(playerUnit,knife.active);}
  const targetFov=THREE.MathUtils.lerp(sprint&&v.lengthSq()>0?85:78,simulation.guns?.[gunIndex]?.adsFov??GUNS[gunIndex].adsFov,simulation.ads);scope.hidden=knife.active||!(GUNS[gunIndex].scope&&simulation.ads>.88);$('reticle').style.visibility=simulation.ads>.7?'hidden':'visible';camera.fov=THREE.MathUtils.lerp(camera.fov,targetFov,1-Math.exp(-12*dt));camera.updateProjectionMatrix();
  const bob=grounded?Math.sin(elapsed*(sprint?14:10))*Math.min(velocity.length(),5)*.0015:0;
  const adsOffset=new THREE.Vector3().fromArray(gunModels[gunIndex].userData.adsOffset);const pose=new THREE.Vector3(.28,-.27+bob,-.35).lerp(adsOffset,simulation.ads);pose.z+=recoil;weapon.position.lerp(pose,1-Math.exp(-24*dt));
  const reloadWave=simulation.reloadLeft?Math.sin((1-simulation.reloadLeft/simulation.reloadDuration)*Math.PI):0;weapon.rotation.set(gunModels[gunIndex].userData.adsPitch*simulation.ads-.55*reloadWave,0,-.45*reloadWave);
  if(isCoop()&&hp<=0){camera.position.y=player.y-PLAYER_EYE_HEIGHT+.75;weapon.visible=false;scope.hidden=true;}
}
function tickBots(dt){if(networkActive)return;combat.tick(dt);bots=combat.units;kills=combat.playerKills;}
function radar(){
  const c=$('radar').getContext('2d'),size=180,now=performance.now();c.globalAlpha=1;c.clearRect(0,0,size,size);c.strokeStyle='#bccdc329';
  for(const r of [30,60,85]){c.beginPath();c.arc(90,90,r,0,Math.PI*2);c.stroke();}
  c.fillStyle='#dac28d';c.beginPath();c.moveTo(90,82);c.lineTo(85,96);c.lineTo(95,96);c.closePath();c.fill();
  for(const b of bots){
    const contact=radarContact(b,{uav:uavTime>0,now});if(!contact)continue;
    const d=new THREE.Vector3().fromArray(contact.position).sub(player).applyAxisAngle(new THREE.Vector3(0,1,0),-yaw);if(Math.hypot(d.x,d.z)>43)continue;
    c.globalAlpha=contact.alpha;c.fillStyle=b.networkFriendly?'#72ddcc':b.faction==='alliance'?'#70b8ff':b.faction==='horde'?'#f06a50':'#b6d97c';c.fillRect(88+d.x*2,88+d.z*2,4,4);
  }
  c.globalAlpha=1;
}
const engineClock=new SimulationClock(performance.now());function frame(now){requestAnimationFrame(frame);const timing=engineClock.advance(now);for(const dt of timing.steps){
  if((active||networkActive&&lobby.room?.phase==='playing')&&world&&canPlayInput()){elapsed+=dt;if(soloRoyale){soloRoyale.tick(dt);royaleDeployment=soloRoyale.deployment;combat.royalePlayerAlive=hp>0&&royaleDeployment==='landed';}simulation.tick(dt,aim&&meleeRemaining()<=0,shooting);if((hp>0||combat?.survival?.recovery?.type==='ghost')&&!combat?.winner)move(dt);else{if(isCoop()){velocity.set(0,0,0);updateViewPose(dt);camera.position.y=player.y-PLAYER_EYE_HEIGHT+.75;}weapon.visible=false;scope.hidden=true;if(playerUnit)playerUnit.mesh.visible=false;}recoil=Math.max(0,recoil-dt);muzzle.update(dt);if(!networkActive)tickStreaks(dt);else tickNetworkSentries(dt);

    world.update(dt);if(simulation.wantsFire(shooting))fire();tickBots(dt);if(!networkActive&&!isRoyale()&&hp>0&&hp<healthLimit()&&elapsed-lastHurt>racialRegenDelay(currentRace())){hp=Math.min(healthLimit(),hp+dt*racialRegenRate(currentRace()));updateHUD();}
    if(noticeTime>0){noticeTime-=dt;if(noticeTime<=0)$('notice').textContent='';}
    hitTime=Math.max(0,hitTime-dt);damageTime=Math.max(0,damageTime-dt);$('damage').style.opacity=damageTime*2;
    $('weapon-state').textContent=meleeRemaining()>0?'KNIFE':simulation.ammo===0&&simulation.reserve===0?'EMPTY / Q KNIFE':simulation.reloadLeft>0?'RELOADING':(simulation.mode==='bolt'||simulation.mode==='pump')&&simulation.cooldown>0?(simulation.mode==='pump'?'PUMPING':'CYCLING BOLT'):simulation.ads>.9?'AIMING':(crouched?'CROUCHED':'READY');const clockTime=isCoop()?(lobby.room.zombies?.elapsed??elapsed):networkActive?lobby.room.remaining:elapsed;$('timer').textContent=String(Math.floor(clockTime/60)).padStart(2,'0')+':'+String(Math.floor(clockTime%60)).padStart(2,'0');
  }
  if(networkActive)tickNetwork(dt);
  knife.update(dt,{visible:active&&hp>0&&!thirdPerson&&!combat?.winner&&!combat?.survival?.recovery});if(knife.active){weapon.visible=false;scope.hidden=true;}
  worldMuzzles.update(dt);muzzleLights.update(dt);tracers.tick(dt);
  for(let i=effects.length-1;i>=0;i--){effects[i].life-=dt;effects[i].update?.(dt);if(effects[i].life<=0){const o=effects[i].object;scene.remove(o);if(effects[i].dispose)effects[i].dispose();else{o.geometry.dispose();o.material.dispose();}effects.splice(i,1);}}
  }
  tracers.update();
  if(active&&world){updateHUD();radar();}
  camera.updateMatrixWorld(true);const marker=hitPoint.clone().project(camera);const showHit=active&&hitTime>0&&marker.z>=-1&&marker.z<=1&&Math.abs(marker.x)<=1&&Math.abs(marker.y)<=1;$('hitmarker').style.opacity=showHit?1:0;if(showHit){$('hitmarker').style.left=(marker.x*.5+.5)*innerWidth+'px';$('hitmarker').style.top=(-marker.y*.5+.5)*innerHeight+'px';}
  refreshMatchScreen();dominationView?.tick(timing.delta);updateRoyaleView(timing.delta);updateOperatorPreview(timing.delta);renderer.render(scene,camera);frameCount++;fpsTime+=timing.delta;if(fpsTime>=1){$('metrics').textContent=Math.round(frameCount/fpsTime)+' FPS · '+renderer.info.render.triangles.toLocaleString()+' TRIANGLES';frameCount=0;fpsTime=0;}
}
window.addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();});
// Read-only state and bounded test controls for local automated smoke checks.
window.azeroth={get state(){return {knife:{active:knife.active,remaining:meleeRemaining(),imported:knife.imported,damage:MELEE.damage,range:MELEE.range},perkModels:perkModelStatus,zeppelin:zeppelinStatus,layout:world?.layout??null,racialTrait:raceTraits(currentRace()),networkStatus,maxHealth:healthLimit(),weaponStats:{name:simulation.gun.name,reserve:simulation.gun.reserve,adsIn:simulation.gun.adsIn,capacity:simulation.gun.capacity,reload:simulation.gun.reload,interval:simulation.gun.interval,damage:simulation.gun.damageCurve[0][1]},audio:weaponAudio.state,royale:networkActive?lobby?.room?.royale:soloRoyale?.state??null,deployment:royaleDeployment,survival:combat?.survival?.state??null,tracers:tracers.visibleWeaponTrails,muzzle:flash.getWorldPosition(new THREE.Vector3()).toArray(),thirdMuzzle:playerUnit?.gun?.getObjectByName('tag_flash')?.getWorldPosition(new THREE.Vector3()).toArray(),network:networkActive,lobby:lobby?.room,networkId:lobby?.id,ready,gunsReady,charactersReady,mode,streak:streaks.kills,rewards:{...streaks.ready},uavTime,sentryActive:!!sentry,faction:$('faction').value,race:$('race').value,thirdPerson,wave:combat?.wave,score:combat?.score,winner:combat?.winner,navNodes:combat?.nav?.reachable.length,gun:GUNS[gunIndex].name,city,active,look:{yaw,pitch,viewKick},hitMarker:hitTime>0?{point:hitPoint.toArray(),remaining:hitTime}:null,playerRespawn:combat?.playerRespawn,position:player.toArray(),spawn:spawn.toArray(),ammo:simulation.ammo,reserve:simulation.reserve,ads:simulation.ads,inputSensitivity:.002*(1-simulation.ads*(1-(simulation.guns?.[gunIndex]?.adsFov??GUNS[gunIndex].adsFov)/78)),fov:camera.fov,scope:!scope.hidden,reloadLeft:simulation.reloadLeft,cooldown:simulation.cooldown,hp,kills,bots:bots.map(b=>({id:b.id,name:b.playerName||b.race,race:b.race,faction:b.faction,height:playerBodyHeight(b.actor.height,b.crouched),crouched:!!b.crouched,position:b.mesh.position.toArray(),alive:b.alive,hp:b.hp,deployment:b.deployment,animation:b.actor.animation})),grounded,crouched,eyeHeight:playerEyeHeight(crouched),props:world?.propCount,propModels:world?.propModels,triangles:world?.triangles};},changeCity,deploy};
const previewRenderer=new THREE.WebGLRenderer({canvas:$('operator-canvas'),antialias:true,alpha:true});previewRenderer.setSize(264,330,false);previewRenderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
const previewScene=new THREE.Scene(),previewCamera=new THREE.PerspectiveCamera(36,264/330,.1,20);previewCamera.position.set(1.3,1.35,4.8);previewCamera.lookAt(0,1.2,0);previewScene.add(new THREE.HemisphereLight(0xffffff,0x536475,3));const previewLight=new THREE.DirectionalLight(0xffffff,2);previewLight.position.set(3,4,5);previewScene.add(previewLight);
function updateRaceOptions(){const f=$('faction').value;$('race').replaceChildren(...FACTIONS[f].races.map(id=>{const o=document.createElement('option');o.value=id;o.textContent=characterInfo(id)?.name||id;return o;}));document.body.dataset.faction=f;}
function selectOperator(){
  if(!charactersReady)return;const id=$('race').value;
  operatorActor?.dispose();operatorActor=createCharacter(id);previewScene.add(operatorActor.root);
  if(playerUnit){playerUnit.knife?.traverse(object=>{if(object.isSkinnedMesh)object.skeleton.dispose();});playerUnit.actor.dispose();if(playerUnit.gun)playerUnit.gun.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.dispose();});scene.remove(playerUnit.mesh);}
  const actor=createCharacter(id),gun=clone(gunModels[gunIndex]);gun.visible=true;gun.rotation.y=-Math.PI/2;actor.root.add(gun);scene.add(actor.root);actor.root.visible=false;playerUnit={actor,mesh:actor.root,gun};
  $('operator-name').textContent=characterInfo(id).name;$('operator-faction').textContent=FACTIONS[$('faction').value].name.toUpperCase();document.body.dataset.faction=$('faction').value;lobby?.renderRacialTrait?.();updateHUD();
}
const operatorHome=document.createComment('operator preview home');$('operator').before(operatorHome);
const armoryRenderer=new THREE.WebGLRenderer({canvas:$('armory-canvas'),antialias:true,alpha:true});armoryRenderer.setPixelRatio(Math.min(devicePixelRatio,1.5));armoryRenderer.outputColorSpace=THREE.SRGBColorSpace;armoryRenderer.toneMapping=THREE.ACESFilmicToneMapping;armoryRenderer.toneMappingExposure=1.3;
const armoryScene=new THREE.Scene(),armoryCamera=new THREE.PerspectiveCamera(34,2,.01,30),armoryPivot=new THREE.Group();armoryScene.add(armoryPivot);armoryScene.add(new THREE.HemisphereLight(0xdff4ff,0x273644,3));const armoryKey=new THREE.DirectionalLight(0xffffff,4);armoryKey.position.set(2,3,2);armoryScene.add(armoryKey);const armoryRim=new THREE.DirectionalLight(0x88cfff,2);armoryRim.position.set(-2,1,-2);armoryScene.add(armoryRim);
let armoryIndex=-1,armoryModel=null,armoryTurn=0,menuMap='';
function fitMenuRenderer(renderer,cam,canvas){const width=Math.max(1,canvas.clientWidth),height=Math.max(1,canvas.clientHeight),size=renderer.getSize(new THREE.Vector2());if(size.x!==width||size.y!==height){renderer.setSize(width,height,false);cam.aspect=width/height;cam.updateProjectionMatrix();}}
function updateOperatorPreview(dt){
  if(inMatchPhase(lobby?.room?.phase))return;
  const lobbyOpen=document.body.classList.contains('lobby-open'),operatorView=lobbyOpen&&lobby?.view==='operator';
  if(operatorView){if($('operator').parentElement!==$('lobby-operator-stage'))$('lobby-operator-stage').append($('operator'));}else if($('operator').parentElement!==document.body)operatorHome.after($('operator'));
  if(operatorActor&&!active&&(!lobbyOpen||operatorView)){fitMenuRenderer(previewRenderer,previewCamera,$('operator-canvas'));operatorActor.update(dt);previewRenderer.render(previewScene,previewCamera);}
  const map=lobby?.room?.city||city;if(map!==menuMap){menuMap=map;$('lobby-map-preview').style.backgroundImage='url(/ui/'+map+'.jpg)';$('lobby-map-preview').setAttribute('aria-label',ARENAS[map].name+' battlefield');$('lobby-map-name').textContent=ARENAS[map].name.toUpperCase();$('lobby-map-location').textContent=ARENAS[map].subtitle.toUpperCase();}
  if(gunsReady&&!active&&lobbyOpen&&lobby?.view==='classes'){
    const index=Number($('class-primary').value);
    if(index!==armoryIndex){armoryIndex=index;if(armoryModel){armoryModel.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.dispose();});armoryModel.removeFromParent();}armoryPivot.rotation.set(0,0,0);armoryModel=clone(gunModels[index]);armoryModel.visible=true;armoryModel.position.set(0,0,0);armoryPivot.add(armoryModel);armoryScene.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(armoryModel),center=bounds.getCenter(new THREE.Vector3()),radius=bounds.getSize(new THREE.Vector3()).length()/2;armoryModel.position.sub(center);armoryCamera.position.copy(new THREE.Vector3(1,.25,.36).normalize().multiplyScalar(radius/Math.sin(THREE.MathUtils.degToRad(17))*1.22));armoryCamera.lookAt(0,0,0);$('armory-weapon-name').textContent=GUNS[index].name;}
    fitMenuRenderer(armoryRenderer,armoryCamera,$('armory-canvas'));armoryTurn+=dt;armoryPivot.rotation.y=matchMedia('(prefers-reduced-motion: reduce)').matches?0:Math.sin(armoryTurn*.25)*.14;
    armoryScene.updateMatrixWorld(true);armoryCamera.zoom=1;armoryCamera.updateProjectionMatrix();armoryCamera.updateMatrixWorld(true);const frameBounds=new THREE.Box3().setFromObject(armoryModel);let extentX=0,extentY=0;for(const x of [frameBounds.min.x,frameBounds.max.x])for(const y of [frameBounds.min.y,frameBounds.max.y])for(const z of [frameBounds.min.z,frameBounds.max.z]){const point=new THREE.Vector3(x,y,z).project(armoryCamera);extentX=Math.max(extentX,Math.abs(point.x));extentY=Math.max(extentY,Math.abs(point.y));}armoryCamera.zoom=Math.min(.82/extentX,.62/extentY);armoryCamera.updateProjectionMatrix();armoryRenderer.render(armoryScene,armoryCamera);
  }
}
$('faction').addEventListener('change',()=>{paused=false;updateRaceOptions();selectOperator();$('play').textContent='DEPLOY TO '+ARENAS[city].name.toUpperCase();});
$('race').addEventListener('change',()=>{paused=false;selectOperator();$('play').textContent='DEPLOY TO '+ARENAS[city].name.toUpperCase();});
function waitForMatchFrame(){return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));}
async function prepareNetwork(room){
  if(networkLoading||!room.layout||room.mode==='zombies'&&!room.zombies?.spawn)return;
  const stamp=matchStamp(room),attempt=++networkLoadAttempt;networkLoading=true;releaseMouse();crouched=crouchToggle=false;networkSpawn=0;networkSurvivalSignature='';networkStatus='alive';
  const progress=(stage,value=loadStageProgress(stage))=>{if(sameDeployment(lobby.room,stamp))lobby.send({type:'load-progress',...stamp,stage,progress:value});};
  progress('Preparing client',.04);
  try{
    if(city!==room.city||!ready||JSON.stringify(world?.layout)!==JSON.stringify(room.layout))await changeCity(room.city,room.layout,progress);progress('Preparing weapons and operators',.9);await assetsReady;if(room.mode==='royale'){progress('Preparing Horde zeppelin',.94);await loadZeppelin();}
    if(attempt!==networkLoadAttempt||!sameDeployment(lobby.room,stamp)||lobby.room.phase!=='loading')return;
    if(!ready||city!==room.city||JSON.stringify(world?.layout)!==JSON.stringify(room.layout))throw Error('City could not be loaded with the host map layout');
    const self=lobby.room.players.find(p=>p.id===lobby.id);$('faction').value=self.team;updateRaceOptions();$('race').value=self.race;selectOperator();
    resetKnife();clearRoyale();setAtmosphere(room.mode==='zombies');combat.reset('explore',self.team,self.race,spawn,yaw);stylePackedWeapons();combat.mode='multiplayer';bots=combat.units;mode='multiplayer';networkActive=true;hp=0;paused=true;clearSentry();streaks.reset();uavTime=0;elapsed=0;if(room.mode==='royale'){royaleDeployment='aboard';ensureRoyaleView();}
    if(room.mode==='zombies'){
      spawn.fromArray(lobby.room.zombies.spawn);combat.spawn.copy(spawn);player.copy(spawn);mode='zombies';combat.mode='zombies';
      combat.nav=new GroundNavigation(spawn,floorAt,blocked);
      combat.survival=new CoopSurvival({combat,scene,spawn,gunModels,city,layout:world.layout,coop:true,getPlayer:()=>player.clone(),getEye:()=>stanceEye(player,crouched),getLook:()=>camera.getWorldDirection(new THREE.Vector3()),isHolding:()=>active&&(hp>0||combat?.survival?.self?.selfRecovery)&&keys.has('KeyE'),notify,sound:survivalSound,worldCollider:world.shotCollider,getGun:()=>gunIndex,getHealth:()=>hp,send:m=>lobby.send(m),getRoom:()=>lobby.room,getId:()=>lobby.id});
      combat.survival.sync(lobby.room.zombies,self);
    }
    document.querySelector('.hud-hint').textContent=room.mode==='zombies'?'HOLD E Revive / Repair / Buy | 1 / 2 / 6 / 7 Owned weapons | Q Knife | C Crouch | R Reload | TAB Squad | ESC Match menu':room.mode==='royale'?'SPACE Jump | WASD Glide / Move | Q Knife | C Crouch | Q / E Spectate when eliminated | 1 / 2 Class weapons | TAB Standings | ESC Match menu':'1 / 2 Class weapons | Q Knife | C Crouch | R Reload | RMB Aim | V Camera | TAB Scoreboard | ESC Match menu';progress('Preparing first frame / keep this tab open',.98);await waitForMatchFrame();if(attempt!==networkLoadAttempt||!sameDeployment(lobby.room,stamp)||lobby.room.phase!=='loading')return;progress('Ready to deploy',1);lobby.send({type:'loaded',...stamp});
  }catch(e){console.error(e);if(sameDeployment(lobby.room,stamp)){lobby.status('Map loading failed: '+e.message);lobby.send({type:'leave'});}}finally{if(attempt===networkLoadAttempt){networkLoading=false;if(networkActive&&lobby.room){syncNetwork(lobby.room);updateViewPose(0);autoDeploy(lobby.room);}refreshMatchScreen();}}
}
function networkGun(unit,index){
  if(unit.networkGun===index)return;if(unit.gun){unit.gun.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.dispose();});unit.gun.removeFromParent();}
  unit.gun=clone(gunModels[index]);unit.gun.visible=unit.alive;unit.gun.rotation.y=-Math.PI/2;unit.mesh.add(unit.gun);unit.networkGun=index;unit.gun.traverse(o=>{if(o.isMesh)o.userData.bot=unit;});
}
function networkName(unit,name){
  if(unit.playerName===name)return;unit.playerName=name;
  const canvas=unit.label.material.map.image,ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#07131bc9';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#'+new THREE.Color(unit.networkFriendly?(unit.networkStatus==='downed'?0xffc568:0x72ddcc):FACTIONS[unit.faction].color).getHexString();ctx.textAlign='center';
  let size=19;ctx.font='bold '+size+'px Segoe UI';while(ctx.measureText(name).width>canvas.width-16&&size>11){size--;ctx.font='bold '+size+'px Segoe UI';}ctx.fillText(name,canvas.width/2,30);unit.label.material.map.needsUpdate=true;
}
function removeNetworkUnit(unit){unit.knife?.traverse(object=>{if(object.isSkinnedMesh)object.skeleton.dispose();});unit.actor.dispose();unit.ring.geometry.dispose();unit.ring.material.dispose();unit.label.material.map.dispose();unit.label.material.dispose();unit.gun?.traverse(o=>{if(o.isSkinnedMesh)o.skeleton.dispose();});unit.mesh.removeFromParent();combat.units.splice(combat.units.indexOf(unit),1);}
function syncDomination(room){
  if(room.mode!=='domination'||!room.domination){if(dominationView){dominationView.dispose();dominationView=null;}renderDominationHud($('domination-hud'),null);return;}
  dominationView??=new DominationView({scene});dominationView.setState(room.domination);
  renderDominationHud($('domination-hud'),dominationHudModel(room.domination,room.score,room.target));
}
function syncNetwork(room){
  if(!networkActive||networkLoading)return;const self=room.players.find(p=>p.id===lobby.id);if(!self)return;
  const coop=room.mode==='zombies',survival=coop?combat.survival:null;
  networkMaxHealth=self.maxHealth??self.survival?.maxHealth??racialMaxHealth(100,self.race);networkStatus=self.status||(self.hp>0?'alive':'dead');
  combat.score=room.score;combat.winner=room.phase==='ended'?room.winner:null;combat.playerRespawn=self.respawn;kills=self.kills;combat.playerKills=self.kills;networkShield=self.shield;
  if(survival){survival.sync(room.zombies,self);combat.wave=room.zombies?.wave||1;combat.waveQueue=room.zombies?.queued||0;combat.countdown=room.zombies?.countdown||0;}
  const signature=coop?JSON.stringify([self.race,self.survival?.owned,self.survival?.perks,self.survival?.packed]):'';
  if(self.spawn!==networkSpawn&&self.hp>0){
    resetKnife();grounded=false;crouched=crouchToggle=!!self.crouched;groundJump.reset();networkSpawn=self.spawn;networkClass=self.loadout;simulation.guns=racialWeapons(coop?survivalWeapons(GUNS,survival.rules):classWeapons(GUNS,networkClass),self.race);simulation.refill();selectGun(self.gun,true);player.fromArray(self.position);velocity.set(0,0,0);vertical=0;yaw=self.yaw;pitch=0;viewKick=0;notify(coop?'DEPLOYED / HOLD TOGETHER':'DEPLOYED / '+networkClass.name.toUpperCase(),2);networkSurvivalSignature=signature;stylePackedWeapons();
  }else if(coop&&signature!==networkSurvivalSignature){networkSurvivalSignature=signature;applySurvivalUpgrades();}
  if(coop&&Number.isInteger(self.gun)&&self.gun!==gunIndex)selectGun(self.gun,true);
  if(room.mode==='royale'){if(self.deployment==='aboard'||(self.deployment==='landed'&&royaleDeployment!=='landed')){player.fromArray(self.position);velocity.set(0,0,0);vertical=0;}else if(self.deployment==='gliding')player.y=self.position[1];royaleDeployment=self.deployment;}
  if(hp>0&&self.hp<=0){crouched=crouchToggle=coop&&!!self.crouched;groundJump.reset();weaponAudio.cancelReload();streaks.death();hitTime=0;viewKick=0;shooting=false;aim=false;keys.delete('Space');velocity.set(0,0,0);survival?.cancel();notify(coop?'DOWNED / YOUR SQUAD CAN REVIVE YOU':room.mode==='royale'?'ELIMINATED / Q AND E TO SPECTATE':'FALLEN / RESPAWNING',3);}
  if(self.hp<hp){lastHurt=elapsed;damageTime=.35;}hp=self.hp;
  const undead=coop?room.zombies?.units||[]:[],ids=new Set([...room.players.map(p=>p.id),...undead.map(u=>u.id)]);
  for(const unit of [...combat.units])if(!ids.has(unit.id))removeNetworkUnit(unit);
  for(const remote of room.players.filter(p=>p.id!==lobby.id)){
    let unit=combat.units.find(b=>b.id===remote.id);
    if(!unit){unit=combat.add(remote.race,remote.team,new THREE.Vector3().fromArray(remote.position).add(new THREE.Vector3(0,-PLAYER_EYE_HEIGHT,0)),combat.units.length);unit.id=remote.id;unit.networkGun=-1;}
    unit.crouched=!!remote.crouched;unit.deployment=remote.deployment;unit.networkStatus=remote.status;unit.networkFriendly=coop;unit.mesh.visible=remote.deployment!=='aboard';const alive=remote.hp>0;if(unit.alive&&!alive)unit.actor.animate('death',true);unit.alive=alive;unit.hp=remote.hp;unit.ring.visible=unit.label.visible=(alive||coop&&remote.status==='downed')&&room.mode!=='royale';networkGun(unit,remote.gun);unit.gun.visible=alive&&!(unit.meleeTime>0);networkName(unit,formatName(remote)+(coop&&remote.status==='downed'?' / REVIVE '+Math.ceil(remote.bleedout)+'s':''));unit.ring.material.opacity=remote.shield>0?.95:.55;unit.ring.material.color.set(coop?(remote.status==='downed'?0xffc568:0x72ddcc):FACTIONS[remote.team].color);
    unit.networkTarget=new THREE.Vector3().fromArray(remote.position).add(new THREE.Vector3(0,-PLAYER_EYE_HEIGHT,0));unit.networkYaw=remote.yaw+Math.PI;
    if(!alive)unit.radarShot=null;
    if(unit.networkSpawn!==remote.spawn){unit.radarShot=null;unit.mesh.position.copy(unit.networkTarget);unit.networkSpawn=remote.spawn;}
  }
  for(const remote of undead){
    let unit=combat.units.find(b=>b.id===remote.id);
    if(!unit){unit=combat.add(remote.race,'scourge',new THREE.Vector3().fromArray(remote.position),combat.units.length,remote.maxHp);unit.id=remote.id;unit.networkZombie=true;}
    if(unit.alive&&!remote.alive)unit.actor.animate('death',true);unit.alive=remote.alive;unit.hp=remote.hp;unit.maxHp=remote.maxHp;unit.networkAnimation=remote.animation;unit.networkTarget=new THREE.Vector3().fromArray(remote.position);unit.networkYaw=remote.yaw;unit.ring.visible=false;unit.label.visible=remote.alive&&survival.rules.perks.has('vulture_aid');
  }
  for(const [id,mesh] of networkSentries)if(!(room.sentries||[]).some(s=>s.id===id)){disposeSentryMesh(mesh);networkSentries.delete(id);}
  for(const turret of room.sentries||[])if(!networkSentries.has(turret.id)){const model=createSentryModel();let mesh;if(model){mesh=model.group;mesh.traverse(o=>{if(o.material?.emissive){o.material.emissive.set(FACTIONS[turret.team].color);o.material.emissiveIntensity=.2;}});}else{mesh=new THREE.Group();const mat=new THREE.MeshStandardMaterial({color:FACTIONS[turret.team].color,metalness:.5,roughness:.6});box(mesh,[.2,1.05,.2],[0,.525,0],mat);box(mesh,[.5,.3,.7],[0,1.15,0],mat);box(mesh,[.1,.1,.6],[0,1.15,-.6],mat);}mesh.userData.team=turret.team;mesh.position.fromArray(turret.position);scene.add(mesh);networkSentries.set(turret.id,mesh);}
  document.querySelector('#match-scoreboard h3').textContent=coop?'UNDEAD CO-OP / SQUAD':room.mode==='royale'?'BATTLE ROYALE / STANDINGS':room.mode==='domination'?'DOMINATION / SCOREBOARD':'TEAM DEATHMATCH / SCOREBOARD';
  const rows=room.players.slice().sort((a,b)=>b.kills-a.kills).map(p=>{const row=document.createElement('div');row.className=p.team;for(const text of [formatName(p),coop?(p.status||'WAITING'):room.mode==='royale'?(p.deployment||'WAITING'):p.team,p.kills+' K',coop?(p.revives||0)+' REVIVES':p.deaths+' D']){const cell=document.createElement('span');cell.textContent=text;row.append(cell);}return row;});$('scoreboard-rows').replaceChildren(...rows);
  syncDomination(room);bots=combat.units;updateHUD();if(!active)updateViewPose(0);
}
function stopNetwork(){
  networkLoadAttempt++;autoDeployStamp='';
  if(!networkActive&&!networkLoading)return;releaseMouse();networkActive=false;networkLoading=false;networkSpawn=0;networkClass=null;networkSurvivalSignature='';networkStatus='alive';crouched=crouchToggle=false;clearBots();simulation.guns=racialWeapons(GUNS,$('race').value);simulation.refill();hp=racialMaxHealth(100,$('race').value);
  for(const mesh of networkSentries.values())disposeSentryMesh(mesh);networkSentries.clear();document.querySelector('.hud-hint').textContent='1 / 2 Rifles | 6 / 7 Snipers | Q Knife | C Crouch | R Reload | RMB Aim | V Camera | ESC Menu | F Reset position';paused=false;mode=$('mode').value;setAtmosphere(true);for(const id of ['faction','race'])$(id).disabled=false;setMenuCamera();
}
function handleNetwork(m){
  if(m.type==='room'){
    matchUI?.setRoom(m.room,lobby.id,{classes:lobby.classes,activeClass:lobby.activeClass});
    const self=m.room.players.find(p=>p.id===lobby.id);
    if(m.room.phase==='waiting'&&self&&($('faction').value!==self.team||$('race').value!==self.race)){$('faction').value=self.team;updateRaceOptions();$('race').value=self.race;selectOperator();}
    if(m.room.phase==='loading'&&!networkActive)prepareNetwork(m.room);
    if(m.room.phase==='waiting'&&(networkActive||networkLoading))stopNetwork();
    syncNetwork(m.room);if(m.room.phase==='ended'&&active)releaseMouse();autoDeploy(m.room);refreshMatchScreen();return;
  }
  if(m.type==='left'||m.type==='disconnected'){stopNetwork();matchUI?.setRoom(null,lobby.id);refreshMatchScreen();return;}
  if(m.type==='enter'){deploy();return;}
  if(!networkActive)return;
  if(m.type==='self'){
    if(isCoop()&&combat.survival&&m.survival){const owner=lobby.room.players.find(p=>p.id===lobby.id);if(owner){Object.assign(owner,{survival:m.survival,status:m.status,bleedout:m.bleedout,revive:m.revive,selfRecovery:m.selfRecovery});if(Number.isInteger(m.gun))owner.gun=m.gun;syncNetwork(lobby.room);}}
    if(Array.isArray(m.inventory)&&m.inventory.length===GUNS.length)simulation.inventory=m.inventory.map(s=>({ammo:s.ammo,reserve:s.reserve}));
    if(Number.isFinite(m.ammo))simulation.ammo=m.ammo;if(Number.isFinite(m.reserve))simulation.reserve=m.reserve;if(Number.isFinite(m.reloadLeft))simulation.reloadLeft=m.reloadLeft;
    if(Number.isFinite(m.meleeLeft)&&m.meleeLeft>0)meleeState.nextAt=Math.max(meleeState.nextAt||0,performance.now()+Math.min(MELEE.cooldown,m.meleeLeft)*1000);
    if(Number.isFinite(m.cooldown))simulation.cooldown=Math.max(active?simulation.cooldown:0,Math.min(20,Math.max(0,m.cooldown)),meleeRemaining());
    streaks.kills=m.streak||0;streaks.ready=m.rewards||{};uavTime=m.uav||0;updateHUD();
  }
  if(m.type==='correct'){if(typeof m.crouched==='boolean')crouched=m.crouched;player.fromArray(m.position);velocity.set(0,0,0);vertical=0;grounded=false;airbornePeak=null;groundJump.reset();}
  if(m.type==='notice')notify(m.message,3);
  if(m.type==='elimination')notify(m.killer+' eliminated '+m.victim,2);
  if(m.type==='zombie-burst'&&isCoop()){
    const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,12,8),new THREE.MeshBasicMaterial({color:m.color,transparent:true,opacity:.16,depthWrite:false}));mesh.position.fromArray(m.position);scene.add(mesh);let left=.5;effects.push({object:mesh,life:.5,update:dt=>{left-=dt;mesh.scale.setScalar(Math.max(.01,m.radius*(1-left/.5)));mesh.material.opacity=Math.max(0,left*.32);}});
  }
  if(m.type==='melee'){
    const unit=bots.find(b=>b.id===m.id);if(unit&&m.id!==lobby.id){unit.meleeTime=.48;unit.attackTime=.48;unit.actor.animate('attack',true);equipKnife(unit,true);}
    if(m.id===lobby.id&&m.hit){hitPoint.fromArray(m.to);hitTime=.2;sound('hit');}
    return;
  }
  if(m.type==='shot'){
    const from=new THREE.Vector3().fromArray(m.from),to=new THREE.Vector3().fromArray(m.to),unit=bots.find(b=>b.id===m.id);
    if(unit&&!m.quiet)recordRadarShot(unit,from);
    if(m.id===lobby.id)weaponShotEffect(from,to);else if(unit?.gun)weaponShotEffect(from,to,unit);else{tracer(from,to,0xffd490);worldMuzzle(from,to);}
    if(Array.isArray(m.tos))for(const end of m.tos.slice(1,3))if(Array.isArray(end)&&end.length===3&&end.every(Number.isFinite))tracer(from,new THREE.Vector3().fromArray(end),0xffd490);
    if(m.id!==lobby.id)playWeaponShot(m.gun??unit?.networkGun??0,from);
    if(unit){unit.attackTime=.15;unit.actor.animate('shoot');}
    if(m.id===lobby.id&&m.hit){hitPoint.copy(to);hitTime=.2;sound('hit');}
  }
}
function tickNetwork(dt){
  networkPoseTime+=dt;const room=lobby.room;if(!room)return;
  if(room.phase==='playing'&&hp>0&&networkPoseTime>=.05){networkPoseTime=0;lobby.send({type:'pose',position:player.toArray(),yaw,pitch,crouched,aim:active&&aim,trigger:active&&shooting});}
  if(isCoop())combat.survival?.tick(dt);
  for(const b of bots){const moving=b.networkTarget&&b.mesh.position.distanceTo(b.networkTarget)>.05;b.actor.setCrouched?.(!!b.crouched&&b.alive);if(b.networkTarget)b.mesh.position.lerp(b.networkTarget,1-Math.exp(-18*dt));b.mesh.rotation.y=b.networkYaw||0;b.meleeTime=Math.max(0,(b.meleeTime||0)-dt);b.attackTime=Math.max(0,b.attackTime-dt);if(b.alive&&b.attackTime<=0)b.actor.animate(b.networkZombie?(b.networkAnimation||(moving?'run':'idle')):moving?(b.crouched?'walk':'run'):'rifle');b.actor.update(dt);combat.equip(b);equipKnife(b,b.alive&&b.meleeTime>0);}
  if(lobby.room.phase!=='playing')world.update(dt);if(!active)updateHUD();
}
lobby=new Lobby(handleNetwork);
const launchParams=new URLSearchParams(location.search),launchCity=launchParams.get('city');
if(launchParams.get('mode')==='explore')$('mode').value='explore';
matchUI=new MatchUI({onResume:()=>void captureMatchControls(),onLeave:()=>lobby.send({type:'leave'}),onReturn:()=>lobby.send({type:'return'}),onTransfer:targetId=>lobby.send({type:'transfer-host',targetId}),onClass:index=>{lobby.selectClass(index);matchUI.setRoom(lobby.room,lobby.id,{classes:lobby.classes,activeClass:lobby.activeClass});}});
requestAnimationFrame(frame);changeCity(Object.hasOwn(ARENAS,launchCity)?launchCity:'stormwind');

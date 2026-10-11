import * as THREE from 'three';
import {SurvivalEffects} from './survival-effects.js';
import {SurvivalRules,waveConfig,WALL_WEAPONS,PERKS_BY_ID,PACK_COST,PACK_AMMO_COST} from './survival-rules.mjs';
import {SurvivalWorld} from './survival-world.js';
import {PLAYER_EYE_HEIGHT} from './player-config.js';
import {COOP_PERKS,coopPerkInfo} from './coop-rules.mjs';
import {racialMaxHealth} from './racial-traits.mjs';
export class Survival {
  constructor({combat,scene,spawn,gunModels,city,layout=null,getPlayer,getEye=getPlayer,getLook,isHolding,notify,sound,worldCollider,coop=false,getGun=()=>0,getHealth=()=>100,setHealth=()=>{},applyUpgrades=()=>{},relocate=()=>{},getAmmo=()=>({capacity:30}),addAmmo=()=>{},resetWeaponLoadout=()=>{},setGhost=()=>{}}){
    Object.assign(this,{combat,scene,spawn:spawn.clone(),getPlayer,getEye,getLook,isHolding,notify,sound,getGun,getHealth,setHealth,applyUpgrades,relocate,getAmmo,addAmmo,resetWeaponLoadout,setGhost,coop});this.rules=new SurvivalRules({coop});this.environment=new SurvivalWorld({scene,nav:combat.nav,spawn,gunModels,city,worldCollider,fortifications:layout?.settings.fortifications,...(coop?{perkDefinitions:COOP_PERKS}:{})});this.rules.zones=new Set(this.environment.unlockedZones);this.edges=combat.nav.nodes.map(n=>[...n.edges]);this.repairTime=0;this.cooldown=0;this.focus=null;this.lastdt=0;this.worldCollider=worldCollider;this.breachNotice=0;
    this.hud=document.createElement('div');this.hud.id='survival-hud';this.hud.innerHTML='<div class="survival-wallet"><small>SALVAGE POINTS</small><strong></strong><span></span></div><div class="survival-interact" hidden><b></b><span></span><i><em></em></i></div><div class="survival-pressure"></div><div class="survival-perks" aria-label="Owned perks"></div><div class="survival-recovery" hidden><strong></strong><span></span><b></b><i><em></em></i></div><div class="survival-powerups"></div>';document.getElementById('hud').append(this.hud);this.effects=new SurvivalEffects(this);this.route();
  }
  get recovery(){return this.effects.recovery;}
  get damageImmune(){return !!this.recovery||this.effects.grace>0;}
  get playerHidden(){return !!this.recovery||this.effects.hidden;}
  onLethal(){return this.effects.onLethal();}
  onShot(index){this.effects.onShot(index);}
  onReload(details){this.effects.onReload(details);}
  onLand(distance){this.effects.onLand(distance);}
  tickEffects(dt){this.effects.tick(dt);}
  route(){const nav=this.combat.nav;for(const n of nav.nodes)n.edges=this.edges[n.id].filter(id=>this.environment.canTraverse(n,nav.nodes[id]));nav.cache.clear();}
  waveSettings(wave){const s=waveConfig(wave);return {...s,spawnInterval:s.entryDelay};}
  startWave(wave){this.rules.resetWave(wave);this.breachNotice=0;}
  nextEntry(){const available=this.environment.activeWindows.filter(w=>!this.combat.units.some(b=>b.alive&&b.entry===w));if(!available.length)return null;return available[Math.floor(Math.random()*available.length)];}
  attackEntry(entry){if(entry.boards<=0)return;this.environment.setBoards(entry,entry.boards-1);this.sound?.('board',entry.inside);if(!entry.boards){this.notify('BARRICADE BREACHED / WATCH YOUR FLANK',2);this.sound?.('breach',entry.inside);}}
  walkEntryPath(unit,path,key){
    let index=unit[key]||0,budget=Math.max(0,this.lastdt)*2.5;
    unit.target=null;if(index<path.length)unit.actor.animate('walk');
    while(index<path.length){
      const target=path[index],delta=target.clone().sub(unit.mesh.position),distance=delta.length();
      if(distance<.001){index++;continue;}
      if(budget<=0)break;
      const step=Math.min(distance,budget,.12),next=unit.mesh.position.clone().addScaledVector(delta,step/distance);
      if(this.environment.canEntryMove&&!this.environment.canEntryMove(unit.entry,unit.mesh.position,next)){unit.actor.animate('idle');break;}
      unit.mesh.lookAt(target.x,unit.mesh.position.y,target.z);unit.mesh.position.copy(next);budget-=step;
      if(step>=distance-.00001)index++;
    }
    unit[key]=index;return index>=path.length;
  }
  approachEntry(unit){return this.walkEntryPath(unit,unit.entry.approachPath||[], 'entryApproachIndex');}
  releaseEntry(unit){
    if(!this.walkEntryPath(unit,unit.entry.releasePath||[unit.entry.inside],'entryReleaseIndex'))return;
    unit.entry=null;unit.waypoint=null;unit.navTimer=0;delete unit.entryApproachIndex;delete unit.entryReleaseIndex;
  }
  awardHit(id,damage,headshot,killed){const gained=this.rules.awardHit(id,{damage,headshot,killed});if(killed&&gained){this.effects.killed(id);this.notify((headshot?'HEADSHOT':'ELIMINATION')+' +'+gained,1);}}
  target(){const player=(this.getEye||this.getPlayer)(),look=this.getLook(),ray=new THREE.Raycaster();let found=null,best=Infinity;for(const item of this.environment.interactions){if(!this.rules.zones.has(item.zone))continue;if(item.type==='gate'&&this.rules.zones.has(item.level??item.zone))continue;if(item.type==='window'&&!this.environment.activeWindows.includes(item.window||item))continue;const pos=item.mesh.position.clone().add(new THREE.Vector3(0,1.7,0)),delta=pos.clone().sub(player),distance=delta.length();if(distance>3.8||distance<.01||delta.normalize().dot(look)<.25)continue;ray.set(player,delta);ray.far=Math.max(0,distance-.2);if(ray.intersectObject(this.worldCollider).length)continue;if(distance<best){best=distance;found=item;}}return found;}
  tick(dt){this.lastdt=dt;const recoveryBefore=this.recovery,stashBefore=this.effects.stash;this.tickEffects(dt);if((recoveryBefore&&!this.recovery)||(stashBefore&&!this.effects.stash))this.requireRelease=true;if(this.recovery||this.combat.winner){this.focus=null;this.draw();return;}if(this.requireRelease){if(this.isHolding()){this.focus=null;this.draw();return;}this.requireRelease=false;}if(this.effects.stash&&this.isHolding()&&this.effects.feet().distanceTo(this.effects.stash.mesh.position)<2.3){this.focus=null;this.draw();return;}this.cooldown=Math.max(0,this.cooldown-dt);const before=this.focus;this.focus=this.target();if(before!==this.focus){this.repairTime=0;this.purchaseHeld=false;}const held=this.isHolding();if(!held){this.repairTime=0;this.purchaseHeld=false;}
    if(held&&this.focus&&this.combat.winner===null){const item=this.focus;
      if(item.type==='window'){const entry=item.window||this.environment.windows.find(w=>w.id===item.id);if(entry&&entry.boards<6){this.repairTime+=dt;if(this.repairTime>=.75){this.repairTime=0;this.environment.setBoards(entry,entry.boards+1);const gained=this.rules.repair(entry.id);this.sound?.('repair',entry.inside);if(gained)this.notify('BARRICADE REPAIRED +'+gained,.65);}}else this.repairTime=0;}
      else if(this.cooldown<=0&&!this.purchaseHeld){this.purchaseHeld=true;this.cooldown=.8;let result;
        if(item.type==='gate'){const level=item.level??item.zone;result=this.rules.openZone(level);if(result.ok){this.environment.openZone(level);this.route();this.notify('ROADBLOCK CLEARED / NEW ENTRANCES ACTIVE',3);this.sound?.('open',item.position);}}
        else if(item.type==='weapon'){const index=item.gunIndex??item.weapon??item.index;result=this.rules.buyWeapon(index,item.zone,this.getGun());if(result.ok){this.applyUpgrades({refillIndex:index,removedIndex:result.replaced});this.notify((result.refill?'AMMO PURCHASED / ':'WEAPON PURCHASED / ')+WALL_WEAPONS[index].name,2);this.sound?.('buy',item.position);}}
        else if(item.type==='perk'){result=this.rules.buyPerk(item.perkId,item.zone);if(result.ok){this.applyUpgrades({});if(item.perkId==='juggernog')this.setHealth(racialMaxHealth(this.rules.maxHealth,this.combat.race));this.notify(PERKS_BY_ID[item.perkId].name.toUpperCase()+' ACQUIRED',2);this.sound?.('buy',item.position);}}
        else if(item.type==='pack'){const index=this.getGun();result=this.rules.packWeapon(index,item.zone);if(result.ok){this.applyUpgrades({refillIndex:index});this.notify('PACK-A-PUNCH / WEAPON UPGRADED',3);this.sound?.('buy',item.position);}}
        if(result&&!result.ok){const messages={'perk-limit':'FOUR PERK LIMIT / CHOOSE YOUR BUILD','already-owned':'PERK ALREADY OWNED','revive-limit':'QUICK REVIVE / THREE PURCHASES USED','already-packed':'WEAPON ALREADY PACKED','weapon-not-owned':'EQUIP AN OWNED WEAPON'};this.notify(result.reason==='insufficient-points'?'NEED '+result.cost+' POINTS':messages[result.reason]||'OPEN THE PREVIOUS AREA FIRST',1);}
      }
    }
    this.draw();
  }
  draw(){
    const e=this.environment,r=this.rules,breached=e.activeWindows.filter(w=>w.boards===0).length;
    this.hud.querySelector('.survival-wallet strong').textContent=r.points.toLocaleString();this.hud.querySelector('.survival-wallet span').textContent='AREA '+(Math.max(...r.zones)+1)+' / 3';
    const pressure=this.hud.querySelector('.survival-pressure');pressure.textContent=breached?breached+' BREACHED ENTRANCE'+(breached===1?'':'S'):'BARRICADES HOLDING';pressure.classList.toggle('danger',!!breached);
    const signature=[...r.perks].join(',');if(signature!==this.perkSignature){this.perkSignature=signature;const row=this.hud.querySelector('.survival-perks');row.replaceChildren();for(const id of r.perks){const perk=this.coop?coopPerkInfo(id):PERKS_BY_ID[id];if(!perk)continue;const icon=document.createElement('div');icon.className='survival-perk';icon.style.setProperty('--perk-color',perk.color);icon.title=perk.description;const short=document.createElement('b'),name=document.createElement('span');short.textContent=perk.short;name.textContent=perk.name;icon.append(short,name);row.append(icon);}}
    const recovery=this.recovery,stash=this.effects.stash,restoring=!!recovery||!!stash,box=this.hud.querySelector('.survival-recovery');box.hidden=!restoring;
    if(restoring){const type=recovery?.type||'stash',required=recovery?.required??2,titles={ghost:"WHO'S WHO / RECOVER YOUR BODY",quick:'QUICK REVIVE / RECOVERING',tombstone:'TOMBSTONE / RETURNING',stash:'TOMBSTONE / RECOVER YOUR EQUIPMENT'},details={ghost:'WASD TO MOVE / FIND YOUR BODY AND HOLD E FOR '+required+' SECONDS',quick:'SELF REVIVE IN PROGRESS / ALL PERKS ARE LOST',tombstone:'RETURNING WITH AN-94 / YOUR STASH WILL LAST 45 SECONDS',stash:'RETURN TO THE GOLD STASH / HOLD E FOR 1 SECOND'};box.querySelector('strong').textContent=titles[type];box.querySelector('span').textContent=details[type];box.querySelector('b').textContent=Math.ceil((recovery||stash).left)+'s';box.querySelector('em').style.width=Math.min(100,((recovery||stash).hold||0)/(type==='ghost'?required:1)*100)+'%';}
    this.hud.querySelector('.survival-powerups').textContent=this.effects.hidden?'VULTURE MIST / HIDDEN FROM UNDEAD':r.perks.has('vulture_aid')?'VULTURE AID / ENEMIES MARKED / COLLECT KILL DROPS':'';
    const panel=this.hud.querySelector('.survival-interact');panel.hidden=!this.focus||!!recovery;if(panel.hidden)return;const i=this.focus;let title='',hint='HOLD E TO INTERACT';
    if(i.type==='window'){const w=i.window||e.windows.find(w=>w.id===i.id);title='REBUILD BARRICADE / '+w.boards+' OF 6 BOARDS';hint=w.boards<6?'HOLD E / REPAIR +10':'BARRICADE SECURE';}
    else if(i.type==='gate'){const level=i.level??i.zone;title='CLEAR ROADBLOCK / '+i.cost+' POINTS';hint='HOLD E / OPEN AREA '+(level+1);}
    else if(i.type==='perk'){const perk=this.coop?coopPerkInfo(i.perkId):PERKS_BY_ID[i.perkId];title=perk.name+' / '+perk.cost+' POINTS';hint=r.perks.has(i.perkId)?'OWNED / '+perk.description:'HOLD E / '+perk.description;}
    else if(i.type==='pack'){title='PACK-A-PUNCH / '+PACK_COST+' POINTS';hint=r.packed.has(this.getGun())?'CURRENT WEAPON ALREADY UPGRADED':'HOLD E / UPGRADE YOUR CURRENT WEAPON';}
    else{const index=i.gunIndex??i.weapon??i.index,owned=r.owned.has(index),w=WALL_WEAPONS[index];title=w.name+' / '+(owned?(r.packed.has(index)?PACK_AMMO_COST:Math.round(w.cost*.4)):w.cost)+' POINTS';hint=owned?'HOLD E / BUY AMMUNITION':r.owned.size>=r.weaponCapacity?'HOLD E / REPLACE YOUR CURRENT WEAPON':'HOLD E / BUY WEAPON';}
    panel.querySelector('b').textContent=title;panel.querySelector('span').textContent=hint;panel.querySelector('em').style.width=(this.repairTime/.75*100)+'%';
  }
  get state(){return {perks:[...this.rules.perks],packed:[...this.rules.packed],revivePurchases:this.rules.revivePurchases,weaponCapacity:this.rules.weaponCapacity,...this.effects.state,points:this.rules.points,owned:[...this.rules.owned],zones:[...this.rules.zones],queued:this.combat.waveQueue,focus:this.focus?.id,windows:this.environment.windows.map(w=>({id:w.id,zone:w.zone,boards:w.boards,retired:!!w.retired,spawnPoint:w.spawnPoint?.toArray(),inside:w.inside.toArray(),outside:w.outside.toArray()})),interactions:this.environment.interactions.map(i=>({id:i.id,type:i.type,perkId:i.perkId,cost:i.cost,zone:i.zone,level:i.level,position:i.position.toArray()}))};}
  dispose(){this.effects.dispose();this.hud.remove();this.environment.dispose();for(const n of this.combat.nav.nodes)n.edges=this.edges[n.id];this.combat.nav.cache.clear();}
}

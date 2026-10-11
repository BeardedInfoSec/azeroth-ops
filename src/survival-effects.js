import * as THREE from 'three';
import {createCharacter} from './characters.js';
import {PLAYER_EYE_HEIGHT} from './player-config.js';
import {racialMaxHealth,racialReviveDuration} from './racial-traits.mjs';

export class SurvivalEffects{
  constructor(owner){this.owner=owner;this.recovery=null;this.grace=0;this.stash=null;this.pickups=[];this.clouds=[];this.bursts=[];this.markers=new Map();this.machineMarkers=new Map();this.geometries=new Set();this.materials=new Set();this.group=new THREE.Group();this.group.name='Survival perk effects';owner.scene.add(this.group);this.hidden=false;this.dropSerial=0;this.cherrySpent=new Set();}
  mesh(geometry,color,opacity=1){const material=new THREE.MeshBasicMaterial({color,transparent:opacity<1,opacity,depthWrite:opacity===1});this.geometries.add(geometry);this.materials.add(material);const mesh=new THREE.Mesh(geometry,material);mesh.raycast=()=>{};return mesh;}
  remove(object){if(!object)return;object.removeFromParent();object.traverse(child=>{if(this.geometries.delete(child.geometry))child.geometry.dispose();for(const m of [].concat(child.material||[]))if(this.materials.delete(m))m.dispose();});}
  feet(){return this.owner.getPlayer().clone().add(new THREE.Vector3(0,-PLAYER_EYE_HEIGHT,0));}
  clearBody(){if(this.bodyActor){this.bodyActor.dispose();this.bodyActor.root.removeFromParent();this.bodyActor=null;}this.remove(this.bodyMarker);this.bodyMarker=null;}
  body(position){this.clearBody();this.bodyActor=createCharacter(this.owner.combat.race);this.bodyActor.root.position.copy(position).y-=PLAYER_EYE_HEIGHT;this.bodyActor.animate('death',true);this.group.add(this.bodyActor.root);this.bodyMarker=this.mesh(new THREE.OctahedronGeometry(.28),0x68e0df);this.bodyMarker.position.copy(position);this.group.add(this.bodyMarker);}
  onLethal(){
    const o=this.owner,r=o.rules;if(this.recovery)return true;const snapshot=r.snapshotLoadout(),perks=new Set(snapshot.perks),body=o.getPlayer().clone();if(!['whos_who','quick_revive','tombstone'].some(id=>perks.has(id)))return false;
    const recovery={type:'',left:0,hold:0,required:racialReviveDuration(2,o.combat.race),body,snapshot,consumed:[]};o.setHealth(0);
    if(perks.has('whos_who')){recovery.type='ghost';recovery.left=15;recovery.consumed.push('whos_who');r.consumePerk('whos_who');this.recovery=recovery;this.body(body);o.setGhost?.(true);const point=o.combat.nav.reachable.map(n=>n.point).filter(p=>o.environment.isAccessible(p)&&p.distanceTo(this.feet())>=8&&p.distanceTo(this.feet())<17).sort((a,b)=>a.distanceTo(o.spawn)-b.distanceTo(o.spawn))[0]||o.spawn.clone().add(new THREE.Vector3(0,-PLAYER_EYE_HEIGHT,0));o.relocate(point.clone().add(new THREE.Vector3(0,PLAYER_EYE_HEIGHT,0)));o.applyUpgrades({});o.notify("WHO'S WHO / FIND YOUR BODY / HOLD E TO REVIVE",5);}
    else this.fallback(recovery);return true;
  }
  fallback(recovery){
    const o=this.owner,r=o.rules;this.clearBody();o.setGhost?.(false);const perks=new Set(recovery.snapshot.perks);
    if(perks.has('quick_revive')&&!recovery.consumed.includes('quick_revive')){recovery.type='quick';recovery.left=racialReviveDuration(4,o.combat.race);recovery.hold=0;recovery.consumed.push('quick_revive');r.losePerks();o.applyUpgrades({});o.notify('QUICK REVIVE / RECOVERING / PERKS LOST',recovery.left);this.recovery=recovery;}
    else if(perks.has('tombstone')&&!recovery.consumed.includes('tombstone')){recovery.type='tombstone';recovery.left=racialReviveDuration(4,o.combat.race);recovery.hold=0;recovery.consumed.push('tombstone');r.resetLoadout();o.resetWeaponLoadout();o.applyUpgrades({});this.recovery=recovery;o.notify('TOMBSTONE / RETURNING WITH STARTER WEAPON',recovery.left);}
    else{this.recovery=null;o.setHealth(0);o.combat.playerDown();o.notify('REVIVAL FAILED / OVERRUN',5);}
  }
  restore(recovery){const o=this.owner;o.rules.restoreLoadout(recovery.snapshot,{excludePerks:recovery.consumed});o.applyUpgrades({});o.relocate(recovery.body.clone());o.setGhost?.(false);o.setHealth(racialMaxHealth(o.rules.maxHealth,o.combat.race));this.grace=2;this.recovery=null;this.clearBody();o.notify('SELF REVIVE / EQUIPMENT RECOVERED',3);}
  createStash(recovery){if(this.stash)this.remove(this.stash.mesh);const mesh=this.mesh(new THREE.BoxGeometry(.7,.5,.5),0xd9c77b);mesh.position.copy(recovery.body).y-=PLAYER_EYE_HEIGHT-.3;this.group.add(mesh);this.stash={position:recovery.body.clone(),snapshot:recovery.snapshot,consumed:recovery.consumed,left:45,hold:0,mesh};}
  burst(radius,damage,color,stun=0){
    const o=this.owner;if(this.recovery||o.getHealth()<=0)return 0;const center=this.feet().add(new THREE.Vector3(0,1,0));let count=0;
    for(const unit of [...o.combat.units]){if(!unit.alive)continue;const target=unit.mesh.position.clone().add(new THREE.Vector3(0,unit.actor.height*.6,0));if(center.distanceTo(target)>radius||o.combat.shotBlocked(center,target))continue;unit.stunLeft=Math.max(unit.stunLeft||0,stun);if(o.combat.playerShot(unit,damage,false))count++;}
    const mesh=this.mesh(new THREE.SphereGeometry(1,20,10),color,.18);mesh.position.copy(center);this.group.add(mesh);this.bursts.push({mesh,radius,left:.5});return count;
  }
  onShot(index){this.cherrySpent.delete(index);}
  onReload({fractionEmpty=0}={}){if(!this.owner.rules.perks.has('electric_cherry')||this.recovery||this.owner.getHealth()<=0)return;const index=this.owner.getGun?.()??0;if(this.cherrySpent.has(index))return;this.cherrySpent.add(index);const fraction=THREE.MathUtils.clamp(fractionEmpty,0,1);this.burst(2+fraction*3,20+fraction*80,0xae90ff,2);}
  onLand(distance){if(distance>=1.2&&this.owner.rules.perks.has('phd_flopper')){this.burst(5,150,0xc18cff);this.owner.notify('PHD / LANDING BLAST',1);}}
  killed(id){
    if(!this.owner.rules.perks.has('vulture_aid'))return;const unit=this.owner.combat.units.find(u=>u.id===id);if(!unit)return;
    const type=Math.random()<.5?'ammo':'points',mesh=this.mesh(new THREE.OctahedronGeometry(.22),type==='ammo'?0x8fd4ab:0xf0ca72);mesh.position.copy(unit.mesh.position).y+=.5;this.group.add(mesh);this.pickups.push({id:++this.dropSerial,type,position:unit.mesh.position.clone(),left:25,mesh});
    if(Math.random()<.2){const mist=this.mesh(new THREE.SphereGeometry(3,16,10),0x5cad54,.13);mist.position.copy(unit.mesh.position).y+=1;mist.scale.y=.6;this.group.add(mist);this.clouds.push({position:unit.mesh.position.clone(),left:10,mesh:mist});}
  }
  tick(dt){
    const o=this.owner,r=o.rules;this.grace=Math.max(0,this.grace-dt);this.bodyActor?.update(dt);if(this.bodyMarker)this.bodyMarker.rotation.y+=dt;
    if(this.recovery){const recovery=this.recovery;recovery.left=Math.max(0,recovery.left-dt);
      if(recovery.type==='ghost'){const near=this.feet().distanceTo(recovery.body.clone().add(new THREE.Vector3(0,-PLAYER_EYE_HEIGHT,0)))<2.4;recovery.hold=near&&o.isHolding()?recovery.hold+dt:0;if(recovery.hold>=(recovery.required??2))this.restore(recovery);else if(recovery.left<=0)this.fallback(recovery);}
      else if(recovery.left<=0){if(recovery.type==='tombstone'){this.createStash(recovery);o.relocate(o.spawn.clone());}else o.relocate(recovery.body.clone());this.recovery=null;this.grace=2;o.setHealth(racialMaxHealth(r.maxHealth,o.combat.race));o.setGhost?.(false);o.notify(recovery.type==='tombstone'?'RETURNED / RECOVER YOUR STASH IN 45 SECONDS':'REVIVED / PERKS LOST',4);}
    }
    if(this.stash){const stash=this.stash;stash.left-=dt;stash.mesh.rotation.y+=dt*.6;const near=this.feet().distanceTo(stash.mesh.position)<2.3;stash.hold=!this.recovery&&o.getHealth()>0&&near&&o.isHolding()?stash.hold+dt:0;
      if(stash.hold>=1){r.restoreLoadout(stash.snapshot,{excludePerks:stash.consumed});o.applyUpgrades({});o.setHealth(Math.min(o.getHealth(),racialMaxHealth(r.maxHealth,o.combat.race)));this.remove(stash.mesh);this.stash=null;o.notify('TOMBSTONE / EQUIPMENT RECOVERED',3);}else if(stash.left<=0){this.remove(stash.mesh);this.stash=null;o.notify('TOMBSTONE STASH EXPIRED',2);}}
    for(const pickup of this.pickups){pickup.left-=dt;pickup.mesh.rotation.y+=dt*2;if(pickup.left>0&&!this.recovery&&o.getHealth()>0&&this.feet().distanceTo(pickup.position)<1.5){if(pickup.type==='points'){r.points+=50;o.notify('VULTURE AID / +50 POINTS',1);}else{const ammo=o.getAmmo();o.addAmmo(ammo.capacity);o.notify('VULTURE AID / AMMUNITION',1);}pickup.left=0;}if(pickup.left<=0)this.remove(pickup.mesh);}this.pickups=this.pickups.filter(p=>p.left>0);
    this.hidden=false;for(const cloud of this.clouds){cloud.left-=dt;cloud.mesh.material.opacity=Math.min(.13,cloud.left*.05);if(cloud.left>0&&r.perks.has('vulture_aid')&&this.feet().distanceTo(cloud.position)<3)this.hidden=true;if(cloud.left<=0)this.remove(cloud.mesh);}this.clouds=this.clouds.filter(c=>c.left>0);
    for(const burst of this.bursts){burst.left-=dt;burst.mesh.scale.setScalar(burst.radius*(1-burst.left/.5));burst.mesh.material.opacity=Math.max(0,burst.left*.35);if(burst.left<=0)this.remove(burst.mesh);}this.bursts=this.bursts.filter(b=>b.left>0);
    const reveal=r.perks.has('vulture_aid');for(const unit of o.combat.units){let marker=this.markers.get(unit.id);if(reveal&&unit.alive){if(!marker){marker=this.mesh(new THREE.OctahedronGeometry(.13),0xd6ef8b);marker.material.depthTest=false;marker.material.depthWrite=false;marker.renderOrder=10;this.markers.set(unit.id,marker);this.group.add(marker);}marker.position.copy(unit.mesh.position).y+=unit.actor.height+.3;}else if(marker){this.remove(marker);this.markers.delete(unit.id);}}
    for(const [id,marker] of this.markers)if(!o.combat.units.some(u=>u.id===id)){this.remove(marker);this.markers.delete(id);}
    const revealed=new Set();if(reveal)for(const item of o.environment.interactions||[]){if(!['perk','pack','weapon'].includes(item.type)||!r.zones.has(item.zone))continue;revealed.add(item.id);let marker=this.machineMarkers.get(item.id);if(!marker){marker=this.mesh(new THREE.BoxGeometry(.2,.2,.2),0x72d7fa);marker.name='Vulture equipment marker';marker.material.depthTest=false;marker.material.depthWrite=false;marker.renderOrder=10;this.machineMarkers.set(item.id,marker);this.group.add(marker);}marker.position.copy(item.mesh?.position||item.position).y+=3.1;marker.rotation.y+=dt;}
    for(const [id,marker] of this.machineMarkers)if(!revealed.has(id)){this.remove(marker);this.machineMarkers.delete(id);}
  }
  get state(){return {machineMarkers:this.machineMarkers.size,grace:this.grace,recovery:this.recovery?{type:this.recovery.type,left:this.recovery.left,hold:this.recovery.hold,body:this.recovery.body.toArray()}:null,stash:this.stash?{position:this.stash.position.toArray(),left:this.stash.left,hold:this.stash.hold}:null,pickups:this.pickups.map(p=>({id:p.id,type:p.type,position:p.position.toArray(),left:p.left})),clouds:this.clouds.map(c=>({position:c.position.toArray(),left:c.left})),hidden:this.hidden};}
  dispose(){this.clearBody();this.group.removeFromParent();for(const geometry of this.geometries)geometry.dispose();for(const material of this.materials)material.dispose();this.geometries.clear();this.materials.clear();this.owner.setGhost?.(false);}
}

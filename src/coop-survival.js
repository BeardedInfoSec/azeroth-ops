import * as THREE from 'three';
import {Survival} from './survival.js';
import {PLAYER_EYE_HEIGHT} from './player-config.js';

// Presentation for a server-owned survival match. Never invoke the solo
// Survival/SurvivalEffects tick: purchases, damage and recovery are authoritative.
export class CoopSurvival extends Survival {
  constructor(options){
    super(options);Object.assign(this,{send:options.send,getRoom:options.getRoom,getId:options.getId});
    this.cooperative=true;this.self=null;this.snapshot=null;this.inputHeld=false;this.inputTarget=null;this.sendTime=0;this.visuals=new Map();
    this.coopHud=document.createElement('section');this.coopHud.className='coop-hud';this.coopHud.hidden=true;
    this.coopHud.innerHTML='<strong></strong><span></span><div class="coop-revive-progress" role="progressbar" aria-label="Revive progress" aria-valuemin="0" aria-valuemax="100"><i></i></div><small></small>';
    this.hud.append(this.coopHud);
  }
  get recovery(){return null;}
  get reviving(){return this.self?.status==='alive'&&this.getRoom()?.phase==='playing'&&this.isHolding()&&!!this.reviveTarget();}
  get damageImmune(){return true;}
  get playerHidden(){return !!this.self?.survival?.hidden;}
  onLethal(){return false;}
  onShot(){}
  onReload(){}
  onLand(){}
  awardHit(){}
  tickEffects(){}
  sync(snapshot,self){
    this.snapshot=snapshot;this.self=self;
    const r=self?.survival;if(r){
      this.rules.points=r.points??0;this.rules.owned=new Set(r.owned||[0]);this.rules.perks=new Set(r.perks||[]);this.rules.packed=new Set(r.packed||[]);this.rules.revivePurchases=r.revivePurchases||0;
    }
    this.rules.zones=new Set(snapshot?.zones||[0]);this.effects.hidden=!!r?.hidden;
    let routeChanged=false;for(const level of [...this.rules.zones].sort())if(level>0&&!this.environment.unlockedZones.has(level)){this.environment.openZone(level);routeChanged=true;}
    for(const window of snapshot?.windows||[]){const local=this.environment.windows.find(w=>w.id===window.id);if(local)this.environment.setBoards(local,window.boards);}
    if(routeChanged)this.route();
    this.syncVisuals(snapshot);this.draw();
  }
  syncVisuals(snapshot){
    const keep=new Set();
    for(const [type,entries] of [['pickup',snapshot?.pickups],['cloud',snapshot?.clouds],['stash',snapshot?.stashes]])for(const [index,item] of (entries||[]).entries()){
      const key=type+':'+(item.id??item.owner??index);keep.add(key);let mesh=this.visuals.get(key);
      if(!mesh){const geometry=type==='cloud'?new THREE.SphereGeometry(3,12,8):type==='stash'?new THREE.BoxGeometry(.7,.5,.5):new THREE.OctahedronGeometry(.22),color=type==='cloud'?0x5cad54:type==='stash'||item.type==='points'?0xf0ca72:0x8fd4ab;mesh=this.effects.mesh(geometry,color,type==='cloud'?.13:1);if(type==='cloud')mesh.scale.y=.6;this.effects.group.add(mesh);this.visuals.set(key,mesh);}
      mesh.position.fromArray(item.position);mesh.position.y+=type==='cloud'?1:type==='stash'?.3:.5;
    }
    for(const [key,mesh] of this.visuals)if(!keep.has(key)){this.effects.remove(mesh);this.visuals.delete(key);}
  }
  target(){
    const from=(this.getEye||this.getPlayer)(),look=this.getLook();let result=null,distance=3.8;this.environment.shotCollider.updateWorldMatrix(true,true);
    for(const item of this.environment.interactions){
      if(!this.rules.zones.has(item.zone)||item.type==='gate'&&this.rules.zones.has(item.level??item.zone)||item.type==='window'&&!this.environment.activeWindows.includes(item.window||item))continue;
      const to=(item.position||item.mesh.position).clone().add(new THREE.Vector3(0,1.7,0)),delta=to.sub(from),d=delta.length();if(d>=distance||d<.01||delta.clone().normalize().dot(look)<.25)continue;
      const ray=new THREE.Raycaster(from,delta.divideScalar(d),0,d);if(ray.intersectObject(this.worldCollider,true).length)continue;
      const covered=ray.intersectObject(this.environment.shotCollider,true).some(hit=>{for(let parent=hit.object;parent;parent=parent.parent)if(parent===item.mesh)return false;return true;});if(covered)continue;
      result=item;distance=d;
    }
    return result;
  }
  reviveTarget(){
    const feet=this.getPlayer().add(new THREE.Vector3(0,-PLAYER_EYE_HEIGHT,0)),bodyHeight=.9*((this.getEye||this.getPlayer)().y-feet.y)/PLAYER_EYE_HEIGHT;let result=null,distance=2.5;
    for(const target of this.getRoom()?.players||[]){if(target.id===this.getId()||target.status!=='downed')continue;const position=new THREE.Vector3().fromArray(target.position).add(new THREE.Vector3(0,-PLAYER_EYE_HEIGHT,0)),d=feet.distanceTo(position);if(d>distance)continue;
      const from=feet.clone().add(new THREE.Vector3(0,bodyHeight,0)),to=position.clone().add(new THREE.Vector3(0,.6,0)),delta=to.sub(from),ray=new THREE.Raycaster(from,delta.clone().normalize(),0,delta.length());
      this.environment.shotCollider.updateWorldMatrix(true,true);if(ray.intersectObject(this.worldCollider,true).length||ray.intersectObject(this.environment.shotCollider,true).length)continue;
      result=target;distance=d;
    }
    return result;
  }
  stashTarget(){const feet=this.getPlayer().add(new THREE.Vector3(0,-PLAYER_EYE_HEIGHT,0));return this.snapshot?.stashes?.find(stash=>stash.owner===this.getId()&&!stash.waiting&&feet.distanceTo(new THREE.Vector3().fromArray(stash.position))<2.3)||null;}
  cancel(){if(this.inputHeld)this.send({type:'interact',held:false});this.inputHeld=false;this.inputTarget=null;this.sendTime=0;this.repairTime=0;}
  tick(dt){
    const playing=this.getRoom()?.phase==='playing',live=playing&&this.self?.status==='alive',selfRescue=playing&&this.self?.status==='downed'&&this.self?.selfRecovery,revive=live?this.reviveTarget():null,stash=live?this.stashTarget():null;
    this.reviveFocus=revive;this.stashFocus=stash;this.focus=live&&!revive&&!stash?this.target():null;
    const target=selfRescue?this.getId():revive?.id||stash?.id||this.focus?.id||null,held=!!((live||selfRescue)&&this.isHolding()&&target);this.sendTime+=dt;
    if(held!==this.inputHeld||target!==this.inputTarget||held&&this.sendTime>=.15){this.send({type:'interact',held,target:held?target:undefined});this.inputHeld=held;this.inputTarget=target;this.sendTime=0;}
    this.repairTime=held&&this.focus?.type==='window'?(this.repairTime+dt)%.75:0;
    for(const [key,mesh] of this.visuals)if(!key.startsWith('cloud:'))mesh.rotation.y+=dt;
    const reveal=this.rules.perks.has('vulture_aid'),keep=new Set();if(reveal)for(const item of this.environment.interactions){if(!['perk','pack','weapon'].includes(item.type)||!this.rules.zones.has(item.zone))continue;keep.add(item.id);let marker=this.effects.machineMarkers.get(item.id);if(!marker){marker=this.effects.mesh(new THREE.BoxGeometry(.2,.2,.2),0x72d7fa);marker.material.depthTest=false;marker.material.depthWrite=false;marker.renderOrder=10;this.effects.machineMarkers.set(item.id,marker);this.effects.group.add(marker);}marker.position.copy(item.mesh.position).y+=3.1;marker.rotation.y+=dt;}
    for(const [id,mesh] of this.effects.machineMarkers)if(!keep.has(id)){this.effects.remove(mesh);this.effects.machineMarkers.delete(id);}
    const enemies=new Set();for(const unit of this.combat?.units||[]){if(!reveal||!unit.alive||unit.faction!=='scourge')continue;enemies.add(unit.id);let marker=this.effects.markers.get(unit.id);if(!marker){marker=this.effects.mesh(new THREE.OctahedronGeometry(.13),0xd6ef8b);marker.material.depthTest=false;marker.material.depthWrite=false;marker.renderOrder=10;this.effects.markers.set(unit.id,marker);this.effects.group.add(marker);}marker.position.copy(unit.mesh.position).y+=unit.actor.height+.3;}
    for(const [id,mesh] of this.effects.markers||[])if(!enemies.has(id)){this.effects.remove(mesh);this.effects.markers.delete(id);}
    this.draw();
  }
  draw(){
    super.draw();if(!this.coopHud)return;
    const self=this.self,downed=self?.status==='downed',dead=self?.status==='dead',target=this.reviveFocus,revive=downed?self.revive:target?.revive,own=revive?.by===this.getId(),rescue=self?.selfRecovery,stash=this.stashFocus;
    this.coopHud.hidden=!downed&&!dead&&!target&&!stash;if(this.coopHud.hidden)return;
    this.hud.querySelector('.survival-interact').hidden=true;
    const title=this.coopHud.querySelector('strong'),hint=this.coopHud.querySelector('span'),timer=this.coopHud.querySelector('small'),bar=this.coopHud.querySelector('.coop-revive-progress'),amount=Math.min(100,Math.max(0,(revive?.progress||0)/(revive?.duration||4)*100));
    title.textContent=downed?'YOU ARE DOWN':dead?'WAITING FOR THE SQUAD':(own?'REVIVING ':'REVIVE ')+(target?.name||'');
    hint.textContent=downed?(revive?'A TEAMMATE IS REVIVING YOU':'A TEAMMATE CAN HOLD E TO REVIVE YOU'):dead?'RETURN AT THE NEXT WAVE IF YOUR SQUAD SURVIVES':revive&&!own?'ANOTHER TEAMMATE IS REVIVING':'HOLD E / STAY CLOSE AND KEEP CLEAR OF DAMAGE';
    timer.textContent=downed?Math.ceil(self.bleedout||0)+'s UNTIL BLEEDOUT':target?Math.ceil(target.bleedout||0)+'s TO SAVE YOUR TEAMMATE':'';
    bar.hidden=!revive;bar.setAttribute('aria-valuenow',String(Math.round(amount)));bar.querySelector('i').style.width=amount+'%';
    if(downed&&rescue&&!revive){title.textContent="WHO'S WHO / SELF RESCUE";hint.textContent='RELEASE E, THEN HOLD E TO RECOVER / A TEAMMATE CAN STILL REVIVE YOU';timer.textContent=Math.ceil(rescue.left)+'s LEFT / HOLD '+rescue.required.toFixed(1)+'s';bar.hidden=false;const value=Math.min(100,rescue.hold/rescue.required*100);bar.setAttribute('aria-valuenow',String(Math.round(value)));bar.querySelector('i').style.width=value+'%';}
    if(stash&&!downed&&!dead&&!target){title.textContent='TOMBSTONE / RECOVER EQUIPMENT';hint.textContent='HOLD E TO RESTORE YOUR STASH';timer.textContent=Math.ceil(stash.left)+'s LEFT';bar.hidden=false;bar.querySelector('i').style.width=Math.min(100,(stash.hold||0)*100)+'%';}
  }
  get state(){return {...super.state,cooperative:true,status:this.self?.status,bleedout:this.self?.bleedout,revive:this.self?.revive,reviveTarget:this.reviveFocus?.id,serverWave:this.snapshot?.wave};}
  dispose(){this.cancel();super.dispose();}
}

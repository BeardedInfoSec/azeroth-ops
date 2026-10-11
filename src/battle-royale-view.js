import * as THREE from 'three';
import {createZeppelinModel,loadZeppelin} from './zeppelin-model.js';
import {PLAYER_EYE_HEIGHT} from './player-config.js';
export {loadZeppelin,zeppelinStatus} from './zeppelin-model.js';

const vector=value=>Array.isArray(value)?new THREE.Vector3(...value):value?.isVector3?value.clone():new THREE.Vector3();
const time=value=>{const seconds=Math.max(0,Math.ceil(Number(value)||0));return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');};

// Presentation only: flight, circle rules and elimination remain owned by the match.
export class BattleRoyaleView{
  constructor({scene,camera,getPlayer,onJump=()=>{}}){
    Object.assign(this,{scene,camera,getPlayer,onJump});this.state=null;this.deployment={};this.elapsed=0;this.stage=null;this.announcementTime=0;this.disposed=false;
    this.group=new THREE.Group();this.group.name='Battle royale presentation';scene.add(this.group);
    this.materials=new Set();this.geometries=new Set();this.propellers=[];
    this.zeppelin=this.createZeppelin();this.group.add(this.zeppelin);
    this.ready=loadZeppelin().then(()=>{
      if(this.disposed||this.zeppelinModel)return this;
      const model=createZeppelinModel();if(!model)throw new Error('Horde zeppelin model was not prepared');
      const previous=this.zeppelin;model.group.position.copy(previous.position);model.group.quaternion.copy(previous.quaternion);model.group.visible=previous.visible;
      previous.removeFromParent();previous.traverse(object=>{if(object.geometry){this.geometries.delete(object.geometry);object.geometry.dispose();}for(const material of [].concat(object.material||[])){this.materials.delete(material);material.dispose();}});
      this.propellers.length=0;this.zeppelinModel=model;this.zeppelin=model.group;this.group.add(this.zeppelin);return this;
    });
    this.zoneGroup=new THREE.Group();this.zoneGroup.name='Safe zone perimeter';this.group.add(this.zoneGroup);
    this.zoneWall=this.mesh(new THREE.CylinderGeometry(1,1,80,128,1,true),new THREE.MeshBasicMaterial({color:0x729aff,transparent:true,opacity:.075,side:THREE.DoubleSide,depthWrite:false}));this.zoneWall.position.y=30;this.zoneGroup.add(this.zoneWall);
    this.zoneRing=this.mesh(new THREE.RingGeometry(.994,1.006,160),new THREE.MeshBasicMaterial({color:0x9cbeff,transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}));this.zoneRing.rotation.x=-Math.PI/2;this.zoneRing.position.y=.18;this.zoneGroup.add(this.zoneRing);
    this.nextRing=this.lineCircle(0xd7d4ff,.5);this.nextRing.position.y=.22;this.zoneGroup.add(this.nextRing);
    const rays=[];for(let i=0;i<32;i++){const angle=i/32*Math.PI*2,x=Math.cos(angle),z=Math.sin(angle);rays.push(x,-10,z,x,70,z);}
    const rayGeometry=new THREE.BufferGeometry();rayGeometry.setAttribute('position',new THREE.Float32BufferAttribute(rays,3));this.geometries.add(rayGeometry);
    const rayMaterial=new THREE.LineBasicMaterial({color:0x9b8dff,transparent:true,opacity:.13,depthWrite:false});this.materials.add(rayMaterial);this.zoneRays=new THREE.LineSegments(rayGeometry,rayMaterial);this.zoneGroup.add(this.zoneRays);
    this.canopy=this.createCanopy();this.canopy.visible=false;this.group.add(this.canopy);
    this.hud=document.createElement('section');this.hud.id='battle-royale-hud';this.hud.setAttribute('aria-label','Battle royale status');
    this.hud.innerHTML='<div class="br-phase"><small>AZEROTH / LAST OPERATOR STANDING</small><strong></strong><span></span><button type="button"><kbd>SPACE</kbd> JUMP FROM ZEPPELIN</button></div><div class="br-status"><div class="br-alive"><small>OPERATORS ALIVE</small><strong></strong><span>FREE FOR ALL</span></div><div class="br-zone"><small></small><strong></strong><span></span><span class="br-distance"></span></div></div><div class="br-map"><canvas width="240" height="240" aria-label="Your position and the safe zone"></canvas><span>SAFE ZONE / YOU</span></div><div class="br-warning" hidden><strong>OUTSIDE THE SAFE ZONE</strong><span></span></div><div class="br-announcement" aria-live="polite"></div>';
    this.phase=this.hud.querySelector('.br-phase');this.phaseTitle=this.phase.querySelector('strong');this.phaseDetail=this.phase.querySelector('span');this.jumpButton=this.phase.querySelector('button');this.jumpButton.addEventListener('click',()=>this.onJump());
    this.alive=this.hud.querySelector('.br-alive strong');this.zoneText=this.hud.querySelector('.br-zone');this.warning=this.hud.querySelector('.br-warning');this.announcement=this.hud.querySelector('.br-announcement');this.map=this.hud.querySelector('canvas');this.context=this.map.getContext('2d');
    this.hudHost=document.getElementById('hud');this.hudHost?.append(this.hud);this.hudHost?.classList.add('battle-royale-mode');
    this.group.visible=false;
  }
  material(color,extra={}){const material=new THREE.MeshStandardMaterial({color,roughness:.75,metalness:.2,...extra});this.materials.add(material);return material;}
  mesh(geometry,material){this.geometries.add(geometry);this.materials.add(material);const mesh=new THREE.Mesh(geometry,material);mesh.raycast=()=>{};return mesh;}
  box(parent,size,position,material){const mesh=this.mesh(new THREE.BoxGeometry(...size),material);mesh.position.set(...position);parent.add(mesh);return mesh;}
  lineCircle(color,opacity){const points=Array.from({length:160},(_,i)=>new THREE.Vector3(Math.cos(i/160*Math.PI*2),0,Math.sin(i/160*Math.PI*2))),geometry=new THREE.BufferGeometry().setFromPoints(points),material=new THREE.LineDashedMaterial({color,transparent:true,opacity,dashSize:1,gapSize:.7,depthWrite:false});this.geometries.add(geometry);this.materials.add(material);const line=new THREE.LineLoop(geometry,material);line.computeLineDistances();return line;}
  createZeppelin(){
    const original=createZeppelinModel();if(original){this.zeppelinModel=original;return original.group;}
    // Only a loading/failure placeholder. Match readiness awaits the original
    // asset through loadZeppelin(), so normal deployment uses the Horde model.
    const zeppelin=new THREE.Group();zeppelin.name='Azeroth deployment zeppelin';
    const fabric=this.material(0x817049),metal=this.material(0x23313d,{metalness:.65}),wood=this.material(0x704422),blue=this.material(0x548399),gold=this.material(0xd3b672);
    const envelope=this.mesh(new THREE.SphereGeometry(1,32,18),fabric);envelope.scale.set(7,4.4,17);envelope.position.y=7;zeppelin.add(envelope);
    for(const z of [-11,-5,5,11]){const radius=Math.sqrt(1-(z/17)**2),band=this.mesh(new THREE.TorusGeometry(1,.018,6,48),metal);band.scale.set(7*radius,4.4*radius,1);band.position.set(0,7,z);zeppelin.add(band);}
    this.box(zeppelin,[4.4,1.5,11],[0,-1,0],wood);this.box(zeppelin,[4.6,.22,11.4],[0,-.15,0],metal);this.box(zeppelin,[3.5,1.7,2.7],[0,.75,-3.5],blue);
    for(const x of [-2,2])for(const z of [-4,0,4]){const strut=this.mesh(new THREE.CylinderGeometry(.07,.07,4,6),metal);strut.position.set(x,1.7,z);zeppelin.add(strut);}
    for(const x of [-2.2,2.2])this.box(zeppelin,[.1,.1,10],[x,.6,0],gold);
    this.box(zeppelin,[10,.15,4],[0,7,14],blue);this.box(zeppelin,[.18,6,4],[0,8,14],blue);
    for(const x of [-5,5]){this.box(zeppelin,[3,.22,.3],[x*.7,-.15,1],metal);const hub=this.mesh(new THREE.CylinderGeometry(.3,.3,1.4,12),metal);hub.rotation.x=Math.PI/2;hub.position.set(x,0,1);zeppelin.add(hub);const propeller=new THREE.Group();propeller.position.set(x,0,.25);for(const rotation of [0,Math.PI/2]){const blade=this.box(propeller,[3.6,.17,.14],[0,0,0],gold);blade.rotation.z=rotation;}zeppelin.add(propeller);this.propellers.push(propeller);}
    const root=new THREE.Group();root.name='Loading Horde zeppelin';zeppelin.position.y=.15-PLAYER_EYE_HEIGHT;root.add(zeppelin);return root;
  }
  createCanopy(){
    const canopy=new THREE.Group();canopy.name='Local parachute';const cloth=this.material(0x7996a4,{side:THREE.DoubleSide}),rope=this.material(0xd8caa7);
    const dome=this.mesh(new THREE.SphereGeometry(2.8,20,8,0,Math.PI*2,0,Math.PI/2),cloth);dome.scale.y=.45;canopy.add(dome);
    for(const x of [-1.8,1.8])for(const z of [-1.2,1.2]){const line=this.mesh(new THREE.CylinderGeometry(.012,.012,3,4),rope);line.position.set(x*.5,-1.4,z*.5);const direction=new THREE.Vector3(x,2.8,z).normalize();line.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction);canopy.add(line);}
    return canopy;
  }
  setState(state,deployment={}){
    if(this.disposed)return;this.state=state;this.deployment=typeof deployment==='string'?{phase:deployment}:deployment;this.group.visible=!!state;this.hud.hidden=!state;if(!state)return;
    const phase=this.deployment.phase||this.deployment.deployment||'landed',aboard=phase==='aboard',gliding=phase==='gliding',eliminated=phase==='eliminated',ended=state.phase==='ended';
    this.phase.hidden=!(aboard||gliding||eliminated||ended);this.jumpButton.hidden=!aboard||ended;
    this.phaseTitle.textContent=ended?(state.winnerName?state.winnerName+' WINS':'MATCH COMPLETE'):eliminated?'ELIMINATED / SPECTATING':aboard?'CHOOSE YOUR DROP':'PARACHUTE DEPLOYED';
    this.phaseDetail.textContent=ended?'LAST OPERATOR STANDING':eliminated?'Watching the remaining operators':aboard?'Automatic drop in '+time((state.flight?.duration||18)-(state.elapsed||0)):'W A S D / STEER YOUR DESCENT';
    this.phase.classList.toggle('is-eliminated',eliminated);this.phase.classList.toggle('is-ended',ended);this.alive.textContent=String(state.alive??0).padStart(2,'0');
    const zone=state.zone;
    if(zone){const center=vector(zone.center);this.zoneGroup.position.copy(center);this.zoneWall.scale.set(zone.radius,1,zone.radius);this.zoneRing.scale.setScalar(zone.radius);this.zoneRays.scale.set(zone.radius,1,zone.radius);this.nextRing.scale.setScalar(zone.nextRadius??zone.radius);this.nextRing.visible=(zone.nextRadius??zone.radius)<zone.radius;this.zoneGroup.visible=zone.radius>0;
      this.zoneText.querySelector('small').textContent='CIRCLE '+(zone.stage??1)+(zone.shrinking?' / CLOSING':' / NEXT SHRINK');this.zoneText.querySelector('strong').textContent=time(zone.shrinking?(zone.timeToClose??zone.timeToShrink):zone.timeToShrink);this.zoneText.querySelector('span').textContent=Math.round(zone.radius)+' m RADIUS / '+Math.round(zone.nextRadius??zone.radius)+' m NEXT';
      if(this.stage!==null&&this.stage!==zone.stage){this.announcement.textContent='SAFE ZONE UPDATED / MOVE IN';this.announcementTime=4;}this.stage=zone.stage;
    }else this.zoneGroup.visible=false;
    const flight=state.flight;this.zeppelin.visible=!!flight&&state.phase==='flight';if(flight){this.zeppelin.position.copy(vector(flight.position||flight.start));const direction=vector(flight.end).sub(vector(flight.start));this.zeppelin.rotation.y=Math.atan2(-direction.x,-direction.z);}
    this.canopy.visible=gliding&&!!this.deployment.thirdPerson;this.draw();
  }
  draw(){
    if(!this.state?.zone)return;const zone=this.state.zone,player=vector(this.getPlayer?.()||this.deployment.position),center=vector(zone.center),distance=Math.hypot(player.x-center.x,player.z-center.z),outside=distance>zone.radius,phase=this.deployment.phase||this.deployment.deployment;
    this.zoneText.querySelector('.br-distance').textContent=Math.round(distance)+' m TO CIRCLE CENTER';
    this.warning.hidden=!outside||phase==='aboard'||phase==='gliding'||phase==='eliminated'||this.state.phase==='ended';this.warning.querySelector('span').textContent=Math.ceil(Math.max(0,distance-zone.radius))+' m TO SAFETY / '+(zone.damage??0)+' DAMAGE PER SECOND';
    this.canopy.position.copy(player).y+=3.4;
    const ctx=this.context;if(!ctx)return;const size=240,c=120,range=Math.max(zone.radius*1.3,distance*1.15,10),scale=100/range;ctx.clearRect(0,0,size,size);ctx.fillStyle='#081820e6';ctx.beginPath();ctx.arc(c,c,116,0,Math.PI*2);ctx.fill();ctx.save();ctx.beginPath();ctx.arc(c,c,114,0,Math.PI*2);ctx.clip();
    ctx.strokeStyle='#6f8ea326';ctx.lineWidth=1;for(let offset=-80;offset<=80;offset+=40){ctx.beginPath();ctx.moveTo(8,c+offset);ctx.lineTo(232,c+offset);ctx.moveTo(c+offset,8);ctx.lineTo(c+offset,232);ctx.stroke();}
    ctx.fillStyle='#778dff14';ctx.strokeStyle='#a3beff';ctx.lineWidth=2;ctx.beginPath();ctx.arc(c,c,Math.max(0,zone.radius*scale),0,Math.PI*2);ctx.fill();ctx.stroke();ctx.setLineDash([4,4]);ctx.strokeStyle='#a3beff77';ctx.beginPath();ctx.arc(c,c,Math.max(0,(zone.nextRadius??zone.radius)*scale),0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
    const x=c+(player.x-center.x)*scale,y=c+(player.z-center.z)*scale,forward=this.camera?.getWorldDirection(new THREE.Vector3())||new THREE.Vector3(0,0,-1);ctx.save();ctx.translate(x,y);ctx.rotate(Math.atan2(forward.x,-forward.z));ctx.fillStyle=outside?'#ffba93':'#fff0bc';ctx.beginPath();ctx.moveTo(0,-7);ctx.lineTo(5,6);ctx.lineTo(0,3);ctx.lineTo(-5,6);ctx.closePath();ctx.fill();ctx.restore();ctx.restore();ctx.fillStyle='#bed0df';ctx.font='11px sans-serif';ctx.textAlign='center';ctx.fillText('N',120,18);
  }
  tick(dt){if(this.disposed||!this.state)return;this.elapsed+=dt;if(this.zeppelin.visible)this.zeppelinModel?.update(dt);for(const propeller of this.propellers)propeller.rotation.z+=dt*45;this.zoneWall.material.opacity=.075+Math.sin(this.elapsed*1.6)*.015;this.announcementTime=Math.max(0,this.announcementTime-dt);this.announcement.hidden=this.announcementTime<=0;this.draw();}
  dispose(){if(this.disposed)return;this.disposed=true;this.group.removeFromParent();this.zeppelinModel?.dispose();for(const geometry of this.geometries)geometry.dispose();for(const material of this.materials)material.dispose();this.hud.remove();this.hudHost?.classList.remove('battle-royale-mode');this.state=null;}
}

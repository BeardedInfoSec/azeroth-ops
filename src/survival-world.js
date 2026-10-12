import {blocksFortificationMove} from './engine/fortification-motion.js';
import {installStaticCoverRaycast} from './engine/static-cover-raycast.js';
import {installSkinnedRaycast} from './engine/skinned-raycast.js';
import * as THREE from 'three';
import {clone as cloneSkeleton} from 'three/addons/utils/SkeletonUtils.js';
import {GUNS} from './weapon-data.js';
import {ZOMBIE_PERKS} from './survival-rules.mjs';
import {createPerkModel} from './perk-models.js';

const pair=(a,b)=>a<b?a+':'+b:b+':'+a;
const DISTRICT_ZONES={'stormwind-dwarven':['Forge Court','Mason Perimeter','Outer Defenses'],'stormwind-valley':['Hero Yard','Garrison Perimeter','Outer Defenses'],'stormwind-park':['Moonwell Plaza','Garden Perimeter','Outer Defenses']};
const ZONE_NAMES={stormwind:['Inner Streets','Market Perimeter','Outer Defenses'],...DISTRICT_ZONES,dalaran:['City Outpost','Street Perimeter','Outer Defenses'],darnassus:['Inner Outpost','Garden Perimeter','Outer Defenses']};

// Fortifications follow cuts in the actual walkable graph, not a radius in empty space.
export class SurvivalWorld{
  constructor({scene,nav,spawn,gunModels=[],city='stormwind',worldCollider=null,perkDefinitions=ZOMBIE_PERKS,zoneSteps=city==='dalaran'?[10,20,28]:[10,18,26],fortifications='light',machineFactory=createPerkModel}){
    Object.assign(this,{scene,nav,spawn:spawn.clone(),gunModels,city,machineFactory,fortifications:['light','classic','off'].includes(fortifications)?fortifications:'light'});
    this.worldCollider=worldCollider;this.zoneSteps=zoneSteps;this.group=new THREE.Group();this.group.name='Survival fortifications';this.shotCollider=new THREE.Group();this.shotCollider.name='Survival shot cover';this.group.add(this.shotCollider);scene.add(this.group);
    this.interactions=[];this.windows=[];this.gates=[];this.weaponBuys=[];this.machines=[];this.machineVisuals=[];this.machineColliders=[];this.entryColliders=[];this.barriers=[];this.edgeBarriers=new Map();this.unlockedZones=new Set(this.fortifications==='off'?[0,1,2]:[0]);this.nodeZones=new Map();this.distances=new Map();this.geometries=new Map();this.materials=new Set();this.textures=new Set();this.skeletons=new Set();this.zoneNames=ZONE_NAMES[city]||ZONE_NAMES.stormwind;
    const timber=this.woodTexture();this.wood=this.material(0xb39973,timber);this.metal=this.material(0x45443e);this.gateWood=this.material(0xc3a779,timber);this.rackMaterial=this.material(0x23333a);
    const start=nav.nearest(spawn),reachable=new Set((nav.reachable||nav.nodes).map(n=>n.id));if(!start||!reachable.has(start.id))return;
    const queue=[start.id];this.distances.set(start.id,0);this.cellNodes=new Map();
    for(let i=0;i<queue.length;i++){const id=queue[i],node=nav.nodes[id],distance=this.distances.get(id);this.nodeZones.set(id,distance<=zoneSteps[0]?0:distance<=zoneSteps[1]?1:distance<=zoneSteps[2]?2:3);this.cellNodes.set(node.x+','+node.z,node);for(const next of node.edges)if(reachable.has(next)&&!this.distances.has(next)){this.distances.set(next,distance+1);queue.push(next);}}
    const cuts=[];
    // Every exposed cell side has visible cover, including missing graph neighbors.
    // Existing city masonry is used where it already closes the boundary.
    for(const id of queue){const inside=nav.nodes[id],zone=this.nodeZones.get(id);if(zone>2)continue;for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){
      const other=this.cellNodes.get((inside.x+dx)+','+(inside.z+dz)),otherZone=other?this.nodeZones.get(other.id):3;if(otherZone<=zone)continue;
      const outside=other||{id:'edge-'+inside.id+'-'+dx+'-'+dz,point:inside.point.clone().add(new THREE.Vector3(dx*nav.cell,0,dz*nav.cell))};
      const covered=nav.blocked&&[.7,1.7,2.7][other?'every':'some'](y=>nav.blocked(inside.point.clone().add(new THREE.Vector3(0,y,0)),outside.point.clone().add(new THREE.Vector3(0,y,0)),0));if(covered)continue;
      cuts.push({inside,outside,level:zone+1,permanent:!other,linked:!!other&&inside.edges.includes(other.id)});
    }}
    for(const level of this.fortifications==='off'?[3]:[1,2,3]){
      const candidates=cuts.filter(c=>c.level===level&&c.linked&&!c.permanent),selected=[];const ranked=candidates.slice().sort((a,b)=>b.inside.edges.length-a.inside.edges.length||a.inside.id-b.inside.id);const gate=level<3?ranked.find(c=>Math.abs(c.inside.point.y-c.outside.point.y)<.4):null;
      if(gate)gate.type='gate';
      while(selected.length<3){let best=null,score=-Infinity;for(const c of candidates){if(c===gate||selected.includes(c)||!this.fitsEntry(c))continue;const anchors=[...(gate?[gate]:[]),...selected],separation=anchors.length?Math.min(...anchors.map(a=>a.inside.point.distanceTo(c.inside.point))):c.inside.point.distanceTo(spawn);if(separation<5)continue;if(separation>score){best=c;score=separation;}}if(!best)break;best.type='window';selected.push(best);}
    }
    for(const cut of cuts){if(this.fortifications==='off'&&(cut.level!==3||cut.type!=='window'))continue;this.addBoundary(cut,cut.level,cut.type||(cut.permanent?'rail':'wall'));}
    // An open layout has no invisible outer movement/AI boundary. Keep the
    // covered entry alcoves, but let the whole reachable city serve as zone 2.
    if(this.fortifications==='off')for(const [id,zone] of this.nodeZones)if(zone===3)this.nodeZones.set(id,2);
    for(const [zone,index,cost] of [[0,1,1000],[1,2,1500],[2,3,1750]]){
      const nodes=queue.map(id=>nav.nodes[id]).filter(n=>this.nodeZones.get(n.id)===zone&&n.edges.length>=2);nodes.sort((a,b)=>Math.abs(this.distances.get(a.id)-([5,14,22][zone]))-Math.abs(this.distances.get(b.id)-([5,14,22][zone]))||a.id-b.id);if(nodes.length)this.addWeapon(nodes[0],zone,index,cost);
    }
    for(const perk of perkDefinitions)this.addMachine(perk,false);
    this.addMachine({id:'pack-a-punch',name:'Pack-a-Punch',cost:5000,zone:2,color:'#a3e9ed'},true);
    // Prepare static cover once; firing must not update or raycast every plank
    // and rack in the city. Exact child tests run only in intersected groups.
    for(const cover of this.shotCollider.children)installStaticCoverRaycast(cover);
  }
  material(color,map=null){const material=new THREE.MeshStandardMaterial({color,map,roughness:.92,metalness:map?0:.35});this.materials.add(material);return material;}
  woodTexture(){const size=128,data=new Uint8Array(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const i=(y*size+x)*4,noise=((Math.sin(x*12.9898+y*78.233)*43758.5453)%1+1)%1,warp=y+Math.sin(x*.035)*3,grain=Math.sin(warp*.16)*5+Math.sin(warp*.39+x*.012)*3,knot=Math.exp(-((x-85)**2/360+(y-47)**2/90))*Math.sin(Math.hypot((x-85)*.4,y-47)*.4)*9,v=207+grain+knot+(noise-.5)*10;data[i]=v;data[i+1]=v*.91;data[i+2]=v*.76;data[i+3]=255;}const texture=new THREE.DataTexture(data,size,size);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.LinearFilter;texture.minFilter=THREE.LinearMipmapLinearFilter;texture.generateMipmaps=true;texture.needsUpdate=true;this.textures.add(texture);return texture;}
  box(parent,size,position,material){const key=size.join(','),geometry=this.geometries.get(key)||new THREE.BoxGeometry(...size);this.geometries.set(key,geometry);const mesh=new THREE.Mesh(geometry,material);mesh.position.set(...position);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  sign(parent,text,subtext,width,y,z=.24){
    if(typeof document==='undefined')return null;
    const canvas=document.createElement('canvas');canvas.width=768;canvas.height=192;const ctx=canvas.getContext('2d');if(!ctx)return null;ctx.fillStyle='#111b20';ctx.fillRect(0,0,768,192);ctx.strokeStyle='#c7ac72';ctx.lineWidth=8;ctx.strokeRect(8,8,752,176);ctx.textAlign='center';ctx.fillStyle='#efe4c6';ctx.font='bold 44px sans-serif';ctx.fillText(text.toUpperCase(),384,83,718);ctx.fillStyle='#d7b778';ctx.font='30px sans-serif';ctx.fillText(subtext,384,139,718);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;this.textures.add(texture);const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide});this.materials.add(material);const geometry=new THREE.PlaneGeometry(width,width/4);this.geometries.set('sign'+this.geometries.size,geometry);const mesh=new THREE.Mesh(geometry,material);mesh.position.set(0,y,z);parent.add(mesh);return mesh;
  }
  entryTransform({inside,outside}){const center=inside.point.clone().lerp(outside.point,.5),inward=inside.point.clone().sub(outside.point);inward.y=0;const angle=Math.atan2(inward.x,inward.z);return (x,z,y=outside.point.y)=>new THREE.Vector3(x,0,z).applyAxisAngle(new THREE.Vector3(0,1,0),angle).add(new THREE.Vector3(center.x,y,center.z));}
  fitsEntry(cut){
    if(Math.abs(cut.inside.point.y-cut.outside.point.y)>.3)return false;const at=this.entryTransform(cut);
    if(!this.nav.floorAt)return true;
    for(const x of [-1.1,0,1.1])for(const z of [-2.4,-1.4,-.4]){const p=at(x,z),h=this.nav.floorAt(p.x,p.z,p.y+.5,1);if(!h||h.face.normal.y<.65||Math.abs(h.point.y-p.y)>.22)return false;for(const y of [.35,1.4,2.5])if(this.nav.blocked?.(at(0,-.5).add(new THREE.Vector3(0,y,0)),p.clone().add(new THREE.Vector3(0,y,0)),.05))return false;}
    return true;
  }
  addBoundary({inside,outside,permanent=false},level,type){
    const lightWall=type==='wall'&&this.fortifications==='light';
    const midpoint=inside.point.clone().lerp(outside.point,.5),ground=Math.min(inside.point.y,outside.point.y)-.08,height=(type==='rail'?1.2:lightWall?2.05:3.2)+Math.abs(inside.point.y-outside.point.y),width=this.nav.cell+.1,depth=lightWall?.42:.18;
    const mesh=new THREE.Group();mesh.position.set(midpoint.x,ground,midpoint.z);const inward=inside.point.clone().sub(outside.point);inward.y=0;mesh.rotation.y=Math.atan2(inward.x,inward.z);this.shotCollider.add(mesh);
    const barrier={id:type+'-'+level+'-'+inside.id+'-'+outside.id,type,level,permanent,insideNode:inside.id,outsideNode:outside.id,inside:inside.point.clone(),outside:outside.point.clone(),mesh,width,height,depth,open:false};
    this.barriers.push(barrier);if(typeof outside.id==='number')this.edgeBarriers.set(pair(inside.id,outside.id),barrier);
    if(!lightWall){for(const x of [-width/2+.07,width/2-.07])this.box(mesh,[.14,height,.26],[x,height/2,0],this.metal);this.box(mesh,[width,.15,.26],[0,height-.075,0],this.metal);}
    if(type==='window'){
      // A complete covered alcove conceals generation. Undead walk around its
      // rear baffle, break the six boards, and pass through a floor-level aperture.
      this.box(mesh,[width,height-2.6,depth],[0,(height+2.6)/2,0],this.wood);
      barrier.planks=[];for(let i=0;i<6;i++)barrier.planks.push(this.box(mesh,[width-.14,.3,.1],[0,.24+i*.4,.1+(i%2)*.01],this.wood));
      const panel=(size,pos)=>{this.box(mesh,size,pos,this.wood);const local=new THREE.Vector3(...pos);local.y-=size[1]/2;local.applyAxisAngle(new THREE.Vector3(0,1,0),mesh.rotation.y).add(mesh.position);const holder=new THREE.Group();holder.position.copy(local);holder.rotation.y=mesh.rotation.y;this.entryColliders.push({owner:barrier,mesh:holder,width:size[0],height:size[1],depth:size[2],open:false});};
      for(const side of [-1,1])panel([.18,height,2.5],[side*(width/2-.02),height/2,-1.2]);
      panel([width,height,.18],[0,height/2,-2.45]);panel([1.25,height,.16],[-.45,height/2,-1.3]);this.box(mesh,[width+.08,.16,2.65],[0,height,-1.2],this.metal);
      const at=this.entryTransform({inside,outside});Object.assign(barrier,{zone:level-1,boards:6,retired:false,spawnPoint:at(-.55,-1.95),approachPath:[at(.75,-1.95),at(.75,-.65),at(0,-.5)],releasePath:[at(0,.3),inside.point.clone()]});
      this.windows.push(barrier);this.interactions.push({id:barrier.id,type:'window',zone:level-1,position:inside.point.clone(),cost:0,window:barrier,mesh});this.sign(mesh,'Undead breach','HOLD E / REBUILD',width*.82,2.93,.18);
    }else if(type==='gate'){
      barrier.depth=1.3;this.box(mesh,[width-.12,.24,1.1],[0,.65,0],this.wood);
      const wheelGeometry=new THREE.TorusGeometry(.3,.065,6,18);this.geometries.set('wheel-'+barrier.id,wheelGeometry);
      for(const x of [-width/2+.38,width/2-.38])for(const z of [-.52,.52]){const wheel=new THREE.Mesh(wheelGeometry,this.metal);wheel.position.set(x,.38,z);mesh.add(wheel);}
      for(let row=0;row<3;row++)for(const side of [-1,1]){const cw=(width-.16)/2,ch=.7,x=side*cw/2,y=.85+ch/2+row*.73;this.box(mesh,[cw-.03,ch,1.08],[x,y,0],this.gateWood);for(const edge of [-1,1])this.box(mesh,[cw-.07,.065,.06],[x,y+edge*.26,.565],this.wood);const brace=this.box(mesh,[.07,ch,.06],[x,y,.57],this.metal);brace.rotation.z=side*.45;}
      Object.assign(barrier,{zone:level-1,cost:level===1?750:1500,name:this.zoneNames[level]});this.gates.push(barrier);this.interactions.push({id:barrier.id,type:'gate',zone:level-1,level,cost:barrier.cost,name:barrier.name,position:inside.point.clone(),gate:barrier,mesh});this.sign(mesh,barrier.name,'E / EXPAND DEFENSES / '+barrier.cost,width*.9,1.95,.65);
    }else if(type==='rail'){
      for(const y of [.35,1.02])this.box(mesh,[width,.17,depth],[0,y,0],this.wood);
    }else if(lightWall){
      // A few low crate meshes replace the field of tall plank panels. They
      // retain the exact boundary width so unlocks and movement stay coherent.
      const crateHeight=height/2;
      for(let row=0;row<2;row++)this.box(mesh,[width-.02,crateHeight-.01,depth],[0,(row+.5)*crateHeight,0],this.gateWood);
      for(const x of [-width*.32,width*.32])this.box(mesh,[.075,height-.04,depth+.025],[x,height/2,0],this.metal);
      this.box(mesh,[width,.07,depth+.025],[0,crateHeight,0],this.wood);
    }else{
      for(let y=.18;y<height;y+=.36)this.box(mesh,[width-.1,.36,depth],[0,y,0],this.wood);
      for(const x of [-.72,.72])this.box(mesh,[.1,height-.3,.09],[x,height/2,.14],this.metal);
    }
  }
  get movementColliders(){return [...this.barriers,...this.entryColliders,...this.machineColliders].filter(c=>!c.open&&!c.owner?.open);}
  canEntryMove(entry,from,to){const a=from.clone().add(new THREE.Vector3(0,.8,0)),b=to.clone().add(new THREE.Vector3(0,.8,0));if(this.worldCollider){const d=b.clone().sub(a),ray=new THREE.Raycaster(a,d.clone().normalize(),0,d.length());ray.firstHitOnly=true;if(ray.intersectObject(this.worldCollider,true).length)return false;}else if(this.nav.blocked?.(a,b,.16))return false;return !blocksFortificationMove(a,b,this.movementColliders.filter(c=>c!==entry),.18);}
  addWeapon(node,zone,index,cost){
    const mesh=new THREE.Group(),inward=this.spawn.clone().sub(node.point);inward.y=0;if(inward.lengthSq()<.01)inward.set(0,0,1);inward.normalize();mesh.position.copy(node.point).addScaledVector(inward,-.8);mesh.rotation.y=Math.atan2(inward.x,inward.z);this.shotCollider.add(mesh);this.box(mesh,[1.8,1.7,.18],[0,1.4,0],this.rackMaterial);for(const x of [-.7,.7])this.box(mesh,[.1,2.2,.15],[x,1.1,0],this.metal);
    const source=this.gunModels[index];if(source){const gun=cloneSkeleton(source);gun.traverse(object=>{if(object.isSkinnedMesh)this.skeletons.add(object.skeleton);});gun.visible=true;gun.rotation.set(0,0,0);gun.position.set(0,0,0);gun.updateMatrixWorld(true);const bounds=new THREE.Box3().setFromObject(gun),size=bounds.getSize(new THREE.Vector3()),scale=1.45/Math.max(size.x,size.y,size.z,.001);gun.scale.multiplyScalar(scale);gun.updateMatrixWorld(true);const center=new THREE.Box3().setFromObject(gun).getCenter(new THREE.Vector3());gun.position.sub(center).add(new THREE.Vector3(0,1.4,.22));mesh.add(gun);installSkinnedRaycast(gun);}
    const name=GUNS[index]?.name||'Weapon';this.sign(mesh,name,'E / '+cost+' POINTS',1.8,2.5);const entry={id:'weapon-'+index,type:'weapon',zone,index,gunIndex:index,weaponIndex:index,cost,name,position:node.point.clone(),mesh};this.weaponBuys.push(entry);this.interactions.push(entry);
  }
  machinePlacement(zone,pack){
    const width=pack?1.02:.88,depth=pack?.78:.8,height=2.8,nearby=this.nav.reachable||this.nav.nodes;
    const nodes=nearby.filter(node=>this.nodeZones.get(node.id)===zone&&node.edges.length>=2&&Math.hypot(node.point.x-this.spawn.x,node.point.z-this.spawn.z)>3);
    nodes.sort((a,b)=>Math.abs(this.distances.get(a.id)-([5,14,22][zone]))-Math.abs(this.distances.get(b.id)-([5,14,22][zone]))||a.id-b.id);
    for(const spacing of [3,2.2])for(const node of nodes){
      if(this.interactions.some(item=>Math.hypot(item.position.x-node.point.x,item.position.z-node.point.z)<spacing))continue;
      for(const [dx,dz] of [[1,1],[-1,1],[1,-1],[-1,-1]]){
        const center=node.point.clone().add(new THREE.Vector3(dx*1.1,0,dz*1.1));
        const floor=this.nav.floorAt?.(center.x,center.z,node.point.y+1,2.2);if(this.nav.floorAt&&(!floor||floor.face.normal.y<.7||Math.abs(floor.point.y-node.point.y)>.25))continue;if(floor)center.y=floor.point.y;
        if(this.nodeZones.get(this.nav.nearest(center)?.id)!==zone)continue;
        const eye=node.point.clone().add(new THREE.Vector3(0,1.3,0)),front=center.clone().add(new THREE.Vector3(0,1.3,0));if(this.nav.blocked?.(eye,front,.35))continue;
        // Check the entire cabinet, including low rails that a chest-height ray misses.
        const rotation=Math.atan2(-dx,-dz),cos=Math.cos(rotation),sin=Math.sin(rotation);
        const corners=[[-width/2,-depth/2],[-width/2,depth/2],[width/2,-depth/2],[width/2,depth/2]];
        if(this.nav.blocked&&corners.some(([x,z])=>[.25,.65,1.4,2.4].some(y=>this.nav.blocked(node.point.clone().add(new THREE.Vector3(0,y,0)),center.clone().add(new THREE.Vector3(cos*x+sin*z,y,-sin*x+cos*z)),.08))))continue;
        if(corners.some(([x,z])=>this.isMoveBlocked(eye,center.clone().add(new THREE.Vector3(cos*x+sin*z,1.3,-sin*x+cos*z)),.06)))continue;
        if(this.machines.some(machine=>machine.mesh.position.distanceTo(center)<2))continue;
        const mesh=new THREE.Group();mesh.position.copy(center);mesh.rotation.y=Math.atan2(-dx,-dz);const collider={id:'machine',type:'machine',mesh,width,height,depth,open:false};
        this.machineColliders.push(collider);
        const blocksRoute=nearby.some(n=>Math.hypot(n.point.x-center.x,n.point.z-center.z)<4&&n.edges.some(id=>this.nodeZones.get(n.id)===this.nodeZones.get(id)&&this.isMoveBlocked(n.point.clone().add(new THREE.Vector3(0,.9,0)),this.nav.nodes[id].point.clone().add(new THREE.Vector3(0,.9,0)),.32)));
        this.machineColliders.pop();if(blocksRoute)continue;return {node,mesh,collider};
      }
    }return null;
  }
  addMachine(perk,pack){
    const placement=this.machinePlacement(perk.zone,pack);if(!placement)return false;const {node,mesh,collider}=placement,id=pack?'pack-a-punch':'perk-'+perk.id;mesh.name=perk.name+' machine';collider.id=id;this.machineColliders.push(collider);this.shotCollider.add(mesh);
    const width=collider.width,depth=collider.depth-.18;
    // A single cabinet footprint is authoritative on both host and client.
    // Visibility only affects rendering; this proxy remains raycastable.
    const proxy=this.box(mesh,[width,collider.height,collider.depth],[0,collider.height/2,0],this.rackMaterial);proxy.name='Machine collision proxy';proxy.visible=false;
    const visual=new THREE.Group();visual.name='Machine decoration';visual.raycast=()=>false;mesh.add(visual);
    const imported=this.machineFactory(perk.id,{width,height:collider.height,depth:collider.depth});
    if(imported){visual.add(imported.group);this.machineVisuals.push(imported);}
    else{
    const color=new THREE.Color(perk.color),paint=this.material(color.clone().multiplyScalar(.6)),glow=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:1.15,roughness:.35,metalness:.15});this.materials.add(glow);
    this.box(visual,[width,2.65,depth],[0,1.325,0],paint);this.box(visual,[width,.14,depth],[0,.07,0],this.metal);this.box(visual,[width,.12,depth],[0,2.72,0],glow);
    this.box(visual,[width-.14,1.08,.045],[0,1.72,depth/2+.005],this.rackMaterial);
    for(const side of [-1,1])this.box(visual,[.035,2.18,.03],[side*(width/2-.065),1.54,depth/2+.015],glow);
    if(pack){
      this.box(visual,[width-.22,.36,.06],[0,1.4,depth/2+.02],this.metal);this.box(visual,[width-.35,.14,.035],[0,1.42,depth/2+.055],glow);
      for(const side of [-1,1]){this.box(visual,[.13,.7,.035],[side*.3,2,depth/2+.035],glow);this.box(visual,[.2,.06,.03],[side*.3,2.22,depth/2+.04],this.metal);}
      this.sign(visual,'WEAPON UPGRADE','INSERT / UPGRADE / RETURN',width-.04,.65,depth/2+.035);
    }else{
      const ringGeometry=new THREE.TorusGeometry(.24,.035,8,24);this.geometries.set('perk-ring-'+perk.id,ringGeometry);const ring=new THREE.Mesh(ringGeometry,glow);ring.position.set(0,1.8,depth/2+.04);visual.add(ring);
      this.box(visual,[.12,.32,.07],[0,1.75,depth/2+.055],glow);this.box(visual,[.06,.13,.06],[0,1.965,depth/2+.055],glow);this.box(visual,[.08,.04,.065],[0,2.04,depth/2+.055],this.metal);
      this.box(visual,[width-.28,.2,.045],[0,.66,depth/2+.015],this.rackMaterial);this.box(visual,[.065,.18,.025],[width/2-.18,1.03,depth/2+.025],this.metal);
    }
    }
    this.sign(visual,perk.name,'E / '+perk.cost+' POINTS',width-.04,2.4,depth/2+.045);
    const interaction={id,type:pack?'pack':'perk',perkId:pack?undefined:perk.id,zone:perk.zone,cost:perk.cost,name:perk.name,position:node.point.clone(),mesh};this.machines.push(interaction);this.interactions.push(interaction);return true;
  }
  get activeWindows(){const perimeter=Math.max(...this.unlockedZones);return this.windows.filter(window=>!window.retired&&window.zone===perimeter);}
  setBoards(window,n){const entry=typeof window==='string'?this.windows.find(w=>w.id===window):window;if(!entry||!this.windows.includes(entry))return false;const boards=Math.max(0,Math.min(6,Math.floor(Number(n)||0)));if(entry.boards===boards)return true;entry.boards=boards;entry.planks.forEach((plank,i)=>{if(i<entry.boards){if(!plank.parent)entry.mesh.add(plank);}else plank.removeFromParent();});entry.mesh.updateWorldMatrix(true,true);return true;}
  openZone(level){const gate=this.gates.find(g=>g.level===level);if(!gate||gate.open||!this.unlockedZones.has(level-1))return false;for(const wall of this.barriers)if(wall.level===level&&!wall.permanent){wall.open=true;wall.retired=wall.type==='window';if(wall.retired)wall.boards=0;wall.mesh.removeFromParent();}this.unlockedZones.add(level);return true;}
  canTraverse(a,b){const node=value=>typeof value==='number'?this.nav.nodes[value]:value?.point?value:this.nav.nearest(value);const na=node(a),nb=node(b);if(!na||!nb||!this.unlockedZones.has(this.nodeZones.get(na.id))||!this.unlockedZones.has(this.nodeZones.get(nb.id)))return false;return !this.isMoveBlocked(na.point.clone().add(new THREE.Vector3(0,.9,0)),nb.point.clone().add(new THREE.Vector3(0,.9,0)),.22);}
  zoneAt(point){const x=Math.round((point.x-this.spawn.x)/this.nav.cell),z=Math.round((point.z-this.spawn.z)/this.nav.cell),node=this.cellNodes?.get(x+','+z);return node?this.nodeZones.get(node.id)??-1:-1;}
  isAccessible(point){return this.unlockedZones.has(this.zoneAt(point));}
  nearestInteraction(point,maxDistance=2.6){let nearest=null,distance=maxDistance;for(const item of this.interactions){if(!this.unlockedZones.has(item.zone)||item.gate?.open)continue;const d=Math.hypot(item.position.x-point.x,item.position.z-point.z);if(d<distance){distance=d;nearest=item;}}return nearest;}
  isMoveBlocked(from,to,padding=.32){return blocksFortificationMove(from,to,this.movementColliders,padding);}
  dispose(){this.group.removeFromParent();for(const machine of this.machineVisuals)machine.dispose();this.machineVisuals.length=0;for(const skeleton of this.skeletons)skeleton.dispose();this.skeletons.clear();for(const geometry of this.geometries.values())geometry.dispose();for(const material of this.materials)material.dispose();for(const texture of this.textures)texture.dispose();this.interactions.length=0;this.barriers.length=0;this.windows.length=0;this.gates.length=0;this.weaponBuys.length=0;this.machines.length=0;this.machineColliders.length=0;this.entryColliders.length=0;this.edgeBarriers.clear();}
}

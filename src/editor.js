import * as THREE from 'three';
import {TransformControls} from 'three/addons/controls/TransformControls.js';
import {loadWorld,ARENAS} from './world.js';
import {createLayoutPrefab,disposeLayoutObject} from './layout-objects.js';
import {EDITOR_CITIES,defaultLayout,validateLayout,LayoutHistory,layoutSnapshot} from './map-layout.mjs';
import {SPAWN_LIMIT,SPAWN_COLORS,nextSpawnId,spawnFromHit,addSpawn,updateSpawn,removeSpawn,spawnCounts,nearestSpawn,spawnReportSummary,replaceLayout} from './editor-logic.mjs';
import {OVERLAY_CATEGORIES,overlayUrl,sanitizeOverlays,overlayVisible,placementFromHit,placementFromTransform,uniformScale,cutawayRange,cutawayLevel,firstHitBelow,buildPropIndex,findInstanceAt,probeBox,flyStep,planStep,lookLimits,orthoFrustum,clampViewSize,cappedPixelRatio,PLACEMENT_LIMIT,RECENT_LIMIT,stepRotation,stepScale,clampScale,rollScale,rollRotation,mulberry32,sitOffset,slopeLift,capacityLeft,selectionCentre,groupTransform,nudgeVector,itemsInRect,toggleId,unionIds,pasteItems,scatterPlan,acceptScatterHit,focusPose,browserReducer,sanitizeIdList,categoriesOf,filterTiles,moveIndex,tileMeta,sizeLabel,placementBanner,formatReadout,snapValue} from './editor-logic.mjs';

const $=id=>document.getElementById(id),canvas=$('map');
const state={city:'stormwind',catalog:null,prefabs:new Map(),originals:new Map(),layout:null,history:null,saved:'',selection:null,group:[],asset:null,adding:false,tool:'place',browser:{favorites:[],recent:[]},clipboard:[],loading:0,savePending:false,spawn:{active:false,selected:null,nextYaw:null,reports:null}};
const place={rotation:0,scale:1},footprints=new Map();
// 3D state. The renderer lives for the page; everything city-specific is released by disposeScene().
const view={renderer:null,scene:null,fly:null,ortho:null,mode:'fly',world:null,props:null,templates:new Map(),meshIds:new Map(),refs:new Map(),applied:new Set(),placed:new Map(),ghost:null,ghostBad:false,controls:null,helper:null,hiddenPoints:null,spawn:null,range:{min:-10,max:60},bounds:null,level:Infinity,plane:new THREE.Plane(new THREE.Vector3(0,-1,0),0),flyPose:{position:[0,20,0],yaw:0,pitch:-.4},plan:{x:0,z:0,size:80},keys:new Set(),fastKey:false,selectionBox:null,pivot:null,pivotStart:null,ring:null,cursor:null,dragPreview:null,raf:0,last:0,lastMove:0,lowDetail:false,gizmoPress:false,scaleStart:1,raycaster:new THREE.Raycaster(),ready:false};
const draftKey=city=>'azeroth-ops-map-draft-v1:'+city;
const prefab=id=>state.prefabs.get(id);
const groupIds=()=>{const ids=new Set(state.layout?.placements.map(value=>value.id)||[]);return state.group.filter(id=>ids.has(id));};
const groupItems=()=>{const map=new Map((state.layout?.placements||[]).map(value=>[value.id,value]));return groupIds().map(id=>map.get(id));};
const selected=()=>{const items=groupItems();return items.length===1?items[0]:null;};
function setSelection(ids,original=null){state.group=[...ids];state.selection=ids.length?{type:'added',id:ids[0]}:original?{type:'original',id:original}:null;}
const newId=(()=>{let n=0;return ()=>'p-'+Date.now().toString(36)+'-'+(n++).toString(36)+Math.random().toString(36).slice(2,6);})();
const message=text=>{$('message').textContent=text;};
const snapSize=()=>Number($('snap').value)||0;
const short=value=>String(Math.round(value*100)/100);
const dirty=()=>state.layout&&layoutSnapshot(state.layout)!==state.saved;
const options=()=>({city:state.city,prefabIds:new Set(state.catalog.prefabs.map(item=>item.id)),instanceCount:state.catalog.instanceCount});
const activeCamera=()=>view.mode==='plan'?view.ortho:view.fly;
function persistDraft(){try{localStorage.setItem(draftKey(state.city),layoutSnapshot(state.layout));}catch{message('Browser draft storage is full. Save to host or export JSON to keep your work.');}}
function commit(change){
  if(!state.layout)return;
  try{const next=JSON.parse(layoutSnapshot(state.layout));change(next);state.layout=validateLayout(next,options());state.history.push(state.layout);persistDraft();refresh();}
  catch(error){message(error.message);inspect();syncScene();}
}
async function request(url,options={}){const response=await fetch(url,{cache:'no-store',...options});let value;try{value=await response.json();}catch{throw new Error('The map editor requires the updated host server. Restart the host, then reload this page.');}if(!response.ok)throw new Error(value.error||'Request failed');return value;}

// ---------- renderer, cameras, render-on-demand ----------
// Group gizmo: a pivot at the selection centre; its delta is applied to every selected placement.
function pivotResult(){
  const start=view.pivotStart,pivot=view.pivot;if(!start||!pivot)return null;
  return groupTransform(start.items,start.centre,{move:[pivot.position.x-start.centre[0],pivot.position.y-start.centre[1],pivot.position.z-start.centre[2]],yaw:pivot.rotation.y,scale:pivot.scale.x});
}
function commitGroup(next){const map=new Map(next.map(item=>[item.id,item]));commit(layout=>{for(const item of layout.placements){const n=map.get(item.id);if(n){item.position=n.position;item.rotation=n.rotation;item.scale=n.scale;}}});}
function updateSelectionBox(){if(view.selectionBox)for(const child of view.selectionBox.children)child.update?.();}
function clearSelectionBox(){if(!view.selectionBox)return;view.scene.remove(view.selectionBox);view.selectionBox.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});view.selectionBox=null;}
function clearPivot(){if(!view.pivot)return;if(view.controls.object===view.pivot)view.controls.detach();view.scene.remove(view.pivot);view.pivot=null;view.pivotStart=null;}
function initRenderer(){
  const renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'default'});renderer.setPixelRatio(cappedPixelRatio(window.devicePixelRatio));renderer.localClippingEnabled=false;
  view.renderer=renderer;view.scene=new THREE.Scene();
  view.fly=new THREE.PerspectiveCamera(70,1,.3,4000);view.fly.rotation.order='YXZ';view.ortho=new THREE.OrthographicCamera(-50,50,50,-50,1,1000);
  const controls=new TransformControls(view.fly,canvas);controls.size=.9;view.controls=controls;view.helper=controls.getHelper();view.scene.add(view.helper);
  controls.addEventListener('change',requestRender);
  controls.addEventListener('mouseDown',()=>{
    view.gizmoPress=true;view.scaleStart=controls.object?.scale.x??1;
    if(controls.object===view.pivot){const items=groupItems();view.pivotStart={items:items.map(item=>({...item,position:[...item.position]})),centre:view.pivot.position.toArray()};}
  });
  controls.addEventListener('objectChange',()=>{
    const object=controls.object;if(!object)return;
    object.rotation.x=0;object.rotation.z=0;if(controls.mode==='scale'){object.scale.setScalar(uniformScale(view.scaleStart,[object.scale.x,object.scale.y,object.scale.z]));}
    if(object===view.pivot){const next=pivotResult();if(next)for(const item of next){const group=view.placed.get(item.id);if(group)applyTransform(group,item);}updateSelectionBox();updateReadout();requestRender();return;}
    const t=placementFromTransform({position:object.position.toArray(),rotationY:object.rotation.y,scale:object.scale.x});
    for(const [id,value] of [['pos-x',t.position[0]],['pos-y',t.position[1]],['pos-z',t.position[2]],['rotation',t.rotation*180/Math.PI],['scale',t.scale]])$(id).value=short(value);
    updateSelectionBox();updateReadout();requestRender();
  });
  controls.addEventListener('mouseUp',()=>{
    setTimeout(()=>{view.gizmoPress=false;},0);const object=controls.object;if(!object)return;
    if(object===view.pivot){const next=pivotResult();view.pivotStart=null;if(!next)return;commitGroup(next);return;}
    if(!object.userData.placementId)return;
    const t=placementFromTransform({position:object.position.toArray(),rotationY:object.rotation.y,scale:object.scale.x}),id=object.userData.placementId;
    commit(layout=>{const item=layout.placements.find(value=>value.id===id);if(item){item.position=t.position;item.rotation=t.rotation;item.scale=t.scale;}});
  });
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();message('The graphics context was lost. Reload the page to continue editing.');});
  canvas.addEventListener('webglcontextrestored',requestRender);
  applyGizmoMode('translate');
}
function resize(){
  if(!view.renderer)return;const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;
  view.renderer.setPixelRatio(cappedPixelRatio(window.devicePixelRatio,view.lowDetail));view.renderer.setSize(w,h,false);updateCameras();requestRender();
}
function updateCameras(){
  const w=canvas.clientWidth||1,h=canvas.clientHeight||1,pose=view.flyPose;
  view.fly.aspect=w/h;view.fly.position.fromArray(pose.position);view.fly.rotation.set(pose.pitch,pose.yaw,0);view.fly.updateProjectionMatrix();
  const f=orthoFrustum(w,h,view.plan.size),top=view.range.max+50,cam=view.ortho;
  Object.assign(cam,f);cam.near=1;cam.far=top-view.range.min+100;cam.position.set(view.plan.x,top,view.plan.z);cam.up.set(0,0,-1);cam.lookAt(view.plan.x,top-1,view.plan.z);cam.updateProjectionMatrix();
  if(view.controls)view.controls.camera=activeCamera();
  if(overlay.sprites.length)scaleOverlayLabels();
}
function requestRender(){if(!view.raf)view.raf=requestAnimationFrame(frame);}
function frame(now){
  view.raf=0;const dt=view.last?(now-view.last)/1000:.016;view.last=now;
  if(view.keys.size){
    const fast=view.fastKey;
    if(view.mode==='plan'){const p=planStep(view.plan,view.keys,dt,view.plan.size,fast);view.plan.x=p.x;view.plan.z=p.z;}
    else view.flyPose.position=flyStep(view.flyPose,view.keys,dt,{fast});
    updateCameras();
  }else view.last=0;
  if(view.renderer&&view.scene)view.renderer.render(view.scene,activeCamera());
  if(view.keys.size)requestRender();
}
function setCameraMode(mode){
  view.mode=mode;$('view-toggle').textContent=mode==='plan'?'FLY VIEW':'PLAN VIEW';
  $('controls-help').textContent=mode==='plan'?'PLAN: WASD / RIGHT DRAG: PAN · WHEEL: ZOOM · V: FLY · ESC: SELECT':'FLY: WASD + Q/E · RIGHT DRAG: LOOK · WHEEL: DOLLY · SHIFT: FAST · V: PLAN · ESC: SELECT';
  updateCameras();requestRender();
}
function spawnView(){
  const spawn=(state.catalog||EDITOR_CITIES[state.city]).spawn;
  view.flyPose={position:[spawn[0],spawn[1]+6,spawn[2]+12],yaw:0,pitch:-.35};view.plan={x:spawn[0],z:spawn[2],size:60};updateCameras();requestRender();
}
function fitView(){
  const box=view.bounds;if(!box)return;const cx=(box.min.x+box.max.x)/2,cz=(box.min.z+box.max.z)/2,dx=box.max.x-box.min.x,dz=box.max.z-box.min.z,aspect=(canvas.clientWidth||1)/(canvas.clientHeight||1);
  view.plan={x:cx,z:cz,size:clampViewSize(Math.max(dz,dx/aspect)*1.05)};
  view.flyPose={position:[cx,Math.min(box.max.y,view.range.min+Math.max(dx,dz)*.45)+40,cz+Math.max(dx,dz)*.35],yaw:0,pitch:-.9};updateCameras();requestRender();
}
function applyCutaway(){
  const t=Number($('cutaway').value)/1000;view.level=t>=1?Infinity:cutawayLevel(t,view.range.min,view.range.max);
  view.renderer.clippingPlanes=Number.isFinite(view.level)?[view.plane]:[];view.plane.constant=Number.isFinite(view.level)?view.level:0;
  $('cutaway-value').textContent=Number.isFinite(view.level)?short(view.level)+' m':'off';requestRender();
}
function applyDetail(){
  view.lowDetail=$('low-detail').checked;if(view.props)view.props.visible=!view.lowDetail;
  if(view.spawn)view.spawn.visible=$('show-spawn').checked;if(view.hiddenPoints)view.hiddenPoints.visible=$('show-hidden').checked&&!view.lowDetail;resize();requestRender();
}

// ---------- scene content ----------
function disposeObject(group){
  group.traverse(mesh=>{if(!mesh.isMesh)return;if(mesh.userData.ownGeometry)mesh.geometry.dispose();for(const material of [].concat(mesh.material||[]))if(mesh.userData.ownMaterial)material.dispose();});
}
function applyTransform(group,item){group.position.fromArray(item.position);group.rotation.set(0,item.rotation,0);group.scale.setScalar(item.scale);group.updateMatrixWorld(true);}
// Original city models are shared (instanced meshes of the loaded world); placed copies reuse their
// geometry and textures. Machines and starter props use the game's own proxy builder.
function makeObject(item,ghost=false){
  let group;const source=prefab(item.prefabId)?.source;
  if(item.prefabId.startsWith('wow:')){
    group=new THREE.Group();const parts=view.templates.get(source);
    if(parts?.length)for(const part of parts){const mesh=new THREE.Mesh(part.geometry,ghost?part.material.clone():part.material);mesh.userData.ownMaterial=ghost;mesh.userData.baseColor=0xffffff;group.add(mesh);}
    else{const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:0x9a7b41,wireframe:true}));mesh.position.y=.5;mesh.userData.ownGeometry=mesh.userData.ownMaterial=true;mesh.userData.baseColor=0x9a7b41;group.add(mesh);}
  }else{
    group=createLayoutPrefab({...item,position:[0,0,0],rotation:0,scale:1});
    group.traverse(mesh=>{if(mesh.isMesh){mesh.userData.ownGeometry=mesh.userData.ownMaterial=true;mesh.userData.baseColor=mesh.material.color.getHex();}});
  }
  group.rotation.order='YXZ';group.userData.placementId=item.id;group.userData.prefabId=item.prefabId;
  if(ghost){group.traverse(mesh=>{if(mesh.isMesh){mesh.material.transparent=true;mesh.material.opacity=.55;mesh.material.depthWrite=false;mesh.raycast=()=>{};}});}
  return group;
}
function tint(group,bad){group.traverse(mesh=>{if(mesh.isMesh)mesh.material.color.setHex(bad?0xff3030:mesh.userData.baseColor);});}
function removeGhost(){if(!view.ghost)return;view.scene.remove(view.ghost);disposeObject(view.ghost);view.ghost=null;view.ghostBad=false;}
function measure(id,group){
  let info=footprints.get(id);if(info)return info;
  group.position.set(0,0,0);group.rotation.set(0,0,0);group.scale.setScalar(1);group.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(group);info={minY:0,radius:.5,size:null};
  if(!box.isEmpty()){const size=box.getSize(new THREE.Vector3());info={minY:box.min.y,radius:Math.min(Math.max(size.x,size.z)/2,20),size:[size.x,size.y,size.z]};}
  footprints.set(id,info);return info;
}
function ensureFootprint(id){
  const known=footprints.get(id);if(known)return known;
  const probe=makeObject({id:'probe',prefabId:id,position:[0,0,0],rotation:0,scale:1,solid:false},true),info=measure(id,probe);disposeObject(probe);return info;
}
function syncGhost(){
  const asset=state.asset;if(!view.ready||!state.adding||state.tool!=='place'||!prefab(asset)){removeGhost();return;}
  if(view.ghost?.userData.prefabId===asset)return;
  removeGhost();view.ghost=makeObject({id:'ghost',prefabId:asset,position:[0,0,0],rotation:0,scale:1,solid:false},true);measure(asset,view.ghost);view.ghost.visible=false;view.scene.add(view.ghost);
  assetDetail();refreshGhost();
}
function ensureRing(){
  if(view.ring)return view.ring;
  const ring=new THREE.Mesh(new THREE.RingGeometry(.96,1,64).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0xffe08a,side:THREE.DoubleSide,depthTest:false,transparent:true,opacity:.9}));
  ring.renderOrder=12;ring.raycast=()=>{};ring.visible=false;view.scene.add(ring);view.ring=ring;return ring;
}
function removeRing(){if(!view.ring)return;view.scene.remove(view.ring);view.ring.geometry.dispose();view.ring.material.dispose();view.ring=null;}
function clearDragPreview(){
  if(!view.dragPreview)return;view.scene?.remove(view.dragPreview);for(const child of view.dragPreview.children)disposeObject(child);view.dragPreview=null;
}
function indexProps(){
  const index=buildPropIndex(state.catalog.instances),matrix=new THREE.Matrix4();
  for(const mesh of view.props.children){
    if(!mesh.isInstancedMesh)continue;
    const parts=view.templates.get(mesh.name)||[];parts.push({geometry:mesh.geometry,material:mesh.material});view.templates.set(mesh.name,parts);
    const ids=new Int32Array(mesh.count).fill(-1);
    for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,matrix);const found=findInstanceAt(index,[matrix.elements[12],matrix.elements[13],matrix.elements[14]],{tolerance:.06});if(!found)continue;
      ids[i]=found.id;let list=view.refs.get(found.id);if(!list)view.refs.set(found.id,list=[]);list.push({mesh,i,matrix:matrix.clone()});
    }
    view.meshIds.set(mesh,ids);
  }
}
const ZERO=new THREE.Matrix4().makeScale(0,0,0);
function applyHidden(){
  if(!view.ready)return;const target=new Set(state.layout.hiddenProps),touched=new Set();
  for(const id of target)if(!view.applied.has(id))for(const ref of view.refs.get(id)||[]){ref.mesh.setMatrixAt(ref.i,ZERO);touched.add(ref.mesh);}
  for(const id of view.applied)if(!target.has(id))for(const ref of view.refs.get(id)||[]){ref.mesh.setMatrixAt(ref.i,ref.matrix);touched.add(ref.mesh);}
  for(const mesh of touched)mesh.instanceMatrix.needsUpdate=true;
  if(touched.size||!view.hiddenPoints||view.applied.size!==target.size){
    const positions=[];for(const id of target){const item=state.originals.get(id);if(item)positions.push(...item.position);}
    if(view.hiddenPoints){view.scene.remove(view.hiddenPoints);view.hiddenPoints.geometry.dispose();view.hiddenPoints.material.dispose();}
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    view.hiddenPoints=new THREE.Points(geometry,new THREE.PointsMaterial({color:0xff6b6b,size:9,sizeAttenuation:false,depthTest:false}));view.hiddenPoints.renderOrder=9;view.hiddenPoints.frustumCulled=false;view.scene.add(view.hiddenPoints);
  }
  view.applied=target;view.hiddenPoints.visible=$('show-hidden').checked&&!view.lowDetail;
}
function updateSelection(){
  const controls=view.controls;clearSelectionBox();clearPivot();
  const ids=groupIds(),groups=ids.map(id=>view.placed.get(id)).filter(Boolean);
  if(groups.length&&!state.adding){
    const box=new THREE.Group();for(const group of groups)box.add(new THREE.BoxHelper(group,0xffe08a));view.selectionBox=box;view.scene.add(box);
    if(groups.length===1)controls.attach(groups[0]);
    else{const centre=selectionCentre(groupItems());view.pivot=new THREE.Object3D();view.pivot.position.fromArray(centre);view.pivot.rotation.order='YXZ';view.scene.add(view.pivot);view.pivot.updateMatrixWorld(true);controls.attach(view.pivot);}
  }else{controls.detach();
    if(state.selection?.type==='original'){
      const box=new THREE.Box3(),local=new THREE.Box3();
      for(const ref of view.refs.get(state.selection.id)||[]){const g=ref.mesh.geometry;if(!g.boundingBox)g.computeBoundingBox();local.copy(g.boundingBox).applyMatrix4(ref.matrix);box.union(local);}
      if(!box.isEmpty()){const helper=new THREE.Box3Helper(box,0xffe08a);helper.material.depthTest=false;helper.renderOrder=10;view.selectionBox=new THREE.Group();view.selectionBox.add(helper);view.scene.add(view.selectionBox);}
    }
  }
}
function syncScene(){
  if(!view.ready||!state.layout)return;
  const ids=new Set(state.layout.placements.map(item=>item.id));
  for(const [id,group] of [...view.placed])if(!ids.has(id)){if(view.controls.object===group)view.controls.detach();view.scene.remove(group);disposeObject(group);view.placed.delete(id);}
  for(const item of state.layout.placements){
    let group=view.placed.get(item.id);
    if(group&&group.userData.prefabId!==item.prefabId){if(view.controls.object===group)view.controls.detach();view.scene.remove(group);disposeObject(group);view.placed.delete(item.id);group=null;}
    if(!group){group=makeObject(item);view.scene.add(group);view.placed.set(item.id,group);}
    if(view.controls.dragging&&view.controls.object===group)continue;
    applyTransform(group,item);
  }
  applyHidden();updateSelection();syncGhost();syncSpawnMarkers();requestRender();
}
function disposeScene(){
  view.ready=false;if(view.raf){cancelAnimationFrame(view.raf);view.raf=0;}
  if(!view.scene)return;
  overlay.token++;overlay.busy=false;clearOverlay();
  view.controls.detach();removeGhost();clearSpawnMarkers();clearPivot();clearDragPreview();clearSelectionBox();removeRing();
  for(const group of view.placed.values()){view.scene.remove(group);disposeObject(group);}view.placed.clear();
  if(view.hiddenPoints){view.scene.remove(view.hiddenPoints);view.hiddenPoints.geometry.dispose();view.hiddenPoints.material.dispose();view.hiddenPoints=null;}
  if(view.spawn){view.scene.remove(view.spawn);view.spawn.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});view.spawn=null;}
  if(view.world){view.scene.remove(view.world.group);view.world.dispose();view.world=null;}
  view.props=null;view.templates.clear();view.meshIds.clear();view.refs.clear();view.applied=new Set();view.bounds=null;
  view.renderer.renderLists.dispose();
}
function makeSpawnMarker(spawn){
  const group=new THREE.Group(),material=new THREE.MeshBasicMaterial({color:0x76cadc,depthTest:false,transparent:true,opacity:.9});
  const ring=new THREE.Mesh(new THREE.TorusGeometry(1.2,.07,6,32),material);ring.rotation.x=Math.PI/2;ring.position.y=.1;const pole=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,7,6),material);pole.position.y=3.5;
  group.add(ring,pole);group.position.fromArray(spawn);group.renderOrder=8;group.traverse(o=>{o.renderOrder=8;});return group;
}
// ---------- designer spawn points ----------
// Markers are small meshes (ring, pole, direction arrow) coloured by team. Cyan overlay discs are the
// automatic spawns; a magenta marker means the host could not use that point when the layout was saved.
const spawnKit={group:null,materials:new Map(),shared:null};
const spawnList=()=>state.layout?.spawns||[];
const selectedSpawn=()=>spawnList().find(s=>s.id===state.spawn.selected)||null;
function spawnGeometry(){
  if(spawnKit.shared)return spawnKit.shared;
  return spawnKit.shared={ring:new THREE.TorusGeometry(1,.09,6,32).rotateX(Math.PI/2),big:new THREE.TorusGeometry(1.5,.07,6,32).rotateX(Math.PI/2),pole:new THREE.CylinderGeometry(.05,.05,2.2,6).translate(0,1.1,0),cone:new THREE.ConeGeometry(.38,.9,8).rotateX(-Math.PI/2).translate(0,.15,-1.75),shaft:new THREE.BoxGeometry(.1,.1,.9).translate(0,.15,-1.15)};
}
function spawnMaterial(color){let m=spawnKit.materials.get(color);if(!m){m=new THREE.MeshBasicMaterial({color,depthTest:false,transparent:true,opacity:.95});spawnKit.materials.set(color,m);}return m;}
function clearSpawnMarkers(){if(spawnKit.group){view.scene?.remove(spawnKit.group);spawnKit.group=null;}}
function syncSpawnMarkers(){
  if(!view.scene)return;clearSpawnMarkers();const list=spawnList();if(!list.length)return;
  const geo=spawnGeometry(),summary=spawnReportSummary(state.spawn.reports,list),bad=new Set(summary.rejected.map(r=>r.id)),group=new THREE.Group();
  for(const spawn of list){
    const color=bad.has(spawn.id)?SPAWN_COLORS.bad:SPAWN_COLORS[spawn.team]??SPAWN_COLORS.any,material=spawnMaterial(color),unit=new THREE.Group();
    unit.position.fromArray(spawn.position);unit.userData.spawnId=spawn.id;
    const arrow=new THREE.Group();arrow.rotation.y=spawn.yaw;arrow.add(new THREE.Mesh(geo.cone,material),new THREE.Mesh(geo.shaft,material));
    unit.add(new THREE.Mesh(geo.ring,material),new THREE.Mesh(geo.pole,material),arrow);
    if(spawn.id===state.spawn.selected)unit.add(new THREE.Mesh(geo.big,spawnMaterial(0xffe08a)));
    unit.traverse(o=>{o.renderOrder=10;});group.add(unit);
  }
  spawnKit.group=group;view.scene.add(group);
}
function updateSpawnPanel(){
  const panel=$('spawn-panel'),on=state.spawn.active;panel.hidden=!on;$('tool-spawns').classList.toggle('active',on);if(!on)return;
  const list=spawnList(),counts=spawnCounts(list),spawn=selectedSpawn(),summary=spawnReportSummary(state.spawn.reports,list);
  $('spawn-count').textContent=counts.total+'/'+SPAWN_LIMIT+' placed · '+counts.alliance+' Alliance · '+counts.horde+' Horde · '+counts.any+' any team';
  if(spawn){$('spawn-team').value=spawn.team;$('spawn-yaw').value=short(spawn.yaw*180/Math.PI);}
  else if(state.spawn.nextYaw!==null)$('spawn-yaw').value=short(state.spawn.nextYaw*180/Math.PI);
  $('spawn-delete').disabled=!spawn;$('spawn-report').textContent=summary.text;
}
function setSpawnMode(on){
  if(on===state.spawn.active)return;
  if(on){if(!view.ready||!state.layout)return;if(state.adding){state.adding=false;removeGhost();removeRing();}setSelection([]);}
  state.spawn.active=on;if(!on)state.spawn.selected=null;
  message(on?'Spawn tool: click the ground to add a spawn, click or drag a marker to select or move it. R rotates, Delete removes, Esc or DONE exits.':'Spawn tool closed.');
  canvas.style.cursor=on?'crosshair':'default';refresh();
}
function pickSpawn(event){
  if(!spawnKit.group)return null;setRay(event);
  const hit=view.raycaster.intersectObjects(spawnKit.group.children,true)[0];
  if(hit){let o=hit.object;while(o&&!o.userData.spawnId)o=o.parent;if(o)return o.userData.spawnId;}
  const ground=groundHit();return ground?nearestSpawn(spawnList(),ground.point.toArray())?.id||null:null;
}
function dragSpawn(event){
  setRay(event);const hit=groundHit();if(!hit||!press)return;
  press.spawnNext=placementFromHit(hit.point,{snap:snapSize()});
  const unit=spawnKit.group?.children.find(c=>c.userData.spawnId===press.spawnId);if(unit){unit.position.fromArray(press.spawnNext);requestRender();}
}
function finishSpawnPress(current,event){
  if(current.spawnId){
    if(current.moved&&current.spawnNext)commit(layout=>{layout.spawns=updateSpawn(layout.spawns,current.spawnId,{position:current.spawnNext});});
    state.spawn.selected=current.spawnId;refresh();return;
  }
  if(current.moved)return;
  setRay(event);const hit=groundHit();if(!hit){message('No ground under the cursor. Aim at a surface.');return;}
  if(spawnList().length>=SPAWN_LIMIT){message('Spawn limit reached: a layout holds '+SPAWN_LIMIT+' spawn points. Delete some to add more.');return;}
  const spawn=spawnFromHit(hit.point,{snap:snapSize(),yaw:state.spawn.nextYaw,team:$('spawn-team').value,id:nextSpawnId(spawnList()),origin:state.catalog.spawn});
  commit(layout=>{layout.spawns=addSpawn(layout.spawns,spawn).spawns;});
  if(spawnList().some(s=>s.id===spawn.id)){state.spawn.selected=spawn.id;message('Spawn added ('+spawn.team+'). '+spawnList().length+'/'+SPAWN_LIMIT+'. Save to host to apply it to new matches.');}
  refresh();
}
function deleteSpawn(){
  const spawn=selectedSpawn();if(!spawn)return;commit(layout=>{layout.spawns=removeSpawn(layout.spawns,spawn.id);});state.spawn.selected=null;refresh();message('Spawn deleted.');
}
// ---------- gameplay overlays (computed once on the host from the game's own placement code) ----------
const overlay={group:null,key:'',token:0,textures:[],geometries:[],materials:[],sprites:[],busy:false};
const enabledOverlays=()=>{const on=new Set(OVERLAY_CATEGORIES.filter(name=>$('ov-'+name)?.checked));if(state.spawn.active)on.add('spawn');return on;};
function labelSprite(text,color){
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=64;const ctx=canvas.getContext('2d');
  ctx.fillStyle='#0b1117e6';ctx.fillRect(0,0,256,64);ctx.strokeStyle='#'+color.toString(16).padStart(6,'0');ctx.lineWidth=4;ctx.strokeRect(2,2,252,60);ctx.fillStyle='#f2ead8';ctx.font='bold 22px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,128,33,240);
  const texture=new THREE.CanvasTexture(canvas),material=new THREE.SpriteMaterial({map:texture,depthTest:false,transparent:true,sizeAttenuation:false});overlay.textures.push(texture);overlay.materials.push(material);
  const sprite=new THREE.Sprite(material);sprite.renderOrder=11;return sprite;
}
function scaleOverlayLabels(){const k=view.mode==='plan'?view.plan.size/1.4:1;for(const sprite of overlay.sprites)sprite.scale.set(.2*k,.05*k,1);}
function clearOverlay(){
  if(overlay.group){view.scene?.remove(overlay.group);overlay.group=null;}
  for(const list of [overlay.textures,overlay.geometries,overlay.materials]){for(const value of list)value.dispose();list.length=0;}
  overlay.sprites.length=0;overlay.key='';
}
function buildOverlay(items){
  clearOverlay();const group=new THREE.Group(),groups=new Map(),ring=new THREE.RingGeometry(.9,1.2,28).rotateX(-Math.PI/2),pole=new THREE.CylinderGeometry(.04,.04,1,5).translate(0,.5,0),box=new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1).translate(0,.5,0)),materials=new Map();
  overlay.geometries.push(ring,pole,box);
  for(const item of items){
    let sub=groups.get(item.category);if(!sub){sub=new THREE.Group();sub.userData.category=item.category;groups.set(item.category,sub);group.add(sub);}
    let m=materials.get(item.color);if(!m){m={fill:new THREE.MeshBasicMaterial({color:item.color,side:THREE.DoubleSide,depthTest:false,transparent:true,opacity:.55}),line:new THREE.LineBasicMaterial({color:item.color,depthTest:false,transparent:true})};materials.set(item.color,m);overlay.materials.push(m.fill,m.line);}
    const unit=new THREE.Group();unit.position.fromArray(item.position);unit.rotation.y=item.rotation;
    const disc=new THREE.Mesh(ring,m.fill);disc.position.y=.08;disc.renderOrder=9;unit.add(disc);
    if(item.size){const outline=new THREE.LineSegments(box,m.line);outline.scale.set(...item.size);outline.renderOrder=9;unit.add(outline);}
    const stick=new THREE.Mesh(pole,m.fill);stick.scale.set(1,item.size?item.size[1]+1.5:4,1);stick.renderOrder=9;unit.add(stick);
    if(!['wall','rail','spawn'].includes(item.kind)){const sprite=labelSprite(item.label,item.color);sprite.position.y=(item.size?item.size[1]:4)+1.8;unit.add(sprite);overlay.sprites.push(sprite);}
    sub.add(unit);
  }
  overlay.group=group;view.scene.add(group);scaleOverlayLabels();
}
function showOverlays(){const on=enabledOverlays();if(overlay.group)for(const sub of overlay.group.children)sub.visible=on.has(sub.userData.category);requestRender();}
async function syncOverlays(){
  if(!view.scene||!state.layout)return;const on=enabledOverlays(),status=$('overlay-status');
  if(!on.size){showOverlays();status.textContent='Overlays off';return;}
  const fortifications=state.layout.settings.fortifications,key=state.city+'|'+fortifications;
  if(overlay.key===key&&overlay.group){showOverlays();return;}
  if(overlay.busy===key)return;
  const city=state.city,token=++overlay.token;overlay.busy=key;status.textContent='Computing placements on the host…';
  try{
    const data=await request(overlayUrl(city,fortifications));if(token!==overlay.token||city!==state.city)return;
    buildOverlay(sanitizeOverlays(data));overlay.key=key;state.spawn.reports=data.spawnReports||null;showOverlays();updateSpawnPanel();syncSpawnMarkers();
    const c=data.counts||{};status.textContent='Saved-layout placements · '+(c.breach||0)+' breaches, '+((c.perk||0)+(c.pack||0))+' machines, '+(c.weapon||0)+' weapons';
  }catch(error){if(token===overlay.token){status.textContent='Overlays unavailable: '+error.message;}}
  finally{if(overlay.token===token)overlay.busy=false;}
}
async function loadScene(city,token){
  const progress=text=>{if(token===state.loading){$('loading-overlay').textContent=text;message(text);}};
  $('loading-overlay').hidden=false;$('loading-overlay').textContent='Loading '+EDITOR_CITIES[city].name+'…';
  // The world is loaded with an empty layout: the editor owns placed/hidden state and applies it live.
  const world=await loadWorld(city,progress,defaultLayout(city));
  if(token!==state.loading){world.dispose();return;}
  view.world=world;view.scene.background=new THREE.Color(ARENAS[city].sky);view.scene.add(world.group);
  view.props=world.group.children.find(child=>child.type==='Group')||null;if(view.props)indexProps();
  const geometry=world.collider.geometry;geometry.computeBoundingBox();view.bounds=geometry.boundingBox.clone();view.range=cutawayRange(view.bounds.min.y,view.bounds.max.y);
  view.spawn=makeSpawnMarker(state.catalog.spawn);view.scene.add(view.spawn);
  view.ready=true;$('loading-overlay').hidden=true;spawnView();applyCutaway();applyDetail();assetDetail();syncScene();
}

// ---------- picking ----------
function setRay(event){const rect=canvas.getBoundingClientRect();view.raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),activeCamera());}
function groundHit(){return firstHitBelow(view.raycaster.intersectObject(view.world.collider,false),view.level);}
function pickAt(event){
  setRay(event);let best=null;
  const placed=firstHitBelow(view.raycaster.intersectObjects([...view.placed.values()],true),view.level);
  if(placed){let object=placed.object;while(object&&!object.userData.placementId)object=object.parent;if(object)best={distance:placed.distance,selection:{type:'added',id:object.userData.placementId}};}
  if(!view.lowDetail&&view.props){
    const hit=firstHitBelow(view.raycaster.intersectObjects([...view.meshIds.keys()],false),view.level);
    if(hit&&(!best||hit.distance<best.distance)){const id=view.meshIds.get(hit.object)?.[hit.instanceId];if(id>=0)best={distance:hit.distance,selection:{type:'original',id}};}
  }
  return best?.selection||null;
}
const angleSnapDeg=()=>Number($('angle-snap').value)||15;
const scatterRadius=()=>Number($('scatter-radius').value)||6;
const scatterCount=()=>Number($('scatter-count').value)||10;
function placeOffset(info,scale,normal){
  return (Number($('place-height').value)||0)+($('place-sit').checked?sitOffset(info.minY,scale):0)+($('place-slope').checked?slopeLift(normal?.y??1,info.radius*scale):0);
}
function placementPosition(point,normal,scale=place.scale,id=state.asset){
  return placementFromHit(point,{snap:snapSize(),offset:placeOffset(footprints.get(id)||{minY:0,radius:.5},scale,normal)});
}
function positionGhost(point,normal){
  const ghost=view.ghost;if(!ghost)return;
  ghost.position.fromArray(placementPosition(point,normal));ghost.rotation.y=place.rotation;ghost.scale.setScalar(place.scale);ghost.updateMatrixWorld(true);ghost.visible=true;
  const box=new THREE.Box3().setFromObject(ghost),probe=probeBox(box.min.toArray(),box.max.toArray());let bad=false;
  if(probe){try{bad=!!view.world.collider.geometry.boundsTree.intersectsBox(new THREE.Box3(new THREE.Vector3(...probe.min),new THREE.Vector3(...probe.max)),new THREE.Matrix4());}catch{bad=false;}}
  if(bad!==view.ghostBad||ghost.userData.tinted===undefined){tint(ghost,bad);view.ghostBad=bad;ghost.userData.tinted=true;}
  updateReadout();
}
function positionRing(point){
  const ring=ensureRing();ring.position.set(point.x,point.y+.12,point.z);ring.scale.setScalar(scatterRadius());ring.visible=true;updateReadout();
}
function refreshGhost(){
  if(!state.adding||!view.ready)return;
  if(state.tool==='scatter'){if(view.cursor)positionRing(view.cursor.point);}
  else if(view.ghost&&view.cursor)positionGhost(view.cursor.point,view.cursor.normal);
  updateReadout();requestRender();
}
// The next copy keeps the chosen rotation/scale unless the random toggles roll a fresh value.
function rollNext(){
  if($('place-random-rot').checked)place.rotation=rollRotation(Math.random);
  if($('place-random-scale').checked)place.scale=rollScale(Math.random,$('scale-min').value,$('scale-max').value);
}
function updateReadout(){
  let text='';const fmt=object=>formatReadout({position:object.position.toArray(),rotation:object.rotation.y,scale:object.scale.x});
  if(state.adding&&state.tool==='place'){if(view.ghost?.visible)text='NEXT '+fmt(view.ghost);else text='NEXT ROT '+Math.round(place.rotation*1800/Math.PI)/10+'° · SCALE '+short(place.scale)+'x';}
  else if(state.adding)text='SCATTER '+scatterCount()+' copies · '+scatterRadius()+' m radius';
  else{
    const groups=groupIds().map(id=>view.placed.get(id)).filter(Boolean);
    if(groups.length===1)text='SELECTED '+fmt(groups[0]);
    else if(groups.length>1){const c=view.pivot?view.pivot.position.toArray():selectionCentre(groupItems());text=groups.length+' SELECTED · CENTRE X '+short(c[0])+' Y '+short(c[1])+' Z '+short(c[2]);}
  }
  $('readout').textContent=text;
}
// ---------- adding, scattering, pasting: every operation is ONE history step ----------
function addPlacements(items,{select=true}={}){
  if(!state.layout||!items.length)return {count:0,dropped:0};
  const room=capacityLeft(state.layout.placements.length,items.length);
  if(room.allowed===0){message('Placement limit reached: a layout holds '+PLACEMENT_LIMIT+' added assets. Delete some to add more.');return {count:0,dropped:items.length};}
  const use=items.slice(0,room.allowed);commit(layout=>layout.placements.push(...use));
  const ok=use.filter(item=>state.layout.placements.some(value=>value.id===item.id));
  if(ok.length&&select){setSelection(ok.map(item=>item.id));refresh();}
  return {count:ok.length,dropped:ok.length?room.dropped:0};
}
const limitNote=result=>result.dropped?' Only '+result.count+' fit: the '+PLACEMENT_LIMIT+'-asset limit was reached.':'';
function addAt(point,normal,keep){
  const asset=state.asset;if(!prefab(asset)||!state.layout)return;
  const item={id:newId(),prefabId:asset,position:placementPosition(point,normal),rotation:place.rotation,scale:place.scale,solid:true},overlap=view.ghostBad;
  const result=addPlacements([item],{select:false});if(!result.count)return;
  state.browser=browserReducer(state.browser,{type:'use',id:asset});saveBrowser();rollNext();
  const total=state.layout.placements.length;
  if(!keep&&!$('place-stay').checked){exitPlacing((overlap?'Placed (overlaps solid geometry). ':'Placed. ')+total+'/'+PLACEMENT_LIMIT+' assets.');return;}
  message((overlap?'Placed, but it overlaps solid geometry. ':'Placed. ')+total+'/'+PLACEMENT_LIMIT+' assets. Click for another, Esc when done.');refreshGhost();
}
function scatterAt(point){
  const radius=scatterRadius(),favorites=$('scatter-favs').checked?state.browser.favorites.filter(prefab):[],assets=favorites.length?favorites:[state.asset];
  if(!assets[0]||!state.layout)return;
  const room=capacityLeft(state.layout.placements.length,scatterCount());
  if(room.allowed===0){message('Placement limit reached: a layout holds '+PLACEMENT_LIMIT+' added assets. Delete some to scatter more.');return;}
  const plan=scatterPlan({seed:(Date.now()^Math.floor(Math.random()*4294967296))>>>0,count:scatterCount(),radius,center:[point.x,point.z],assets,rotation:place.rotation,randomRotation:true,scale:place.scale,randomScale:$('place-random-scale').checked,range:[Number($('scale-min').value),Number($('scale-max').value)],spacing:Math.min(1.5,radius/4)});
  const caster=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0),origin=new THREE.Vector3(),items=[];let missed=0;
  for(const spot of plan){
    if(items.length>=room.allowed)break;
    origin.set(spot.x,point.y+4,spot.z);caster.set(origin,down);caster.far=400;
    const hit=firstHitBelow(caster.intersectObject(view.world.collider,false),view.level);
    if(!hit||!acceptScatterHit(hit.point.y,point.y,radius)){missed++;continue;}
    const info=ensureFootprint(spot.prefabId),normal=hit.face?.normal||null;
    items.push({id:newId(),prefabId:spot.prefabId,position:placementFromHit(hit.point,{snap:0,offset:placeOffset(info,spot.scale,normal)}),rotation:spot.rotation,scale:spot.scale,solid:true});
  }
  if(!items.length){message('Nothing scattered: no walkable ground found inside the circle.');return;}
  const result=addPlacements(items,{select:false});if(!result.count)return;
  message('Scattered '+result.count+' of '+plan.length+(missed?' ('+missed+' had no ground)':'')+'.'+(scatterCount()>room.allowed?' Only '+room.allowed+' fit: the '+PLACEMENT_LIMIT+'-asset limit was reached.':'')+' One undo removes them all.');
  refreshGhost();
}
function startPlacing(tool='place'){
  if(!view.ready||!prefab(state.asset))return;if(state.spawn.active)setSpawnMode(false);
  if(state.adding&&state.tool===tool){exitPlacing();return;}
  state.adding=true;state.tool=tool;setSelection([]);removeGhost();rollNext();state.browser=browserReducer(state.browser,{type:'use',id:state.asset});saveBrowser();
  message(tool==='scatter'?'Scatter armed: click the ground to drop copies. Esc or Done to finish.':'Placing armed: click to place copies. Esc, right-click or Done to finish.');
  refresh();
}
function exitPlacing(text){
  if(!state.adding)return;state.adding=false;removeGhost();removeRing();if(text)message(text);else message('Placement finished.');refresh();
}
function deleteSelection(){
  const ids=new Set(groupIds());if(!ids.size)return;commit(layout=>{layout.placements=layout.placements.filter(item=>!ids.has(item.id));});
  setSelection([]);refresh();message('Deleted '+ids.size+' asset'+(ids.size===1?'':'s')+'.');
}
function duplicateSelection(){
  const items=groupItems();if(!items.length)return;
  const clones=items.map(item=>({...item,id:newId(),position:[item.position[0]+2,item.position[1],item.position[2]+2]})),result=addPlacements(clones);
  if(result.count)message('Duplicated '+result.count+'.'+limitNote(result));
}
function copySelection(){const items=groupItems();if(!items.length)return;state.clipboard=items.map(item=>({...item,position:[...item.position]}));message('Copied '+items.length+' asset'+(items.length===1?'':'s')+'. Ctrl+V pastes at the cursor.');}
function pasteAtCursor(){
  if(!state.clipboard.length){message('Nothing copied yet. Select assets and press Ctrl+C.');return;}
  if(state.adding){state.adding=false;removeGhost();removeRing();}
  const items=pasteItems(state.clipboard,view.cursor?view.cursor.point.toArray():null,{snap:snapSize(),makeId:newId}),result=addPlacements(items);
  if(result.count)message('Pasted '+result.count+(view.cursor?' at the cursor.':' (move the cursor over the city to paste there).')+limitNote(result));
}
function selectAll(){if(!state.layout)return;if(state.adding){state.adding=false;removeGhost();removeRing();}setSelection(state.layout.placements.map(item=>item.id));refresh();message(state.group.length+' selected.');}
function nudge(event){
  const items=groupItems();if(!items.length)return false;
  const move=nudgeVector({key:event.key,snap:snapSize(),shift:event.shiftKey,yaw:view.mode==='plan'?0:view.flyPose.yaw});if(!move)return false;
  commitGroup(groupTransform(items,selectionCentre(items),{move}));return true;
}
function rotateStep(direction){
  if(state.spawn.active){
    const spawn=selectedSpawn();
    if(spawn)commit(layout=>{layout.spawns=updateSpawn(layout.spawns,spawn.id,{yaw:stepRotation(spawn.yaw,direction,angleSnapDeg())});});
    else{state.spawn.nextYaw=stepRotation(state.spawn.nextYaw??0,direction,angleSnapDeg());message('Next spawn faces '+Math.round(state.spawn.nextYaw*1800/Math.PI)/10+' degrees.');updateSpawnPanel();}
    return;
  }
  if(state.adding&&state.tool==='place'){place.rotation=stepRotation(place.rotation,direction,angleSnapDeg());refreshGhost();return;}
  const items=groupItems();if(items.length)commitGroup(groupTransform(items,selectionCentre(items),{yaw:direction*angleSnapDeg()*Math.PI/180}));
}
function scaleStep(direction){
  if(state.adding){if(state.tool==='place'){place.scale=stepScale(place.scale,direction);message('Next scale '+short(place.scale)+'x');refreshGhost();}return;}
  const items=groupItems();if(items.length)commitGroup(groupTransform(items,selectionCentre(items),{scale:direction<0?1/1.1:1.1}));
}
function focusSelection(){
  const box=new THREE.Box3();
  for(const id of groupIds()){const group=view.placed.get(id);if(group)box.union(new THREE.Box3().setFromObject(group));}
  if(box.isEmpty()&&view.selectionBox)for(const child of view.selectionBox.children)if(child.box)box.union(child.box);
  if(box.isEmpty()){message('Select something to frame, then press F.');return;}
  const centre=box.getCenter(new THREE.Vector3()),radius=Math.max(box.getSize(new THREE.Vector3()).length()/2,.5);
  if(view.mode==='plan'){view.plan.x=centre.x;view.plan.z=centre.z;view.plan.size=clampViewSize(Math.max(radius*4,20));}
  else view.flyPose.position=focusPose({centre:centre.toArray(),radius,yaw:view.flyPose.yaw,pitch:view.flyPose.pitch,fov:view.fly.fov}).position;
  updateCameras();requestRender();
}
function toggleGizmoSpace(){const next=view.controls.space==='local'?'world':'local';view.controls.setSpace(next);message('Gizmo space: '+next+'.');requestRender();}

// ---------- editor UI (library, inspector, history) ----------
async function loadCity(city,{useDraft=true}={}){
  const token=++state.loading;disposeScene();state.city=city;state.catalog=null;state.prefabs.clear();state.originals.clear();state.layout=null;state.history=null;state.selection=null;state.group=[];state.asset=null;state.clipboard=[];footprints.clear();view.cursor=null;state.adding=false;$('city').value=city;$('save').disabled=true;$('place').disabled=true;$('undo').disabled=true;$('redo').disabled=true;$('save-state').textContent='LOADING';message('Reading '+EDITOR_CITIES[city].name+' prop positions…');
  try{
    const [catalog,saved]=await Promise.all([request('/api/editor/catalog?city='+city),request('/api/layouts/'+city)]);if(token!==state.loading)return;
    state.catalog=catalog;state.prefabs=new Map(catalog.prefabs.map(item=>[item.id,item]));state.originals=new Map(catalog.instances.map(item=>[item.id,item]));state.saved=layoutSnapshot(saved);state.layout=validateLayout(saved,options());let recovered=false;
    if(useDraft){try{const raw=localStorage.getItem(draftKey(city));if(raw){const draft=validateLayout(JSON.parse(raw),options());if(layoutSnapshot(draft)!==state.saved){state.layout=draft;recovered=true;}}}catch{message('A browser draft could not be restored; the host layout is loaded.');}}
    state.history=new LayoutHistory(state.layout);loadBrowser();buildCategories();library();refresh();
    await loadScene(city,token);if(token!==state.loading)return;
    message(recovered?'Recovered your unsaved browser draft. Save to host to apply it to new matches.':catalog.warning||'Ready. Choose an asset and place it, or click an original prop to select it.');
  }catch(error){if(token!==state.loading)return;$('loading-overlay').hidden=false;$('loading-overlay').textContent=error.message;message(error.message);$('save-state').textContent='LOAD FAILED';}
}
// ---------- asset browser (tiles, favorites, recents) ----------
const storeKey=kind=>'azeroth-ops-editor-'+kind+'-v1:'+state.city;
function loadBrowser(){
  let favorites=[],recent=[];
  try{favorites=JSON.parse(localStorage.getItem(storeKey('favorites'))||'[]');recent=JSON.parse(localStorage.getItem(storeKey('recent'))||'[]');}catch{}
  const valid=new Set(state.catalog.prefabs.map(item=>item.id));
  state.browser={favorites:sanitizeIdList(favorites,valid),recent:sanitizeIdList(recent,valid,RECENT_LIMIT)};
}
function saveBrowser(){try{localStorage.setItem(storeKey('favorites'),JSON.stringify(state.browser.favorites));localStorage.setItem(storeKey('recent'),JSON.stringify(state.browser.recent));}catch{}}
let visibleTiles=[];
function buildCategories(){
  const select=$('asset-category'),previous=select.value;select.replaceChildren();
  const add=(value,label)=>{const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);};
  add('all','All assets');add('favorites','★ Favorites');add('recent','Recently used');
  for(const name of categoriesOf(state.catalog?.prefabs||[]))add('cat:'+name,name);
  select.value=[...select.options].some(option=>option.value===previous)?previous:'all';
}
function library(){
  const result=filterTiles(state.catalog?.prefabs||[],{query:$('asset-search').value,category:$('asset-category').value||'all',favorites:state.browser.favorites,recent:state.browser.recent,limit:150});
  visibleTiles=result.tiles;if(!prefab(state.asset)||(!state.adding&&!visibleTiles.some(tile=>tile.id===state.asset)&&visibleTiles.length))state.asset=visibleTiles[0]?.id??state.asset;
  const list=$('asset-tiles'),fragment=document.createDocumentFragment();
  for(const tile of visibleTiles){
    const row=document.createElement('div');row.className='tile';row.dataset.id=tile.id;row.setAttribute('role','option');
    const name=document.createElement('span');name.className='tile-name';name.textContent=tile.name;name.title=tile.name;
    const meta=document.createElement('span');meta.className='tile-meta';meta.textContent=tileMeta(tile,footprints.get(tile.id)?.size);
    const star=document.createElement('button');star.type='button';star.className='star'+(tile.favorite?' on':'');star.dataset.star=tile.id;star.textContent=tile.favorite?'★':'☆';star.title=tile.favorite?'Remove from favorites':'Add to favorites';star.setAttribute('aria-label',star.title);star.tabIndex=-1;
    row.append(name,star,meta);fragment.append(row);
  }
  if(!visibleTiles.length){const note=document.createElement('div');note.className='tile-note';note.textContent=state.catalog?'No assets match. Clear the search or choose another list.':'Loading…';fragment.append(note);}
  else if(result.truncated){const note=document.createElement('div');note.className='tile-note';note.textContent='Showing '+visibleTiles.length+' of '+result.total+'. Type to narrow the list.';fragment.append(note);}
  list.replaceChildren(fragment);markActive(false);assetDetail();
}
function markActive(scroll=true){
  for(const row of $('asset-tiles').children){if(!row.dataset.id)continue;const on=row.dataset.id===state.asset;row.classList.toggle('active',on);row.setAttribute('aria-selected',String(on));if(on&&scroll)row.scrollIntoView({block:'nearest'});}
}
function chooseAsset(id,{arm=false}={}){
  if(!prefab(id))return;state.asset=id;markActive();assetDetail();
  if(arm){if(state.adding&&state.tool==='scatter'){refresh();}else{state.adding=false;startPlacing('place');}}
  else if(state.adding){syncGhost();refresh();}
  requestRender();
}
function browserKey(event){
  const step={ArrowDown:1,ArrowUp:-1}[event.key];
  if(step){event.preventDefault();const next=visibleTiles[moveIndex(visibleTiles.findIndex(tile=>tile.id===state.asset),visibleTiles.length,step)];if(next)chooseAsset(next.id);}
  else if(event.key==='Enter'){event.preventDefault();if(prefab(state.asset)){chooseAsset(state.asset,{arm:true});canvas.focus();}}
}
function assetDetail(){
  const item=prefab(state.asset),info=footprints.get(state.asset),ok=!!item&&view.ready;
  $('asset-detail').textContent=item?item.name+' · '+(item.source||item.category)+(info?.size?' · '+sizeLabel(item,info.size):'')+(item.id.startsWith('machine:')?' · Scenery only; functional perk shops spawn automatically.':''):'No matching imported assets.';
  $('place').disabled=!ok;$('scatter-tool').disabled=!ok;
  $('place').textContent=state.adding&&state.tool==='place'?'PLACING…':'+ PLACE';$('scatter-tool').textContent=state.adding&&state.tool==='scatter'?'SCATTERING…':'SCATTER';
  $('place').classList.toggle('active',state.adding&&state.tool==='place');$('scatter-tool').classList.toggle('active',state.adding&&state.tool==='scatter');
}
function updateBanner(){const on=state.adding;$('mode-banner').hidden=!on;if(on)$('mode-text').textContent=placementBanner(prefab(state.asset)?.name||'asset',{tool:state.tool,count:scatterCount()});}
function inspect(){
  const placement=selected(),original=state.selection?.type==='original'?state.originals.get(state.selection.id):null;const many=groupItems();$('transform').hidden=!placement;$('multi').hidden=many.length<2;$('hide-prop').hidden=!original;
  if(placement){$('selection-name').textContent=prefab(placement.prefabId)?.name||placement.prefabId;$('selection-detail').textContent=placement.prefabId.startsWith('machine:')?'Decorative machine. Purchases use the automatic perk stations.':'Added asset · use the gizmo in the city or enter exact coordinates.';for(const [id,value] of [['pos-x',placement.position[0]],['pos-y',placement.position[1]],['pos-z',placement.position[2]],['rotation',placement.rotation*180/Math.PI],['scale',placement.scale]])$(id).value=short(value);$('solid').checked=placement.solid;}
  else if(many.length>1){const c=selectionCentre(many);$('selection-name').textContent=many.length+' assets selected';$('selection-detail').textContent='Centre X '+short(c[0])+' / Y '+short(c[1])+' / Z '+short(c[2])+'. Shift-click toggles members; the gizmo moves, rotates or scales the whole group.';}
  else if(original){$('selection-name').textContent=prefab('wow:'+original.model)?.name||'Original prop';$('selection-detail').textContent='Original #'+original.id+' · X '+short(original.position[0])+' / Y '+short(original.position[1])+' / Z '+short(original.position[2]);$('hide-prop').textContent=state.layout.hiddenProps.includes(original.id)?'RESTORE ORIGINAL PROP':'HIDE ORIGINAL PROP';}
  else{$('selection-name').textContent='Nothing selected';$('selection-detail').textContent='Place an asset or click something in the city.';}
}
function refresh(){
  const ready=!!state.layout;$('save').disabled=!ready||state.savePending;$('save-state').textContent=state.savePending?'SAVING':dirty()?'UNSAVED CHANGES':'SAVED TO HOST';$('undo').disabled=!state.history?.canUndo;$('redo').disabled=!state.history?.canRedo;$('counts').textContent=ready?state.layout.placements.length+'/256 ADDED · '+state.layout.hiddenProps.length+' HIDDEN'+(spawnList().length?' · '+spawnList().length+'/'+SPAWN_LIMIT+' SPAWNS':''):'';
  if(ready){$('preview-game').href='/?city='+state.city+'&mode=explore';$('fortifications').value=state.layout.settings.fortifications;$('lighting').value=state.layout.settings.lighting;$('fortification-help').textContent={light:'Lower cover keeps more of the city visible. Boarded entries and zone unlocks stay active.',classic:'Tall perimeter walls with boarded entries and paid zone unlocks.',off:'No automatic zone walls. All zones open immediately; three covered undead entries remain.'}[state.layout.settings.fortifications];}
  $('mode').textContent=state.adding?(state.tool==='scatter'?'SCATTER':'PLACING'):'SELECT / MOVE';canvas.style.cursor=state.adding?'crosshair':'default';updateBanner();assetDetail();inspect();syncScene();updateSpawnPanel();syncOverlays();updateReadout();
}
function applyGizmoMode(mode){
  const controls=view.controls;controls.setMode(mode);controls.showX=mode!=='rotate';controls.showZ=mode!=='rotate';controls.showY=true;
  controls.setTranslationSnap(snapSize()||null);controls.setRotationSnap(angleSnapDeg()*Math.PI/180);controls.setScaleSnap(.1);
  for(const [id,name] of [['tool-translate','translate'],['tool-rotate','rotate'],['tool-scale','scale']])$(id).classList.toggle('active',mode===name);requestRender();
}

// ---------- pointer / keyboard ----------
canvas.addEventListener('contextmenu',event=>event.preventDefault());
let press=null;
const stageRect=()=>$('marquee').parentElement.getBoundingClientRect();
function hideMarquee(){$('marquee').hidden=true;}
function updateMarquee(event){
  if(!press)return;const box=stageRect(),el=$('marquee'),x0=Math.min(press.x,event.clientX)-box.left,y0=Math.min(press.y,event.clientY)-box.top;
  el.hidden=false;el.style.left=x0+'px';el.style.top=y0+'px';el.style.width=Math.abs(event.clientX-press.x)+'px';el.style.height=Math.abs(event.clientY-press.y)+'px';
}
// Plan view looks straight down: screen right = +X, screen down = +Z.
function planPoint(clientX,clientY){
  const rect=canvas.getBoundingClientRect(),nx=(clientX-rect.left)/rect.width*2-1,ny=1-(clientY-rect.top)/rect.height*2,f=orthoFrustum(rect.width,rect.height,view.plan.size);
  return {x:view.plan.x+nx*f.right,z:view.plan.z-ny*f.top};
}
function updateAltDrag(event){
  const drag=press.altDrag;setRay(event);const hit=groundHit();if(!hit||!drag.start)return;
  const move=[snapValue(hit.point.x-drag.start.x,snapSize()),hit.point.y-drag.start.y,snapValue(hit.point.z-drag.start.z,snapSize())];
  drag.next=groupTransform(drag.items,drag.centre,{move});
  if(!view.dragPreview){view.dragPreview=new THREE.Group();for(const item of drag.items)view.dragPreview.add(makeObject({...item,id:'drag-'+item.id}));view.scene.add(view.dragPreview);}
  drag.next.forEach((item,i)=>applyTransform(view.dragPreview.children[i],item));requestRender();
}
canvas.addEventListener('pointerdown',event=>{
  if(!state.layout||!view.ready)return;canvas.focus();
  press={pointer:event.pointerId,button:event.button,x:event.clientX,y:event.clientY,lx:event.clientX,ly:event.clientY,moved:false,gizmo:!!view.controls.axis,shift:event.shiftKey,altDrag:null,marquee:false};
  if(event.button===2||event.button===1){event.preventDefault();canvas.setPointerCapture(event.pointerId);}
  else if(event.button===0&&!press.gizmo&&!state.adding){
    if(state.spawn.active){press.spawnId=pickSpawn(event);if(press.spawnId)canvas.setPointerCapture(event.pointerId);}
    else if(event.altKey){
      const hit=pickAt(event);
      if(hit?.type==='added'){
        if(!groupIds().includes(hit.id)){setSelection([hit.id]);refresh();}
        const items=groupItems().map(item=>({...item,position:[...item.position]}));setRay(event);const ground=groundHit();
        press.altDrag={items,centre:selectionCentre(items),start:ground?ground.point.clone():null,next:null};canvas.setPointerCapture(event.pointerId);
      }
    }else if(view.mode==='plan'){press.marquee=true;canvas.setPointerCapture(event.pointerId);}
  }
});
canvas.addEventListener('pointermove',event=>{
  if(!view.ready)return;
  if(press&&press.pointer===event.pointerId){
    const dx=event.clientX-press.lx,dy=event.clientY-press.ly;press.lx=event.clientX;press.ly=event.clientY;if(Math.hypot(event.clientX-press.x,event.clientY-press.y)>4)press.moved=true;
    if(press.button===2||press.button===1){
      if(view.mode==='plan'){const per=view.plan.size/(canvas.clientHeight||1);view.plan.x-=dx*per;view.plan.z-=dy*per;}
      else{view.flyPose.yaw-=dx*.003;view.flyPose.pitch=lookLimits(view.flyPose.pitch-dy*.003);}
      updateCameras();requestRender();return;
    }
    if(press.moved&&press.altDrag){updateAltDrag(event);return;}
    if(press.moved&&press.spawnId){dragSpawn(event);return;}
    if(press.moved&&press.marquee){updateMarquee(event);return;}
  }
  const now=performance.now();if(now-view.lastMove<30||view.gizmoPress||view.controls.dragging)return;view.lastMove=now;
  setRay(event);const hit=groundHit();
  if(hit){
    $('coordinates').textContent='X '+short(hit.point.x)+' / Y '+short(hit.point.y)+' / Z '+short(hit.point.z);
    view.cursor={point:hit.point.clone(),normal:hit.face?.normal?hit.face.normal.clone():null};
    if(state.adding){if(state.tool==='scatter')positionRing(hit.point);else positionGhost(hit.point,view.cursor.normal);}
  }else{view.cursor=null;if(view.ghost)view.ghost.visible=false;if(view.ring)view.ring.visible=false;updateReadout();}
  if(state.adding)requestRender();
});
function finishMarquee(current,event){
  const a=planPoint(current.x,current.y),b=planPoint(event.clientX,event.clientY),ids=itemsInRect(state.layout.placements,{x0:a.x,z0:a.z,x1:b.x,z1:b.z});
  setSelection(current.shift?unionIds(groupIds(),ids):ids);refresh();message(state.group.length?state.group.length+' selected.':'Nothing inside the box.');
}
function endPress(event){
  const current=press;if(!current||current.pointer!==event.pointerId)return;press=null;if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
  const next=current.altDrag?.next;clearDragPreview();hideMarquee();requestRender();
  if(event.type==='pointercancel'||!view.ready)return;
  if(current.button===2&&!current.moved&&state.adding){exitPlacing('Placement finished.');return;}
  if(current.button===2&&!current.moved&&state.spawn.active){setSpawnMode(false);return;}
  if(current.button!==0||current.gizmo||view.gizmoPress)return;
  if(state.spawn.active){finishSpawnPress(current,event);return;}
  if(current.altDrag&&current.moved){
    if(next){const result=addPlacements(next.map(item=>({...item,id:newId()})));if(result.count)message('Duplicated and moved '+result.count+'.'+limitNote(result));}
    return;
  }
  if(current.marquee&&current.moved){finishMarquee(current,event);return;}
  if(current.moved)return;
  if(state.adding){
    setRay(event);const hit=groundHit();if(!hit){message('No ground under the cursor. Aim at a surface.');return;}
    const normal=hit.face?.normal?hit.face.normal.clone():null;
    if(state.tool==='scatter')scatterAt(hit.point);else{positionGhost(hit.point,normal);addAt(hit.point,normal,current.shift);}
    return;
  }
  const hit=pickAt(event);
  if(hit?.type==='added')setSelection(current.shift?toggleId(groupIds(),hit.id):[hit.id]);
  else if(hit?.type==='original')setSelection([],hit.id);
  else if(!current.shift)setSelection([]);
  refresh();
}
canvas.addEventListener('pointerup',endPress);canvas.addEventListener('pointercancel',endPress);
canvas.addEventListener('wheel',event=>{
  event.preventDefault();if(!view.ready)return;
  if(event.altKey&&(state.adding||state.group.length)){scaleStep((event.deltaY||event.deltaX)<0?1:-1);return;}
  if(view.mode==='plan'){
    const rect=canvas.getBoundingClientRect(),nx=(event.clientX-rect.left)/rect.width*2-1,ny=1-(event.clientY-rect.top)/rect.height*2,p=view.plan,a=orthoFrustum(rect.width,rect.height,p.size),wx=p.x+nx*a.right,wz=p.z-ny*a.top;
    p.size=clampViewSize(p.size*Math.exp(event.deltaY*.001));const b=orthoFrustum(rect.width,rect.height,p.size);p.x=wx-nx*b.right;p.z=wz+ny*b.top;
  }else{const pose=view.flyPose,k=-event.deltaY*.02*(event.shiftKey?4:1),cp=Math.cos(pose.pitch);pose.position=[pose.position[0]-Math.sin(pose.yaw)*cp*k,pose.position[1]+Math.sin(pose.pitch)*k,pose.position[2]-Math.cos(pose.yaw)*cp*k];}
  updateCameras();requestRender();
},{passive:false});
$('view-toggle').onclick=()=>setCameraMode(view.mode==='plan'?'fly':'plan');
$('spawn-view').onclick=spawnView;$('fit-view').onclick=fitView;
$('tool-translate').onclick=()=>applyGizmoMode('translate');$('tool-rotate').onclick=()=>applyGizmoMode('rotate');$('tool-scale').onclick=()=>applyGizmoMode('scale');
$('snap').onchange=()=>applyGizmoMode(view.controls.mode);$('angle-snap').onchange=()=>applyGizmoMode(view.controls.mode);
$('cutaway').oninput=applyCutaway;$('low-detail').onchange=applyDetail;$('show-spawn').onchange=applyDetail;$('show-hidden').onchange=()=>{applyDetail();};
for(const name of OVERLAY_CATEGORIES)$('ov-'+name).onchange=syncOverlays;
$('city').onchange=()=>loadCity($('city').value);
$('tool-spawns').onclick=()=>{setSpawnMode(!state.spawn.active);canvas.focus();};$('spawn-done').onclick=()=>setSpawnMode(false);$('spawn-delete').onclick=deleteSpawn;
$('spawn-team').onchange=()=>{const spawn=selectedSpawn();if(spawn)commit(layout=>{layout.spawns=updateSpawn(layout.spawns,spawn.id,{team:$('spawn-team').value});});};
$('spawn-yaw').onchange=()=>{const spawn=selectedSpawn(),deg=Number($('spawn-yaw').value);if(!Number.isFinite(deg))return;if(spawn)commit(layout=>{layout.spawns=updateSpawn(layout.spawns,spawn.id,{yaw:deg*Math.PI/180});});else state.spawn.nextYaw=deg*Math.PI/180;};
$('asset-search').oninput=library;$('asset-category').onchange=library;$('asset-search').onkeydown=browserKey;$('asset-tiles').onkeydown=browserKey;
$('asset-tiles').addEventListener('click',event=>{
  const star=event.target.closest?.('[data-star]');
  if(star){state.browser=browserReducer(state.browser,{type:'toggleFavorite',id:star.dataset.star});saveBrowser();library();return;}
  const row=event.target.closest?.('.tile');if(row)chooseAsset(row.dataset.id,{arm:true});
});
$('place').onclick=()=>{startPlacing('place');canvas.focus();};
$('scatter-tool').onclick=()=>{startPlacing('scatter');canvas.focus();};
$('done').onclick=()=>{exitPlacing('Placement finished.');canvas.focus();};
for(const id of ['place-random-rot','place-random-scale','scale-min','scale-max'])$(id).onchange=()=>{rollNext();refreshGhost();};
for(const id of ['place-sit','place-slope'])$(id).onchange=refreshGhost;$('place-height').onchange=refreshGhost;
for(const [id,out,unit] of [['scatter-count','scatter-count-value',''],['scatter-radius','scatter-radius-value',' m']])$(id).oninput=()=>{$(out).textContent=$(id).value+unit;updateBanner();refreshGhost();};
for(const id of ['pos-x','pos-y','pos-z','rotation','scale','solid'])$(id).onchange=()=>{const placement=selected();if(!placement)return;commit(layout=>{const item=layout.placements.find(value=>value.id===placement.id);item.position=[Number($('pos-x').value),Number($('pos-y').value),Number($('pos-z').value)];item.rotation=Number($('rotation').value)*Math.PI/180;item.scale=Number($('scale').value);item.solid=$('solid').checked;});};
$('transform').onsubmit=event=>event.preventDefault();
$('delete').onclick=deleteSelection;$('multi-delete').onclick=deleteSelection;$('duplicate').onclick=duplicateSelection;$('multi-duplicate').onclick=duplicateSelection;
$('hide-prop').onclick=()=>{const id=state.selection?.id;if(state.selection?.type!=='original')return;commit(layout=>{layout.hiddenProps=layout.hiddenProps.includes(id)?layout.hiddenProps.filter(value=>value!==id):[...layout.hiddenProps,id];});};
for(const id of ['fortifications','lighting'])$(id).onchange=()=>commit(layout=>{layout.settings[id]=$(id).value;});
function history(direction){if(!state.history)return;state.layout=state.history[direction]();setSelection([]);state.spawn.selected=null;persistDraft();refresh();}
$('undo').onclick=()=>history('undo');$('redo').onclick=()=>history('redo');
$('restore-props').onclick=()=>commit(layout=>{layout.hiddenProps=[];});
$('reset').onclick=()=>{commit(layout=>replaceLayout(layout,defaultLayout(state.city)));setSelection([]);refresh();message('Layout reset in this draft. Undo restores it; Save to host applies the reset.');};
$('reload').onclick=async()=>{const city=state.city;try{const saved=await request('/api/layouts/'+city);if(city!==state.city||!state.layout)return;state.saved=layoutSnapshot(saved);commit(layout=>replaceLayout(layout,validateLayout(saved,options())));setSelection([]);refresh();message('Reloaded the saved host layout. Undo restores your previous draft.');}catch(error){message(error.message);}};
$('save').onclick=async()=>{if(!state.layout||state.savePending)return;const city=state.city,snapshot=layoutSnapshot(state.layout);state.savePending=true;refresh();try{const saved=await request('/api/layouts/'+city,{method:'PUT',headers:{'Content-Type':'application/json'},body:snapshot});if(city===state.city){state.saved=layoutSnapshot(saved);persistDraft();overlay.key='';message('Saved '+EDITOR_CITIES[city].name+'. Start a fresh match to use this layout.');}}catch(error){message('Save failed: '+error.message);}finally{state.savePending=false;refresh();}};
$('export').onclick=()=>{if(!state.layout)return;const url=URL.createObjectURL(new Blob([JSON.stringify(state.layout,null,2)+'\n'],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='azeroth-ops-'+state.city+'-layout.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Exported the current layout, including unsaved changes.');};
$('import').onclick=()=>{if(state.layout)$('import-file').click();};
$('import-file').onchange=async()=>{const file=$('import-file').files[0];$('import-file').value='';if(!file)return;try{if(file.size>256*1024)throw new Error('Layout file exceeds 256 KB');const imported=validateLayout(JSON.parse(await file.text()),options());commit(layout=>replaceLayout(layout,imported));setSelection([]);refresh();message('Imported layout into this draft. Save to host to apply it.');}catch(error){message('Import failed: '+error.message);}};
const MOVE_KEYS=new Set(['w','a','s','d','q','e']),NUDGE_KEYS=new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','PageUp','PageDown']);
function cancelPointerWork(){
  if(press&&(press.altDrag||press.marquee)){press=null;clearDragPreview();hideMarquee();requestRender();return true;}
  return false;
}
window.addEventListener('keydown',event=>{
  if(event.key==='Escape'){
    if(cancelPointerWork())return;
    if(state.spawn.active){if(selectedSpawn()){state.spawn.selected=null;refresh();}else setSpawnMode(false);return;}
    if(state.adding)exitPlacing('Placement finished.');else if(state.group.length||state.selection){setSelection([]);refresh();}
    return;
  }
  if(/INPUT|SELECT|TEXTAREA/.test(event.target.tagName))return;
  const key=event.key.toLowerCase(),mod=event.ctrlKey||event.metaKey;view.fastKey=event.shiftKey;
  if(mod&&key==='z'){event.preventDefault();history(event.shiftKey?'redo':'undo');}
  else if(mod&&key==='y'){event.preventDefault();history('redo');}
  else if(mod&&key==='c'){event.preventDefault();copySelection();}
  else if(mod&&key==='v'){event.preventDefault();pasteAtCursor();}
  else if(mod&&key==='d'){event.preventDefault();duplicateSelection();}
  else if(mod&&key==='a'){event.preventDefault();selectAll();}
  else if(event.key==='Delete'&&state.spawn.active&&selectedSpawn()){event.preventDefault();deleteSpawn();}
  else if(event.key==='Delete'&&groupIds().length){event.preventDefault();deleteSelection();}
  else if(mod||event.altKey)return;
  else if(NUDGE_KEYS.has(event.key)){if(event.target.closest?.('#asset-tiles'))return;if(nudge(event))event.preventDefault();}
  else if(MOVE_KEYS.has(key)){view.keys.add(key);view.fastKey=event.shiftKey;requestRender();}
  else if(key==='r')rotateStep(event.shiftKey?-1:1);
  else if(event.key==='[')scaleStep(-1);else if(event.key===']')scaleStep(1);
  else if(key==='f')focusSelection();
  else if(key==='g')toggleGizmoSpace();
  else if(key==='t')startPlacing('scatter');
  else if(key==='p')setSpawnMode(!state.spawn.active);
  else if(key==='v')$('view-toggle').click();
  else if(key==='1')applyGizmoMode('translate');else if(key==='2')applyGizmoMode('rotate');else if(key==='3')applyGizmoMode('scale');
});
window.addEventListener('keyup',event=>{view.keys.delete(event.key.toLowerCase());view.fastKey=event.shiftKey;});
window.addEventListener('blur',()=>{view.keys.clear();});
window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
initRenderer();new ResizeObserver(resize).observe(canvas);resize();
const requested=new URL(location.href).searchParams.get('city');loadCity(Object.hasOwn(EDITOR_CITIES,requested)?requested:'stormwind');

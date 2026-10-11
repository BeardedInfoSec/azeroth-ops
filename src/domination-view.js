import * as THREE from 'three';
// Lightweight world markers for Domination capture points: a flat ring plus a
// pillar per point, tinted by ownership. Purely presentational; the server owns
// all capture state.
export const DOMINATION_COLORS={neutral:0xc9ced1,alliance:0x70b8ff,horde:0xf06a50,contested:0xffd35a};
const neutral=new THREE.Color(DOMINATION_COLORS.neutral);

export class DominationView{
  constructor({scene}){
    this.scene=scene;this.markers=new Map();this.time=0;this.owners=new Map();
    this.ringGeometry=new THREE.RingGeometry(.88,1,64);this.ringGeometry.rotateX(-Math.PI/2);
    this.pillarGeometry=new THREE.CylinderGeometry(.16,.16,7,10,1,true);
    this.discGeometry=new THREE.CircleGeometry(1,48);this.discGeometry.rotateX(-Math.PI/2);
  }
  marker(point){
    let marker=this.markers.get(point.id);if(marker)return marker;
    const group=new THREE.Group(),material=()=>new THREE.MeshBasicMaterial({color:DOMINATION_COLORS.neutral,transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false});
    const ring=new THREE.Mesh(this.ringGeometry,material()),pillar=new THREE.Mesh(this.pillarGeometry,material()),disc=new THREE.Mesh(this.discGeometry,material());
    ring.scale.setScalar(point.radius);disc.scale.setScalar(point.radius);disc.material.opacity=.12;ring.position.y=.06;disc.position.y=.04;pillar.position.y=3.5;
    group.add(disc,ring,pillar);group.position.set(point.x,point.y,point.z);this.scene.add(group);
    marker={group,ring,pillar,disc,contested:false};this.markers.set(point.id,marker);return marker;
  }
  // Returns ownership change events so the caller can announce them.
  setState(domination){
    const events=[],seen=new Set();
    for(const point of domination?.points||[]){
      seen.add(point.id);const marker=this.marker(point);
      const base=point.side?new THREE.Color(DOMINATION_COLORS[point.side]):neutral;
      const color=neutral.clone().lerp(base,Math.max(0,Math.min(1,point.progress)));
      for(const mesh of [marker.ring,marker.pillar,marker.disc])mesh.material.color.copy(color);
      marker.contested=point.contested;
      if(this.owners.has(point.id)&&this.owners.get(point.id)!==point.owner)events.push({point:point.id,owner:point.owner,previous:this.owners.get(point.id)});
      this.owners.set(point.id,point.owner);
    }
    for(const [id,marker] of this.markers)if(!seen.has(id))this.remove(id,marker);
    return events;
  }
  tick(dt){
    this.time+=dt;
    for(const marker of this.markers.values()){
      const pulse=marker.contested?.5+.5*Math.sin(this.time*8):1;
      marker.ring.material.opacity=.45+.35*pulse;marker.pillar.material.opacity=.3+.3*pulse;
      if(marker.contested)for(const mesh of [marker.ring,marker.pillar])mesh.material.color.lerp(new THREE.Color(DOMINATION_COLORS.contested),.5*(1-pulse));
    }
  }
  remove(id,marker){
    marker.group.removeFromParent();for(const mesh of [marker.ring,marker.pillar,marker.disc])mesh.material.dispose();
    this.markers.delete(id);this.owners.delete(id);
  }
  dispose(){
    for(const [id,marker] of [...this.markers])this.remove(id,marker);
    this.ringGeometry.dispose();this.pillarGeometry.dispose();this.discGeometry.dispose();
  }
}

import * as THREE from 'three';
import {traceShot,shotBlocked} from '../ballistics.js';

// Fixed geometry/material storage. Follow a moving barrel once per rendered
// frame, rather than retracing the city during every physics catch-up step.
export class TracerPool {
  constructor(scene,getCover,capacity=32){
    this.scene=scene;this.getCover=getCover;this.next=0;
    this.slots=Array.from({length:capacity},()=>{
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
      const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({transparent:true,opacity:.8}));
      line.visible=false;line.raycast=()=>{};scene.add(line);
      return {line,from:new THREE.Vector3(),to:new THREE.Vector3(),life:0,originAt:null};
    });
  }
  trigger(from,to,color,originAt=null){
    const slot=this.slots[this.next];this.next=(this.next+1)%this.slots.length;
    slot.from.copy(from);slot.to.copy(to);slot.life=.075;slot.originAt=originAt;
    slot.line.material.color.set(color);slot.line.userData.weaponTracer=!!originAt;
    if(!originAt)this.place(slot,from,to);
    else slot.line.visible=false;
  }
  place(slot,from,to){
    const positions=slot.line.geometry.attributes.position;
    positions.setXYZ(0,from.x,from.y,from.z);positions.setXYZ(1,to.x,to.y,to.z);
    positions.needsUpdate=true;slot.line.geometry.computeBoundingSphere();slot.line.visible=true;
  }
  tick(dt){
    for(const slot of this.slots)if(slot.life>0){
      slot.life=Math.max(0,slot.life-dt);
      if(!slot.life){slot.line.visible=false;slot.originAt=null;}
    }
  }
  update(){
    for(const slot of this.slots){
      if(slot.life<=0||!slot.originAt)continue;
      const start=slot.originAt(),cover=this.getCover();
      // A barrel through a wall cannot create a trail on the other side.
      slot.line.visible=!shotBlocked(slot.from,start,cover);
      if(slot.line.visible)this.place(slot,start,traceShot(start,slot.to,cover).point);
    }
  }
  get visibleWeaponTrails(){return this.slots.filter(slot=>slot.life>0&&slot.line.visible&&slot.line.userData.weaponTracer).map(slot=>Array.from(slot.line.geometry.attributes.position.array));}
  reset(){for(const slot of this.slots){slot.life=0;slot.originAt=null;slot.line.visible=false;}this.next=0;}
  dispose(){for(const slot of this.slots){slot.line.removeFromParent();slot.line.geometry.dispose();slot.line.material.dispose();}}
}

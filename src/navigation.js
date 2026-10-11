import * as THREE from 'three';
// A bounded ground graph built from the imported city's actual collision mesh.
// It intentionally excludes disconnected roofs, steep drops and wall crossings.
export class GroundNavigation {
  constructor(spawn,floorAt,blocked,{radius=22,cell=2.5}={}){
    this.nodes=[];this.cell=cell;this.radius=radius;this.origin=spawn.clone();this.floorAt=floorAt;this.blocked=blocked;
    const grid=new Map();
    for(let z=-radius;z<=radius;z++)for(let x=-radius;x<=radius;x++){
      const wx=spawn.x+x*this.cell,wz=spawn.z+z*this.cell;
      const h=floorAt(wx,wz,spawn.y+2.5,22);if(!h||h.face.normal.y<.7)continue;
      const node={id:this.nodes.length,x,z,point:h.point.clone(),edges:[]};this.nodes.push(node);grid.set(x+','+z,node);
    }
    for(const n of this.nodes)for(const [dx,dz] of [[1,0],[0,1]]){
      const next=grid.get((n.x+dx)+','+(n.z+dz));if(!next||Math.abs(next.point.y-n.point.y)>1.1)continue;
      const a=n.point.clone().add(new THREE.Vector3(0,.9,0)),b=next.point.clone().add(new THREE.Vector3(0,.9,0));
      if(blocked(a,b,.25)||blocked(b,a,.25))continue;
      let supported=true;
      for(const t of [.25,.5,.75]){const p=n.point.clone().lerp(next.point,t),h=floorAt(p.x,p.z,p.y+1,2);if(!h||h.face.normal.y<.65||Math.abs(h.point.y-p.y)>.5){supported=false;break;}}
      if(supported){n.edges.push(next.id);next.edges.push(n.id);}
    }
    const start=this.nearest(spawn),visited=new Set(start?[start.id]:[]),queue=start?[start.id]:[];
    for(let i=0;i<queue.length;i++)for(const id of this.nodes[queue[i]].edges)if(!visited.has(id)){visited.add(id);queue.push(id);}
    this.reachable=this.nodes.filter(n=>visited.has(n.id));
    this.cache=new Map();
  }
  nearest(point){let best=null,score=Infinity;for(const n of this.reachable||this.nodes){const d=n.point.distanceToSquared(point);if(d<score){score=d;best=n;}}return best;}
  field(target){
    const node=this.nearest(target);if(!node)return null;
    if(this.cache.has(node.id))return this.cache.get(node.id);
    const distance=new Int32Array(this.nodes.length).fill(-1),queue=[node.id];distance[node.id]=0;
    for(let i=0;i<queue.length;i++)for(const id of this.nodes[queue[i]].edges)if(distance[id]<0){distance[id]=distance[queue[i]]+1;queue.push(id);}
    if(this.cache.size>20)this.cache.clear();this.cache.set(node.id,distance);return distance;
  }
  step(actor,target,speed,dt){
    const from=actor.mesh.position;
    if(from.distanceTo(target)<.8)return false;
    const field=this.field(target),near=this.nearest(from);if(!near||!field)return false;
    let next=near;
    for(const id of near.edges)if(field[id]>=0&&(field[next.id]<0||field[id]<field[next.id]))next=this.nodes[id];
    if(!actor.waypoint||from.distanceTo(actor.waypoint)<.22)actor.waypoint=next.point.clone();
    let destination=actor.waypoint;
    const start=from.clone().add(new THREE.Vector3(0,.9,0)),end=target.clone().add(new THREE.Vector3(0,.9,0));
    if(from.distanceTo(target)<7&&!this.blocked(start,end,.2)){destination=target;actor.waypoint=null;}
    const dir=destination.clone().sub(from);dir.y=0;const distance=dir.length();if(distance<.08)return false;
    dir.multiplyScalar(Math.min(speed*dt,distance)/distance);
    const x=from.x+dir.x,z=from.z+dir.z,h=this.floorAt(x,z,from.y+1,2.5);
    if(!h||h.face.normal.y<.6||Math.abs(h.point.y-from.y)>.85)return false;
    if(this.blocked(start,new THREE.Vector3(x,h.point.y+.9,z),.2)){actor.waypoint=near.point.clone();return false;}
    from.set(x,h.point.y,z);return true;
  }
}

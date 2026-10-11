// Read-only navigation helper for bots. It wraps an existing node graph (the arena's GroundNavigation or a
// graph derived from spawn points) with a spatial hash for nearest-node queries and a bounded cache of
// breadth-first distance fields. The graph itself is never mutated, so one arena can serve many rooms.
import * as T from 'three';

const CELL=5;
export class BotNav{
  /** nodes: [{id,point:Vector3,edges:number[]}]. `reachable` (optional) restricts queries to the connected set. */
  constructor(nodes,{reachable=null,cache=48}={}){
    this.nodes=nodes;this.usable=reachable||nodes;this.cacheLimit=cache;this.fields=new Map();this.hash=new Map();
    for(const n of this.usable){const k=this.key(n.point.x,n.point.z);(this.hash.get(k)||this.hash.set(k,[]).get(k)).push(n);}
  }
  key(x,z){return Math.floor(x/CELL)+','+Math.floor(z/CELL);}
  static fromGroundNavigation(nav){return new BotNav(nav.nodes,{reachable:nav.reachable});}
  // Spawn points form a graph when no navigation mesh is available (synthetic arenas): edges join points
  // that are close together and have an unobstructed straight line between them.
  static fromPoints(points,{link=3.2,blocked=()=>false}={}){
    const nodes=points.map((p,id)=>({id,point:p.clone?p.clone():new T.Vector3(p.x,p.y,p.z),edges:[]})),grid=new Map();
    const key=(x,z)=>Math.floor(x/link)+','+Math.floor(z/link);
    for(const n of nodes){const k=key(n.point.x,n.point.z);(grid.get(k)||grid.set(k,[]).get(k)).push(n);}
    const up=new T.Vector3(0,.9,0);
    for(const n of nodes){
      const cx=Math.floor(n.point.x/link),cz=Math.floor(n.point.z/link);
      for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++)for(const m of grid.get((cx+dx)+','+(cz+dz))||[]){
        if(m.id<=n.id||n.point.distanceTo(m.point)>link||Math.abs(n.point.y-m.point.y)>1.1)continue;
        if(blocked(n.point.clone().add(up),m.point.clone().add(up)))continue;
        n.edges.push(m.id);m.edges.push(n.id);
      }
    }
    return new BotNav(nodes);
  }
  nearest(point,maxDistance=Infinity){
    const cx=Math.floor(point.x/CELL),cz=Math.floor(point.z/CELL);let best=null,score=maxDistance*maxDistance;
    for(let ring=0;ring<=40;ring++){
      if(best&&ring>1&&(ring-1)*CELL>Math.sqrt(score))break;
      for(let dz=-ring;dz<=ring;dz++)for(let dx=-ring;dx<=ring;dx++){
        if(Math.max(Math.abs(dx),Math.abs(dz))!==ring)continue;
        for(const n of this.hash.get((cx+dx)+','+(cz+dz))||[]){const d=n.point.distanceToSquared(point);if(d<score){score=d;best=n;}}
      }
    }
    return best;
  }
  // BFS hop distance from every node to the node nearest `target`; -1 when unreachable.
  field(target){
    const goal=target.id!==undefined&&target.point?target:this.nearest(target);if(!goal)return null;
    const cached=this.fields.get(goal.id);if(cached){this.fields.delete(goal.id);this.fields.set(goal.id,cached);return cached;}
    const distance=new Int32Array(this.nodes.length).fill(-1),queue=[goal.id];distance[goal.id]=0;
    for(let i=0;i<queue.length;i++)for(const id of this.nodes[queue[i]].edges)if(distance[id]<0){distance[id]=distance[queue[i]]+1;queue.push(id);}
    if(this.fields.size>=this.cacheLimit)this.fields.delete(this.fields.keys().next().value);
    const entry={goal,distance};this.fields.set(goal.id,entry);return entry;
  }
  // Node ids from `from` toward the field's goal (inclusive of the first step, excluding the start node).
  path(fromNode,field,limit=12){
    if(!fromNode||!field||field.distance[fromNode.id]<0)return [];
    const out=[];let current=fromNode;
    while(out.length<limit&&field.distance[current.id]>0){
      let next=null;for(const id of current.edges){const d=field.distance[id];if(d>=0&&d<field.distance[current.id]&&(!next||d<field.distance[next.id]))next=this.nodes[id];}
      if(!next)break;out.push(next);current=next;
    }
    return out;
  }
  hops(from,field){const node=from.point?from:this.nearest(from);return node&&field?field.distance[node.id]:-1;}
  // Random usable node within [min,max] metres of a centre; falls back to any usable node.
  randomNode(center,min,max,random){
    const pool=[];
    for(let z=-Math.ceil(max/CELL);z<=Math.ceil(max/CELL);z++)for(let x=-Math.ceil(max/CELL);x<=Math.ceil(max/CELL);x++)
      for(const n of this.hash.get((Math.floor(center.x/CELL)+x)+','+(Math.floor(center.z/CELL)+z))||[]){const d=Math.hypot(n.point.x-center.x,n.point.z-center.z);if(d>=min&&d<=max)pool.push(n);}
    const list=pool.length?pool:this.usable;return list[Math.min(list.length-1,Math.floor(random()*list.length))]||null;
  }
}

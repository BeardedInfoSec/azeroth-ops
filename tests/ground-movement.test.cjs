const test=require('node:test'),assert=require('node:assert/strict');

async function fixture(slope=0,yaw=0){
  const T=await import('three'),{MeshBVH,acceleratedRaycast}=await import('three-mesh-bvh'),{CharacterCollision}=await import('../src/engine/character-collision.js'),movement=await import('../src/engine/ground-movement.js');
  const geometry=new T.PlaneGeometry(40,40).rotateX(-Math.PI/2).rotateZ(Math.atan(slope)).rotateY(yaw);geometry.boundsTree=new MeshBVH(geometry);
  const collider=new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide}));collider.raycast=acceleratedRaycast;
  const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0),floorAt=(x,z,top,max)=>{ray.set(new T.Vector3(x,top,z),down);ray.far=max;return ray.intersectObject(collider)[0]||null;};
  return {T,...movement,CharacterCollision,MeshBVH,collider,floorAt,dispose(){geometry.dispose();collider.material.dispose();}};
}

test('Idle capsules remain stationary on walkable slopes regardless of downhill direction',async()=>{
  for(const [slope,yaw] of [[-.12,0],[.12,0],[-.5,.7],[.5,1.2]]){
    const f=await fixture(slope,yaw),position=new f.T.Vector3(0,2.45,0),solver=new f.CharacterCollision(2.45,.32);let vertical=0,grounded=true;
    try{
      for(let part=0;part<2400;part++){
        const support=f.groundStepHeight(position,position,{grounded,vertical,floorAt:f.floorAt});if(support!==null)position.y=support;
        vertical-=20/480;position.y+=vertical/480;const correction=solver.resolve(position,f.collider);grounded=solver.grounded&&vertical<=0;if(grounded)vertical=0;position.add(correction);
      }
      assert.ok(Math.hypot(position.x,position.z)<1e-7,'slope '+slope+' drifted '+Math.hypot(position.x,position.z)+' metres without input');assert.equal(grounded,true);
    }finally{f.dispose();}
  }
});

test('Walkable slope stabilization preserves full wall and ceiling separation',async()=>{
  const f=await fixture(),solver=new f.CharacterCollision(2.45,.32),geometry=new f.T.BoxGeometry(.1,4,5).translate(.45,2,0);geometry.boundsTree=new f.MeshBVH(geometry);const wall=new f.T.Mesh(geometry);
  try{
    const correction=solver.resolve(new f.T.Vector3(.2,2.45,0),wall);assert.ok(correction.x<-.11,'solid wall still pushes sideways');assert.ok(Math.abs(correction.y)<1e-7,'vertical wall does not become a climbable floor');assert.equal(solver.grounded,false);
    let position=new f.T.Vector3(0,2.45,0);for(let step=0;step<120;step++){position.x+=5.2/120;position.add(solver.resolve(position,wall));}assert.ok(position.x<=.081,'walking cannot penetrate the wall');
  }finally{geometry.dispose();wall.material.dispose();f.dispose();}
});

test('Walking down and up mild ramps stays grounded, so forward movement no longer drops jump presses',async()=>{
  for(const slope of [-.12,.12]){
    const f=await fixture(slope),position=new f.T.Vector3(0,2.45,0),solver=new f.CharacterCollision(2.45,.32);let vertical=0,grounded=true,supported=0;
    try{
      for(let frame=0;frame<120;frame++){
        for(let part=0;part<4;part++){
          const step=1/480,next=position.clone();next.x+=5.2*step;
          const support=f.groundStepHeight(position,next,{grounded,vertical,floorAt:f.floorAt});if(support!==null)position.y=support;
          position.x=next.x;vertical-=20*step;position.y+=vertical*step;const correction=solver.resolve(position,f.collider);
          grounded=solver.grounded&&vertical<=0;if(grounded)vertical=0;position.add(correction);
        }
        if(grounded)supported++;
      }
      assert.equal(supported,120);assert.ok(position.x>5,'walking remains unblocked');
      const jump=new f.GroundJump();jump.press(1);assert.equal(jump.update(1,{grounded,vertical}),7);
    }finally{f.dispose();}
  }
});

test('Jumping while moving clears the floor, preserves horizontal travel, and lands again',async()=>{
  const f=await fixture(),position=new f.T.Vector3(0,2.45,0),solver=new f.CharacterCollision(2.45,.32),jump=new f.GroundJump();let vertical=0,grounded=true,peak=0;
  try{
    jump.press(0);vertical=jump.update(0,{grounded,vertical});grounded=false;
    for(let frame=0;frame<120;frame++)for(let part=0;part<4;part++){
      const step=1/480,next=position.clone();next.x+=5.2*step;
      const support=f.groundStepHeight(position,next,{grounded,vertical,floorAt:f.floorAt});if(support!==null)position.y=support;
      position.x=next.x;vertical-=20*step;position.y+=vertical*step;const correction=solver.resolve(position,f.collider);
      grounded=solver.grounded&&vertical<=0;if(grounded)vertical=0;if(solver.ceiling&&vertical>0)vertical=0;position.add(correction);peak=Math.max(peak,position.y-2.45);
    }
    assert.ok(peak>1.15&&peak<1.3);assert.ok(position.x>5);assert.equal(grounded,true);assert.ok(Math.abs(position.y-2.45)<1e-5);
  }finally{f.dispose();}
});

test('Buffered and coyote jumps are single-use and cannot become an airborne double jump',async()=>{
  const {GroundJump}=await import('../src/engine/ground-movement.js'),jump=new GroundJump();
  jump.update(0,{grounded:true});jump.press(.04);assert.equal(jump.update(.06,{grounded:false,vertical:-1}),7);
  jump.press(.07);assert.equal(jump.update(.08,{grounded:false,vertical:6}),null);
  jump.reset();jump.press(1);assert.equal(jump.update(1,{grounded:false,vertical:-2}),null);assert.equal(jump.update(1.08,{grounded:true}),7);
  jump.press(2);assert.equal(jump.update(2.2,{grounded:true}),null,'expired press does not trigger');
  jump.press(3);assert.equal(jump.update(3,{grounded:true,enabled:false}),null);assert.equal(jump.update(3.01,{grounded:true}),null,'death/pause reset clears pending input');
});

test('Ground snap ignores steep faces, cliffs and upward jumps, and cannot climb tall cover',async()=>{
  const {groundStepHeight}=await import('../src/engine/ground-movement.js'),position={x:0,y:2.45,z:0},next={x:.1,z:0},sample=(y,normal=1)=>()=>({point:{y},face:{normal:{y:normal}}});
  const common={grounded:true,vertical:0};
  assert.equal(groundStepHeight(position,next,{...common,floorAt:sample(-.1)}),2.35);
  for(const y of [-.5,.8])assert.equal(groundStepHeight(position,next,{...common,floorAt:sample(y)}),null);
  assert.equal(groundStepHeight(position,next,{...common,vertical:7,floorAt:sample(.1)}),null);
  assert.equal(groundStepHeight(position,next,{...common,floorAt:sample(.1,.3)}),null);
});

test('Capsule distinguishes ceiling and wall contacts from walkable ground',async()=>{
  const f=await fixture(),solver=new f.CharacterCollision(2.45,.32);const geometry=new f.T.BoxGeometry(5,.2,5).translate(0,2.6,0);geometry.boundsTree=new f.MeshBVH(geometry);const ceiling=new f.T.Mesh(geometry);
  try{
    const correction=solver.resolve(new f.T.Vector3(0,2.55,0),ceiling);assert.ok(correction.y<0);assert.equal(solver.ceiling,true);assert.equal(solver.grounded,false);
    solver.resolve(new f.T.Vector3(0,2.449,0),f.collider);assert.equal(solver.grounded,true);assert.equal(solver.ceiling,false);
  }finally{geometry.dispose();ceiling.material.dispose();f.dispose();}
});

test('LAN zombie pose accepts moving ramp jumps at 20Hz while rejecting cover crossings and teleports',async()=>{
  const f=await fixture(-.12),{ZombieMatch}=await import('../server/zombies.mjs'),local=new f.T.Vector3(0,2.45,0),clientSolver=new f.CharacterCollision(2.45,.32),serverSolver=new f.CharacterCollision(2.45,.32),jump=new f.GroundJump();
  const blockers=new f.T.Group();blockers.add(f.collider);const ray=new f.T.Raycaster();
  const arena={floorAt:f.floorAt,resolve:p=>serverSolver.resolve(p,f.collider),blocked(a,b){const delta=b.clone().sub(a);ray.set(a,delta.clone().normalize());ray.far=delta.length();return !!ray.intersectObject(blockers,true)[0];}};
  const match={arena,spawn:new f.T.Vector3(0,2.45,0),environment:{movementColliders:[]},movement:()=>1},player={status:'alive',hp:100,position:local.toArray(),lastPose:0,fallPeak:null,survival:{perks:new Set()}};
  let grounded=true,vertical=0,accepted=0;
  try{
    for(let frame=0;frame<180;frame++){
      const time=frame/120;if(frame===60)jump.press(time);const launched=jump.update(time,{grounded,vertical});if(launched!==null){vertical=launched;grounded=false;}
      for(let part=0;part<4;part++){
        const step=1/480,next=local.clone();next.x+=5.2*step;const support=f.groundStepHeight(local,next,{grounded,vertical,floorAt:f.floorAt});if(support!==null)local.y=support;
        local.x=next.x;vertical-=20*step;local.y+=vertical*step;const correction=clientSolver.resolve(local,f.collider);grounded=clientSolver.grounded&&vertical<=0;if(grounded)vertical=0;local.add(correction);
      }
      if((frame+1)%6===0){assert.equal(ZombieMatch.prototype.pose.call(match,player,local.clone(),(frame+1)/120*1000),true);accepted++;}
    }
    assert.equal(accepted,30);assert.equal(grounded,true);assert.ok(player.position[0]>7.5);
    const from=new f.T.Vector3().fromArray(player.position),wall=new f.T.Mesh(new f.T.BoxGeometry(.05,4,3),new f.T.MeshBasicMaterial({side:f.T.DoubleSide}));wall.position.copy(from).add(new f.T.Vector3(.12,-1,0));blockers.add(wall);blockers.updateMatrixWorld(true);
    assert.equal(ZombieMatch.prototype.pose.call(match,player,from.clone().add(new f.T.Vector3(.24,0,0)),1550),false,'server still rejects crossing actual cover');
    wall.removeFromParent();wall.geometry.dispose();wall.material.dispose();assert.equal(ZombieMatch.prototype.pose.call(match,player,from.clone().add(new f.T.Vector3(20,0,0)),1600),false,'speed envelope still rejects teleport');
  }finally{f.dispose();}
});

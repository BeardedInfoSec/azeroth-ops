const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(){const T=await import('three'),solver=await import('../src/engine/fortification-motion.js');const wall=(position=[0,0,0],rotation=0,width=6,depth=.24,height=4.5)=>({mesh:{position:new T.Vector3(...position),rotation:{y:rotation}},width,depth,height,open:false});return {...solver,T,wall,v:(x,y,z)=>new T.Vector3(x,y,z)};}
test('Swept fortification movement stops crossings but preserves tangential sliding',async()=>{
 const {resolveFortificationMove:move,wall,v}=await fixture(),w=wall();
 const stopped=move(v(0,2.45,2),v(0,2.45,-20),[w]);assert.ok(stopped.z>=.44&&stopped.z<.45);
 const slide=move(v(0,2.45,1),v(2,2.45,-1),[w]);assert.ok(slide.x>1.99);assert.ok(slide.z>=.44);assert.equal(slide.y,2.45);
});
test('Rotated cabinets use their own axes and opened gates stop colliding',async()=>{
 const {resolveFortificationMove:move,wall,v}=await fixture(),w=wall([0,0,0],Math.PI/2);
 const stop=move(v(2,2.45,0),v(-20,2.45,0),[w]);assert.ok(stop.x>=.44&&stop.x<.45);
 w.open=true;assert.deepEqual(move(v(2,2.45,0),v(-20,2.45,0),[w]).toArray(),[-20,2.45,0]);
});
test('Existing penetrations recover without input and permit retreat instead of trapping the player',async()=>{
 const {resolveFortificationMove:move,blocksFortificationMove:blocked,wall,v}=await fixture(),w=wall(),start=v(0,2.45,.3);
 const fixed=move(start,start,[w]);assert.ok(fixed.z>.44);assert.equal(start.z,.3,'Inputs are not mutated');
 const retreat=move(start,v(0,2.45,2),[w]);assert.ok(retreat.z>1.99);
 assert.equal(blocked(start,v(0,2.45,2),[w]),false);assert.equal(blocked(start,v(0,2.45,-2),[w]),true,'Penetration is not permission to cross the whole wall');
});
test('Capsule height catches low obstacles while allowing movement above their tops',async()=>{
 const {resolveFortificationMove:move,wall,v}=await fixture(),low=wall([0,0,0],0,6,.24,.8);
 const blocked=move(v(0,2.45,2),v(0,2.45,-2),[low]);assert.ok(blocked.z>=.44,'A low rail blocks feet even when eyes are above it');
 const above=move(v(0,4,2),v(0,4,-2),[low]);assert.equal(above.z,-2);
});
test('Sliding into a corner cannot tunnel through either wall and reverse input escapes',async()=>{
 const {resolveFortificationMove:move,wall,v}=await fixture(),walls=[wall(),wall([3,0,0],Math.PI/2)];
 const corner=move(v(0,2.45,2),v(10,2.45,-10),walls);assert.ok(corner.z>=.44);assert.ok(corner.x<=2.56);
 const escaped=move(corner,corner.clone().add(v(-2,0,2)),walls);assert.ok(escaped.x<corner.x-1.99&&escaped.z>corner.z+1.99);
});

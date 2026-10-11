const test=require('node:test'),assert=require('node:assert/strict');
async function fixture(){
  const {CoopSurvival}=await import('../src/coop-survival.js'),sent=[],room={phase:'playing'},client=Object.create(CoopSurvival.prototype),state={holding:true};
  Object.assign(client,{getRoom:()=>room,getId:()=> 'me',self:{status:'alive'},send:m=>sent.push(m),isHolding:()=>state.holding,reviveTarget:()=>({id:'ally',name:'Ally'}),stashTarget:()=>null,target:()=>({id:'machine',type:'perk'}),draw(){},visuals:new Map(),rules:{perks:new Set(),zones:new Set([0]),points:500},effects:{machineMarkers:new Map()},environment:{interactions:[]},inputHeld:false,inputTarget:null,sendTime:0,repairTime:0});
  return {client,sent,room,state};
}
test('co-op sends hold heartbeats and release without running local purchases or damage',async()=>{
  const {client,sent,state}=await fixture();client.tick(.01);assert.deepEqual(sent,[{type:'interact',held:true,target:'ally'}]);
  client.tick(.1);assert.equal(sent.length,1);client.tick(.05);assert.equal(sent.length,2);
  client.onReload({fractionEmpty:1});client.onLand(10);client.onShot(0);client.awardHit(1,100,true,true);assert.equal(client.rules.points,500);
  state.holding=false;client.tick(.01);assert.equal(sent.at(-1).held,false);assert.equal(client.inputHeld,false);
});
test('menu cancellation and ended matches release revival holds',async()=>{
  const {client,sent,room}=await fixture();client.tick(.01);client.cancel();assert.deepEqual(sent.at(-1),{type:'interact',held:false});
  client.tick(.01);room.phase='ended';client.tick(.01);assert.equal(sent.at(-1).held,false);assert.equal(client.focus,null);
});
test('a downed player can only request their authorized self recovery, and dead players cannot interact',async()=>{
  const {client,sent}=await fixture();client.self.status='downed';client.tick(.01);assert.ok(!sent.some(m=>m.held));
  client.self.selfRecovery={left:15,hold:0,required:8};client.tick(.01);assert.deepEqual(sent.at(-1),{type:'interact',held:true,target:'me'});
  client.self.status='dead';client.tick(.01);assert.equal(sent.at(-1).held,false);
});
test('a teammate revive takes priority over a machine or personal stash',async()=>{
  const {client,sent}=await fixture();client.stashTarget=()=>({id:'stash'});client.tick(.01);assert.equal(sent.at(-1).target,'ally');assert.equal(client.focus,null);
  client.reviveTarget=()=>null;client.tick(.01);assert.equal(sent.at(-1).target,'stash');
});
test('committing to a revive locks weapon actions from the first held frame',async()=>{
  const {client,state,room}=await fixture();assert.equal(client.reviving,true);
  state.holding=false;assert.equal(client.reviving,false);state.holding=true;room.phase='ended';assert.equal(client.reviving,false);
  room.phase='playing';client.self.status='downed';assert.equal(client.reviving,false);
});

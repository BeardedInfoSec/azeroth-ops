// Pure VM checks of the real handlers: no browser, pointer lock, renderer or assets.
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/game.js'),'utf8');
async function captureFixture(request){
  const {matchStamp,sameDeployment}=await import('../src/match-session.mjs');let releases=0,refreshes=0,focused=true;
  const game={requestPointerLock:request},context=vm.createContext({pendingMatchCapture:null,networkActive:true,active:false,lobby:{room:{phase:'playing',code:'ONE',loadGeneration:1,layoutRevision:'v1'}},document:{hidden:false,hasFocus:()=>focused},$:()=>game,matchStamp,sameDeployment,weaponAudio:{unlock(){}},releaseMouse(){releases++;},refreshMatchScreen(){refreshes++;}});
  const start=source.indexOf('async function captureMatchControls('),end=source.indexOf('function autoDeploy(',start);assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),context);
  return {context,get releases(){return releases;},get refreshes(){return refreshes;},focus:value=>focused=value};
}

test('Repeated resume gestures share one outstanding cursor capture request',async()=>{
  let calls=0,complete;const pending=new Promise(resolve=>complete=resolve),f=await captureFixture(()=>{calls++;return pending;});
  const a=f.context.captureMatchControls(),b=f.context.captureMatchControls();await Promise.resolve();assert.equal(calls,1);
  complete();await Promise.all([a,b]);assert.equal(f.context.pendingMatchCapture,null);assert.equal(f.releases,0);
});

test('Cursor capture completing after a room change or focus loss immediately releases control',async()=>{
  for(const changed of ['room','focus']){
    let complete;const f=await captureFixture(()=>new Promise(resolve=>complete=resolve));const promise=f.context.captureMatchControls();await Promise.resolve();
    if(changed==='room')f.context.lobby.room={...f.context.lobby.room,code:'TWO'};else f.focus(false);
    complete();await promise;assert.equal(f.releases,1);assert.equal(f.context.pendingMatchCapture,null);
  }
});

test('A synchronous browser denial cannot poison the next manual resume attempt',async()=>{
  let calls=0;const f=await captureFixture(()=>{if(++calls===1)throw Error('Browser denied pointer lock');return Promise.resolve();});
  await f.context.captureMatchControls();assert.equal(f.refreshes,1);assert.equal(f.context.pendingMatchCapture,null);
  await f.context.captureMatchControls();assert.equal(calls,2);assert.equal(f.context.pendingMatchCapture,null);
});

test('Authoritative airborne correction clears stale grounded and buffered jump state',async()=>{
  const T=await import('three'),{GroundJump}=await import('../src/engine/ground-movement.js'),groundJump=new GroundJump();groundJump.update(10,{grounded:true});groundJump.press(10);
  const context=vm.createContext({networkActive:true,player:new T.Vector3(0,2.45,0),velocity:new T.Vector3(5,0,0),vertical:7,grounded:true,airbornePeak:9,groundJump});
  const start=source.indexOf('function handleNetwork('),end=source.indexOf('function tickNetwork(',start);assert.ok(start>=0&&end>start);vm.runInContext(source.slice(start,end),context);
  context.handleNetwork({type:'correct',position:[1,5,2]});assert.deepEqual(context.player.toArray(),[1,5,2]);assert.equal(context.vertical,0);assert.equal(context.velocity.length(),0);assert.equal(context.grounded,false);assert.equal(context.airbornePeak,null);
  assert.equal(groundJump.update(10,{grounded:false,vertical:0}),null,'correction is not a new opportunity for an airborne jump');
});

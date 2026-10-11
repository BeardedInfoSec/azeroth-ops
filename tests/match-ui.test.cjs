const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/game.js'),'utf8');
const functionText=(name,next)=>source.slice(source.indexOf('function '+name+'('),source.indexOf('function '+next+'('));

test('Alt-tab and unlocked input stay in the match UI rather than returning to the lobby',async()=>{
  const {sessionScreen}=await import('../src/match-session.mjs'),room={phase:'playing'};
  assert.equal(sessionScreen(room,{locked:true}),'live');assert.equal(sessionScreen(room,{locked:false,focused:false}),'away');assert.equal(sessionScreen(room,{locked:false,focused:true}),'resume');
  for(const phase of ['loading','countdown','ended'])assert.equal(sessionScreen({phase},{locked:false}),phase);
  assert.equal(sessionScreen({phase:'waiting'}),'lobby');assert.equal(sessionScreen(null),'lobby');
});

test('Automatic deployment attempts cursor capture once, only for a focused playing client',async()=>{
  const {matchStamp}=await import('../src/match-session.mjs');let focused=true,captures=0;
  const context=vm.createContext({matchStamp,networkActive:true,active:false,autoDeployStamp:'',document:{hidden:false,hasFocus:()=>focused},captureMatchControls:()=>captures++});
  vm.runInContext(functionText('autoDeploy','deploy').replace(/async\s*$/,''),context);
  const room={code:'ABC',loadGeneration:1,layoutRevision:'1:a',phase:'countdown'};context.autoDeploy(room);assert.equal(captures,0);
  room.phase='playing';context.autoDeploy(room);context.autoDeploy(room);assert.equal(captures,1);
  focused=false;context.autoDeploy({...room,loadGeneration:2});assert.equal(captures,1);focused=true;context.autoDeploy({...room,loadGeneration:2});assert.equal(captures,1,'Returning focus cannot steal the mouse');
  context.networkActive=false;context.autoDeploy({...room,loadGeneration:3});assert.equal(captures,1);
});

test('Leaving the session restores lobby and home visibility without needing another pointer-lock event',async()=>{
  const {inMatchPhase}=await import('../src/match-session.mjs'),nodes=new Map(),classes=new Set(['lobby-open']);
  const context=vm.createContext({inMatchPhase,active:false,networkActive:true,matchUI:{update(){}},lobby:{room:{phase:'playing'}},$:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);},document:{hidden:false,hasFocus:()=>true,body:{classList:{contains:name=>classes.has(name),toggle:(name,on)=>classes[on?'add':'delete'](name)}}}});
  vm.runInContext(functionText('refreshMatchScreen','captureMatchControls').replace(/async\s*$/,''),context);
  context.refreshMatchScreen();assert.equal(nodes.get('menu').hidden,true);assert.equal(nodes.get('multiplayer-panel').hidden,true);
  context.lobby.room={phase:'waiting'};context.networkActive=false;context.refreshMatchScreen();assert.equal(nodes.get('hud').hidden,true);assert.equal(nodes.get('multiplayer-panel').hidden,false);
  context.lobby.room=null;classes.delete('lobby-open');context.refreshMatchScreen();assert.equal(nodes.get('menu').hidden,false);assert.equal(nodes.get('multiplayer-panel').hidden,true);
});

test('Shared countdown uses the host deadline and local receipt time without requiring synchronized PC clocks',async()=>{
  const {countdownRemaining,sameDeployment}=await import('../src/match-session.mjs');
  const room={phase:'countdown',startsAt:123000,serverNow:120000,code:'A',loadGeneration:2,layoutRevision:'2:xyz'};
  assert.equal(countdownRemaining(room,900,1400),2.5);assert.equal(countdownRemaining(room,900,5000),0);
  assert.equal(sameDeployment(room,{...room}),true);assert.equal(sameDeployment(room,{...room,loadGeneration:1}),false);
});

function documentFixture(){
  const nodes=new Map();
  const node=()=>({textContent:'',hidden:false,disabled:false,value:'',dataset:{},children:[],get options(){return this.children;},setAttribute(){},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;}});
  return {nodes,get:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node};
}
test('Session panel shows everyone loading, then countdown, live, resume and results with leader permissions',async t=>{
  const old=global.document,d=documentFixture();global.document={getElementById:d.get,createElement:d.createElement};t.after(()=>{global.document=old;});
  const {MatchUI}=await import('../src/match-ui.js');let resumed=0,transferred=null;
  const panel=new MatchUI({onResume:()=>resumed++,onLeave(){},onReturn(){},onTransfer:id=>transferred=id,onClass(){}});
  const room={phase:'loading',code:'ABC',host:'me',city:'stormwind',mode:'tdm',players:[{id:'me',name:'Me',team:'alliance',loaded:true,kills:0,deaths:0},{id:'friend',name:'Friend',team:'horde',loaded:false,loadProgress:.5,loadStage:'Building collision',kills:0,deaths:0}]};
  panel.setRoom(room,'me',{classes:[{name:'Assault'}],activeClass:0});panel.update({locked:false});
  assert.equal(d.get('match-session').hidden,false);assert.match(d.get('session-detail').textContent,/1 \/ 2/);assert.equal(d.get('session-resume').hidden,true);assert.equal(d.get('session-roster').children[1].children[2].value,.5);
  d.get('session-leader').value='friend';d.get('session-transfer').onclick();assert.equal(transferred,'friend');
  room.phase='countdown';room.serverNow=1000;room.startsAt=4000;panel.setRoom(room,'me');panel.update({now:panel.receivedAt+1000});assert.equal(d.get('session-countdown').textContent,'2');
  room.phase='playing';panel.setRoom(room,'me');panel.update({locked:true});assert.equal(d.get('match-session').hidden,true);
  panel.update({locked:false,focused:false});assert.equal(d.get('match-session').dataset.screen,'away');assert.equal(d.get('session-resume').disabled,true);
  panel.update({locked:false,focused:true});assert.equal(d.get('session-resume').disabled,false);d.get('session-resume').onclick();assert.equal(resumed,1);
  const choice=d.get('session-leader').children[0];room.players[0].kills++;panel.setRoom(room,'me');assert.equal(d.get('session-leader').children[0],choice,'Score updates preserve open leadership choices');
  room.host='friend';room.phase='ended';room.winner='alliance';panel.setRoom(room,'me');panel.update();assert.equal(d.get('session-return').hidden,true);assert.equal(d.get('session-host-tools').hidden,true);assert.match(d.get('session-detail').textContent,/ALLIANCE/);
});

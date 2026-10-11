const test=require('node:test'),assert=require('node:assert/strict');

// Exercise menu decisions without a browser, WebGL, sockets, or asset loading.
function dom(){
  const nodes=new Map();
  const node=()=>({textContent:'',value:'',hidden:false,disabled:false,children:[],dataset:{},classes:new Set(),classList:{toggle(name,on){this.owner.classes[on?'add':'delete'](name);},contains(name){return this.owner.classes.has(name);}},get options(){return this.children;},append(...children){this.appendCalls=(this.appendCalls||0)+1;for(const child of children){if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(c=>c!==child);child.parentElement=this;this.children.push(child);}},replaceChildren(...children){this.children=children;},closest(selector){return this.parents?.[selector]||(this.parents={...this.parents,[selector]:make()})[selector];}});
  const make=()=>{const n=node();n.classList.owner=n;return n;};
  const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);};
  return {get,document:{body:get('body'),getElementById:get,querySelector:get,querySelectorAll:()=>[],dispatchEvent(){},createElement:make}};
}
function player(id,team='alliance',extra={}){return {id,team,name:id,race:team==='alliance'?'human':'orc',ready:true,loaded:true,loadout:{name:'Assault'},hp:100,kills:0,deaths:0,status:'alive',...extra};}
async function fixture(t,mode='zombies',players=[player('host')]){
  const old=global.document,d=dom();global.document=d.document;t.after(()=>{global.document=old;});
  const {Lobby}=await import('../src/lobby.js'),lobby=Object.create(Lobby.prototype);
  lobby.id='host';lobby.room={host:'host',code:'ABC123',phase:'waiting',mode,city:'stormwind',target:50,duration:600,players,score:{alliance:0,horde:0},zombies:{wave:2}};
  lobby.renderClass=()=>{lobby.classRenders=(lobby.classRenders||0)+1;};lobby.status=text=>{lobby.lastStatus=text;};
  return {...d,lobby};
}

test('One ready survivor can start co-op and the lobby explains city gear',async t=>{
  const {lobby,get}=await fixture(t);lobby.renderRoom();
  assert.equal(get('room-start').disabled,false);assert.equal(get('room-target').closest('label').hidden,true);assert.equal(get('room-duration').closest('label').hidden,true);
  assert.equal(get('.team-rosters').hidden,true);assert.equal(get('room-zombies-brief').hidden,false);assert.equal(get('royale-player-count').textContent,'1 / 4');
  assert.match(get('class-mode-note').textContent,/do not apply/);assert.match(get('lobby-loadout-summary').textContent,/AN-94/);assert.match(get('operator-mode-title').textContent,/NO FRIENDLY FIRE/);
  lobby.room.players[0].ready=false;lobby.renderRoom();assert.equal(get('room-start').disabled,true);
  lobby.room.players=Array.from({length:5},(_,i)=>player(i?'p'+i:'host'));lobby.renderRoom();assert.equal(get('room-start').disabled,true);
});

test('Co-op roster shows revive status and snapshots preserve stable controls',async t=>{
  const {lobby,get}=await fixture(t,'zombies',[player('host'),player('friend','horde',{status:'downed',hp:0})]);lobby.room.phase='playing';lobby.renderRoom();
  const roster=get('roster-royale'),first=roster.children[0];assert.match(roster.children[1].children[1].textContent,/NEEDS REVIVE/);assert.match(get('room-phase').textContent,/WAVE 2 \/ 1 STANDING/);
  lobby.room.players[0].position=[3,4,5];lobby.renderRoom();assert.equal(roster.children[0],first);assert.equal(lobby.classRenders||0,0);
  lobby.room.players[1].status='alive';lobby.room.players[1].hp=40;lobby.renderRoom();assert.doesNotMatch(roster.children[1].children[1].textContent,/NEEDS REVIVE/);
});

test('TDM and Royale retain their distinct start requirements when switching modes',async t=>{
  const {lobby,get}=await fixture(t,'tdm',[player('host'),player('friend')]);lobby.renderRoom();assert.equal(get('room-start').disabled,true);
  lobby.room.players[1]=player('friend','horde');lobby.renderRoom();assert.equal(get('room-start').disabled,false);assert.equal(get('room-target').closest('label').hidden,false);
  lobby.room.mode='royale';lobby.room.players[1]=player('friend');lobby.renderRoom();assert.equal(get('room-start').disabled,false);assert.equal(get('room-royale-brief').hidden,false);assert.equal(get('royale-player-count').textContent,'2 / 10');
  lobby.room.players.pop();lobby.renderRoom();assert.equal(get('room-start').disabled,true);
  lobby.room.mode='zombies';lobby.renderRoom();assert.equal(get('room-start').disabled,false);assert.equal(get('lobby-customize-loadout').hidden,true);
  lobby.room.mode='tdm';lobby.renderRoom();assert.equal(get('lobby-customize-loadout').hidden,false);assert.equal(get('room-zombies-brief').hidden,true);assert.equal(get('.team-rosters').hidden,false);
});

test('Browser cards distinguish four-survivor co-op rooms from ten-player PvP',async t=>{
  const {lobby,get}=await fixture(t);lobby.renderRooms([{host:'A',mode:'zombies',city:'stormwind',code:'AAA',count:3},{host:'B',mode:'tdm',city:'dalaran',code:'BBB',count:3}]);
  const cards=get('room-list').children;assert.equal(cards[0].children[1].textContent,'3 / 4');assert.equal(cards[1].children[1].textContent,'3 / 10');assert.match(cards[0].children[0].children[1].textContent,/UNDEAD CO-OP/);
});

test('Faction and race controls work from Play and Operator without being recreated during lobby updates',async t=>{
  const {lobby,get,document}=await fixture(t,'tdm');document.body.classList.toggle('lobby-open',true);
  const faction=get('faction'),race=get('race');for(const team of ['alliance','horde']){const choice=document.createElement('option');choice.value=team;faction.append(choice);}
  lobby.operator=document.createElement('div');lobby.operator.append(faction,race);let changes=0;race.onchange=()=>changes++;
  lobby.setView('play');lobby.renderRoom();assert.equal(lobby.operator.parentElement,get('room-operator-controls'));assert.equal(get('room-operator').hidden,false);assert.equal(faction.disabled,false);assert.equal(race.disabled,false);
  const placements=get('room-operator-controls').appendCalls;lobby.room.players[0].position=[1,2,3];lobby.renderRoom();assert.equal(get('room-operator-controls').appendCalls,placements,'snapshots must not close an open selector');
  lobby.setView('operator');assert.equal(lobby.operator.parentElement,get('lobby-operator'));assert.equal(lobby.operator.children[1],race);race.onchange();assert.equal(changes,1);
  lobby.setView('play');assert.equal(lobby.operator.parentElement,get('room-operator-controls'));race.onchange();assert.equal(changes,2,'existing change handlers survive moving between tabs');
  lobby.room.phase='loading';lobby.renderRoom();assert.equal(faction.disabled,true);assert.equal(race.disabled,true);assert.equal(get('room-operator').hidden,true);
  lobby.room.phase='waiting';lobby.renderRoom();assert.equal(faction.disabled,false);assert.equal(race.disabled,false);assert.equal(get('room-operator').hidden,false);
});

test('Full TDM factions are unavailable and become selectable when a slot opens or the mode changes',async t=>{
  const {lobby,get,document}=await fixture(t,'tdm',[player('host'),...Array.from({length:5},(_,i)=>player('h'+i,'horde'))]);document.body.classList.toggle('lobby-open',true);lobby.operator=document.createElement('div');lobby.view='play';
  const choices=['alliance','horde'].map(value=>{const choice=document.createElement('option');choice.value=value;return choice;});get('faction').append(...choices);
  lobby.renderRoom();assert.equal(choices[0].disabled,false);assert.equal(choices[1].disabled,true);assert.match(choices[1].textContent,/FULL/);
  lobby.room.players.pop();lobby.renderRoom();assert.equal(choices[1].disabled,false);assert.equal(choices[1].textContent,'Horde');
  lobby.room.players.push(player('h4','horde'));lobby.room.mode='royale';lobby.renderRoom();assert.equal(choices[1].disabled,false);
  lobby.room=null;lobby.renderRoom();assert.equal(lobby.operator.parentElement,get('lobby-operator'));assert.equal(get('race').disabled,false);
});

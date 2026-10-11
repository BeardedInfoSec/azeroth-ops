import {migrateStore,SCHEMA_VERSION} from './loadout-rules.mjs';
import {summaryLine} from './loadout-view.mjs';
import {ClassBuilder} from './loadout-ui.js';
import {raceTraits,racialWeapons} from './racial-traits.mjs';
import {mergeRoomLayout} from './room-layout.mjs';
import {dominationTargets,isTeamMode} from './domination-rules.mjs';
import {requiredLevel,isUnlocked,rankName} from './progression.mjs';
import {checkCallsign,checkTag,defaultCallsign,formatName} from './names.mjs';
import {botsSupported} from './bot-rules.mjs';
export const CLASS_STORAGE_KEY='ao-classes-v2',LEGACY_CLASS_STORAGE_KEY='ao-classes-v1';
const $=id=>document.getElementById(id),option=(value,text)=>{const o=document.createElement('option');o.value=value;o.textContent=text;return o;};
export class Lobby{
  constructor(onMessage){
    this.operator=document.querySelector('.operator-select');this.operatorAnchor=document.createComment('operator controls');this.operator.before(this.operatorAnchor);
    this.onMessage=onMessage;this.id=null;this.room=null;this.connected=false;this.activeClass=0;this.view='play';this.classes=migrateStore(null).classes;
    for(const button of document.querySelectorAll('[data-lobby-view]'))button.addEventListener('click',()=>this.setView(button.dataset.lobbyView));
    // Saved classes: v2 store, else migrate the v1 store without loss (v1 is left untouched as a backup).
    try{let raw=null;try{raw=localStorage.getItem(CLASS_STORAGE_KEY)??localStorage.getItem(LEGACY_CLASS_STORAGE_KEY);}catch{}const store=migrateStore(raw?JSON.parse(raw):null);this.classes=store.classes;this.activeClass=store.active;}catch{}
    this.progress=null;
    this.classSummary=document.createElement('section');this.classSummary.className='class-summary';this.classSummary.setAttribute('aria-label','Equipped weapon comparison');if($('class-weapon-preview'))$('class-weapon-preview').append(this.classSummary);else $('class-mode-note').before(this.classSummary);
    this.builder=new ClassBuilder(this,$);this.renderClass();
    $('lobby-open').onclick=()=>{this.open();};$('lobby-close').onclick=()=>{if(this.room)return this.status('Leave the lobby before returning to solo practice.');$('multiplayer-panel').hidden=true;document.body.classList.remove('lobby-open');this.operatorAnchor.after(this.operator);for(const id of ['faction','race'])$(id).disabled=false;};
    $('room-create').onclick=()=>{this.profile();this.send({type:'create'});};$('room-join').onclick=()=>{this.profile();this.send({type:'join',code:$('room-code').value.trim()});};
    $('room-leave').onclick=()=>this.send({type:'leave'});$('room-ready').onclick=()=>this.send({type:'ready',ready:!this.room?.players.find(p=>p.id===this.id)?.ready});$('room-start').onclick=()=>this.send({type:'start'});$('room-return').onclick=()=>this.send({type:'return'});
    $('room-refresh').onclick=()=>this.send({type:'list'});$('room-enter').onclick=()=>this.onMessage({type:'enter'});
    for(const id of ['room-mode','room-map','room-target','room-duration'])$(id).onchange=()=>this.send({type:'settings',mode:$('room-mode').value,city:$('room-map').value,target:Number($('room-target').value),duration:Number($('room-duration').value)});
    $('mode').addEventListener('change',()=>{$('solo-royale-brief').hidden=$('mode').value!=='royale';});
    this.initIdentity();this.initBots();
    for(const id of ['faction','race'])$(id).addEventListener('change',()=>this.profile());
    fetch('/api/server').then(r=>r.json()).then(data=>{$('lan-address').textContent=data.addresses?.[0]||location.origin;}).catch(()=>{$('lan-address').textContent=location.origin;});
    this.renderRacialTrait();this.setView('play');
  }
  get loadout(){return this.classes[this.activeClass];}
  // Session token: a bearer secret kept in this browser. No accounts or passwords (LAN project).
  token(){
    if(this.sessionToken)return this.sessionToken;let t=null;try{t=localStorage.getItem('ao-session-v1');}catch{}
    if(!/^[A-Za-z0-9_-]{16,64}$/.test(t||'')){const b=new Uint8Array(24);crypto.getRandomValues(b);t=btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');try{localStorage.setItem('ao-session-v1',t);}catch{}}
    return this.sessionToken=t;
  }
  // Level that unlocks class slot i (0-based), or 0 when it is available.
  slotLock(i){const id='slot:'+(i+1);return this.progress&&!isUnlocked(this.progress,id)?requiredLevel(id):0;}
  setProgress(profile){this.progress=profile;this.renderClass();this.renderRank();}
  renderRank(){
    const p=this.progress,badge=$('rank-badge');if(!badge)return;badge.hidden=!p;if(!p)return;
    $('rank-level').textContent=p.level;$('rank-name').textContent=rankName(p.level).toUpperCase();
    $('rank-fill').style.width=Math.round((p.progress?.fraction??1)*100)+'%';
    $('rank-xp').textContent=p.level>=(p.maxLevel||30)?'MAX RANK / '+p.xp+' XP':p.progress.into+' / '+p.progress.needed+' XP TO LVL '+(p.level+1);
  }
  modePresentation(mode='tdm'){
    if(this.presentationMode===mode)return;this.presentationMode=mode;
    const royale=mode==='royale',zombies=mode==='zombies',shared=royale||zombies,domination=mode==='domination';$('room-target').replaceChildren(...dominationTargets(mode).map(v=>option(v,v)));
    $('multiplayer-panel').classList.toggle('is-royale',royale);$('multiplayer-panel').classList.toggle('is-zombies',zombies);$('lobby-mode-format').textContent=zombies?'1–4 / CO-OP':royale?'SOLO / FREE FOR ALL':domination?'5v5 / DOMINATION':'5v5 / TDM';$('lobby-mode-rule').textContent=zombies?'STAND TOGETHER. SURVIVE.':royale?'LAST PLAYER STANDING':domination?'HOLD THE POINTS':'HORDE VS ALLIANCE';
    for(const id of ['room-target','room-duration'])$(id).closest('label').hidden=shared;
    $('room-royale-brief').hidden=!royale;$('room-zombies-brief').hidden=!zombies;$('roster-royale').closest('.royale-roster').hidden=!shared;document.querySelector('.team-rosters').hidden=shared;$('shared-roster-title').textContent=zombies?'SURVIVORS / ONE SQUAD':'OPERATORS / FREE FOR ALL';
    $('class-mode-note').textContent=zombies?'Saved classes do not apply in Undead Co-op. Everyone starts with an AN-94 and buys weapons and perks in the city.':royale?'Deploy with your selected class. One life per match; changes made after deployment equip next match.':'Classes save automatically. During a match, changes equip on your next respawn.';
    $('lobby-loadout-label').textContent=zombies?'STARTING WEAPON':'ACTIVE CLASS';$('lobby-customize-loadout').hidden=zombies;if(zombies)$('lobby-loadout-summary').textContent='AN-94 / BUY WEAPONS IN THE CITY';else this.renderClass();
    $('operator-mode-eyebrow').textContent=zombies?'CHOOSE YOUR SURVIVOR':royale?'CHOOSE YOUR IDENTITY':'CHOOSE YOUR ALLEGIANCE';$('operator-mode-description').textContent=zombies?'Horde and Alliance survive together. Choose a passive that suits your role.':royale?'Choose your race and passive. Every other operator is a rival.':'Stand with your faction. Choose your race and passive.';$('operator-mode-title').textContent=zombies?'ONE SQUAD / NO FRIENDLY FIRE':royale?'EVERY OPERATOR FOR THEMSELVES':'FACTION WARFARE';$('operator-mode-note').textContent=zombies?'Up to four survivors from either faction. Hold E near a downed teammate to revive. Race locks when the match starts.':royale?'Your race has a passive and its own appearance. Every other operator is an opponent.':'Five races per faction, each with a passive. Your team and race lock when the match starts.';
  }
  renderRacialTrait(){
    const trait=raceTraits($('race').value);$('racial-trait-name').textContent=trait.name;$('racial-trait-description').textContent=trait.description;this.renderClass();
  }
  placeOperatorControls(){
    if(!this.operator)return;
    const waiting=!this.room||this.room.phase==='waiting';
    $('room-operator').hidden=!this.room||!waiting;
    for(const id of ['faction','race'])$(id).disabled=!waiting;
    for(const choice of $('faction').options){
      const full=isTeamMode(this.room?.mode)&&this.room.players.filter(p=>p.id!==this.id&&p.team===choice.value).length>=5;
      choice.disabled=!!full;const label=(choice.value==='alliance'?'Alliance':'Horde')+(full?' / FULL':'');if(choice.textContent!==label)choice.textContent=label;
    }
    if(!document.body.classList.contains('lobby-open'))return;
    const target=$(this.view==='play'&&this.room?'room-operator-controls':'lobby-operator');
    // Reuse the same selectors, handlers and racial passive in both views.
    // Avoid reparenting on routine snapshots, which would close an open select.
    if(this.operator.parentElement!==target)target.append(this.operator);
  }
  setView(view){
    if(!['play','classes','operator'].includes(view))return;
    this.view=view;$('multiplayer-panel').dataset.view=view;
    for(const button of document.querySelectorAll('[data-lobby-view]')){const selected=button.dataset.lobbyView===view;button.classList.toggle('active',selected);button.setAttribute('aria-selected',String(selected));}
    for(const name of ['play','classes','operator']){const pane=$('lobby-'+name+'-view');if(pane)pane.hidden=name!==view;}
    this.placeOperatorControls();
    document.dispatchEvent(new CustomEvent('lobbyviewchange',{detail:{view}}));
  }
  selectClass(index){
    if(!Number.isInteger(index)||!this.classes[index])return;
    const lock=this.slotLock(index);if(lock){this.status('Class '+(index+1)+' unlocks at level '+lock+'.',true);return;}
    const restoreFocus=document.activeElement?.matches?.('[data-class-slot]');this.activeClass=index;this.builder.openSlot=null;this.persist();this.renderClass();this.profile();
    if(restoreFocus)$('class-slots')?.querySelector('[data-class-slot="'+index+'"]')?.focus({preventScroll:true});
  }
  // The builder hands over an already validated loadout for the active class.
  commitClass(loadout,message){
    this.classes[this.activeClass]=loadout;this.persist();this.renderClass();this.profile();
    this.status(message||(this.room?.mode==='zombies'?'Class saved for TDM and Battle Royale. Co-op uses city weapons.':this.room?.phase==='playing'?(this.room.mode==='royale'?'Class saved for your next match.':'Class queued for your next respawn.'):'Class saved on this browser.'),true);
  }
  // Replace the whole list (copy / reset); the active class is re-sent if it changed.
  setClasses(classes,message){const before=JSON.stringify(this.loadout);this.classes=classes;this.persist();this.renderClass();if(JSON.stringify(this.loadout)!==before)this.profile();this.status(message,true);}
  persist(){try{localStorage.setItem(CLASS_STORAGE_KEY,JSON.stringify({version:SCHEMA_VERSION,classes:this.classes,active:this.activeClass}));}catch{}}
  renderClass(){this.builder?.render();this.renderSummary();}
  renderSummary(){
    const c=this.loadout;if(!c)return;
    if($('lobby-loadout-summary'))$('lobby-loadout-summary').textContent=this.room?.mode==='zombies'?'AN-94 / BUY WEAPONS IN THE CITY':summaryLine(c).toUpperCase();
  }
  profile(){this.renderRacialTrait();this.send({type:'profile',slot:this.activeClass,...this.identityPayload(),team:$('faction').value,race:$('race').value,loadout:this.loadout});}
  status(text,notice=false){if(notice)this.noticeUntil=Date.now()+3500;else if(Date.now()<this.noticeUntil)return;if($('lobby-status').textContent!==text)$('lobby-status').textContent=text;}
  send(m){if(this.ws?.readyState===WebSocket.OPEN)this.ws.send(JSON.stringify(m));else if(m.type!=='profile')this.status('Connecting to the LAN server...');}
  open(){document.body.classList.add('lobby-open');$('multiplayer-panel').hidden=false;$('lobby-operator').append(this.operator);this.setView('play');if(!this.ws||this.ws.readyState>1)this.connect();}
  connect(){
    this.status('Connecting...');this.ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/multiplayer');
    this.ws.onopen=()=>{this.connected=true;this.reconnectUntil=0;this.send({type:'hello',token:this.token()});this.profile();this.status('Connected. Create a lobby or join a room.');};
    this.ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.type==='welcome')this.id=m.id;if(m.type==='profile'){this.setProgress(m.profile);this.adoptProfileIdentity(m.profile);return;}if(m.type==='callsign'){this.onCallsign(m);return;}if(m.type==='xp'){document.dispatchEvent(new CustomEvent('aoxp',{detail:m}));return;}if(m.type==='rooms')this.renderRooms(m.rooms);if(m.type==='room'){m.room=mergeRoomLayout(this.room,m.room);if(!this.room||this.room.phase!==m.room.phase||this.room.mode!==m.room.mode)this.noticeUntil=0;this.room=m.room;this.renderRoom();}if(m.type==='left'){this.room=null;this.renderRoom();}if(m.type==='error')this.status(m.message,true);this.onMessage(m);};
    this.ws.onclose=()=>{const wasInRoom=!!this.room;this.connected=false;this.room=null;this.renderRoom();this.status('Disconnected. Reopen LAN multiplayer to reconnect.');this.onMessage({type:'disconnected'});
      // The server holds a dropped seat for 60 s; retry quietly inside that window.
      if(wasInRoom||this.reconnectUntil){this.reconnectUntil||=Date.now()+60000;if(Date.now()<this.reconnectUntil){this.status('Connection lost. Reconnecting to your match...',true);setTimeout(()=>{if(!this.ws||this.ws.readyState>1)this.connect();},2000);}}};this.ws.onerror=()=>this.status('Cannot reach multiplayer. Restart the updated server.');
  }
  renderRooms(rooms){
    const signature=JSON.stringify(rooms);if(this.roomsSignature===signature)return;this.roomsSignature=signature;$('room-list').replaceChildren();
    for(const r of rooms){const button=document.createElement('button'),identity=document.createElement('span'),name=document.createElement('strong'),detail=document.createElement('small'),count=document.createElement('b');button.className='room-card';name.textContent=r.host+"'s lobby";detail.textContent=r.city.toUpperCase()+' / '+(r.mode==='zombies'?'UNDEAD CO-OP':r.mode==='royale'?'BATTLE ROYALE':r.mode==='domination'?'DOMINATION':'TEAM DEATHMATCH')+' / '+r.code;identity.append(name,detail);count.textContent=r.count+' / '+(r.mode==='zombies'?4:10);button.append(identity,count);button.onclick=()=>{this.profile();this.send({type:'join',code:r.code});};$('room-list').append(button);}
    if(!rooms.length){const empty=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('p');empty.className='rooms-empty';title.textContent='Your squad starts here.';detail.textContent='No open lobbies yet. Create a private match, then share your room code with friends on this network.';empty.append(title,detail);$('room-list').append(empty);}
  }
  renderRoom(){
    this.placeOperatorControls();
    const r=this.room;this.modePresentation(r?.mode||'tdm');$('room-browser').hidden=!!r;$('room-detail').hidden=!r;if(!r){this.rosterSignature=null;for(const team of ['alliance','horde','royale']){$('roster-'+team).replaceChildren();const empty=document.createElement('p');empty.className='roster-slots';empty.textContent=(team==='royale'?10:5)+' OPEN SLOTS';$('roster-'+team).append(empty);}for(const id of ['faction','race'])$(id).disabled=false;this.lockIdentity(null);return;}
    const host=r.host===this.id,waiting=r.phase==='waiting',royale=r.mode==='royale',zombies=r.mode==='zombies',shared=royale||zombies,self=r.players.find(p=>p.id===this.id),eliminated=self?.deployment==='eliminated',wave=r.zombies?.wave||1;
    $('lobby-map-name').textContent=r.city.toUpperCase();$('room-title').textContent='LOBBY '+r.code;
    $('room-phase').textContent=r.phase==='countdown'?'DEPLOYING IN '+Math.ceil(r.countdown):r.phase==='playing'?(zombies?'WAVE '+wave+' / '+r.players.filter(p=>p.status==='alive').length+' STANDING':royale?(r.royale?.alive??r.players.filter(p=>p.hp>0).length)+' REMAINING':r.score.alliance+' ALLIANCE : '+r.score.horde+' HORDE'):r.phase==='ended'?(zombies?'SQUAD LOST / WAVE '+wave:royale?(r.royale?.winnerName?r.royale.winnerName.toUpperCase()+' WINS':'MATCH COMPLETE'):(r.winner==='draw'?'DRAW':r.winner.toUpperCase()+' VICTORY')):r.phase.toUpperCase();
    for(const [id,value] of [['room-mode',r.mode||'tdm'],['room-map',r.city],['room-target',r.target],['room-duration',r.duration]]){if($(id).value!==String(value))$(id).value=value;$(id).disabled=!host||!waiting;}
    // Position snapshots must not rebuild the menu while someone is clicking or reading it.
    const rosterSignature=JSON.stringify([r.host,r.phase,r.mode,r.players.map(p=>[p.id,p.team,p.name,p.tag,p.bot,p.race,p.loadout?.name,p.ready,p.loaded,p.kills,p.deaths,p.hp>0,p.deployment,p.status])]);
    if(rosterSignature!==this.rosterSignature){
      this.rosterSignature=rosterSignature;
      for(const team of (shared?['royale']:['alliance','horde'])){
        const roster=$('roster-'+team),players=shared?r.players:r.players.filter(p=>p.team===team);roster.replaceChildren();
        for(const p of players){
          const row=document.createElement('div');row.className='roster-player';row.classList.toggle('is-ready',waiting&&p.ready);row.classList.toggle('is-downed',zombies&&p.status==='downed');row.classList.toggle('is-bot',!!p.bot);
          const name=document.createElement('strong');name.textContent=formatName(p)+(p.id===r.host?' / LEADER':'')+(p.id===this.id?' / YOU':'');
          const state=waiting?(p.ready?'READY':'NOT READY'):r.phase==='loading'?(p.loaded?'MAP READY':'LOADING MAP'):zombies?(p.status==='downed'?'NEEDS REVIVE':p.status==='dead'?'WAITING FOR NEXT WAVE':'ALIVE')+' / '+p.kills+' K':royale?(p.deployment==='eliminated'?'ELIMINATED':(typeof p.deployment==='string'?p.deployment.toUpperCase():'ALIVE'))+' / '+p.kills+' K':p.kills+' K / '+p.deaths+' D';
          const detail=document.createElement('small');detail.textContent=p.race+' / '+(zombies?raceTraits(p.race).name:p.loadout.name)+' / '+state;row.append(name,detail);if(host&&waiting&&p.bot){const kick=document.createElement('button');kick.className='roster-transfer roster-kick-bot';kick.textContent='KICK BOT';kick.onclick=()=>this.send({type:'bot-remove',id:p.id});row.append(kick);}else if(host&&waiting&&p.id!==this.id){const transfer=document.createElement('button');transfer.className='roster-transfer';transfer.textContent='MAKE LEADER';transfer.onclick=()=>this.send({type:'transfer-host',targetId:p.id});row.append(transfer);}roster.append(row);
        }
        const slots=document.createElement('p');slots.className='roster-slots';slots.textContent=Math.max(0,(zombies?4:royale?10:5)-players.length)+' OPEN SLOTS';roster.append(slots);
      }
    }
    const ready=r.players.filter(p=>p.ready).length,teamsPresent=zombies?r.players.length>=1&&r.players.length<=4:royale?r.players.length>=2:['alliance','horde'].every(team=>r.players.some(p=>p.team===team));
    $('room-ready').hidden=!waiting;$('room-ready').textContent=self?.ready?'UNREADY':'READY UP';$('room-start').hidden=!host||!waiting;$('room-start').disabled=!teamsPresent||ready!==r.players.length;$('room-return').hidden=!host||r.phase!=='ended';$('room-enter').hidden=true;$('room-enter').textContent=royale&&eliminated?'SPECTATE MATCH':zombies&&self?.status==='dead'?'WATCH SQUAD':'ENTER MATCH';$('royale-player-count').textContent=r.players.length+' / '+(zombies?4:10);
    this.status(waiting?(!teamsPresent?(zombies?'Undead Co-op supports one to four survivors from either faction.':royale?'Waiting for an opponent: two players are required. Factions do not form teams.':'Waiting for an opponent: each faction needs at least one player.'):ready<r.players.length?ready+' / '+r.players.length+' ready. '+(zombies?'Choose your survivor and ready up.':'Choose your class and ready up.'):host?'Everyone is ready. Start the match when you are ready.':'Everyone is ready. Waiting for the lobby leader to start.'):r.phase==='loading'?'Loading '+r.city+': '+r.players.filter(p=>p.loaded).length+' / '+r.players.length+' players ready.':r.phase==='countdown'?(zombies?'The squad is deploying. Protect the boards and save points for upgrades.':royale?'Prepare to deploy. Space to jump / WASD to glide. One life; last player standing wins.':'Both teams are deploying. Your class is locked in for this life.'):r.phase==='ended'?'Match complete. The lobby leader can return everyone to the lobby.':zombies?'Hold E near a downed teammate to revive. Buy weapons, perks and zones in the city. Escape opens the match menu; the wave continues.':royale?(eliminated?'You are eliminated. Spectate the remaining operators until the match ends.':'Space to jump / WASD to glide. Stay inside the safe zone. Escape opens the match menu; the match continues.'):'Live LAN match. Escape opens the match menu; the match continues.');
    for(const id of ['faction','race'])$(id).disabled=!waiting;
    this.renderBots(r,host,waiting);this.lockIdentity(r);
  }
  // ---- Callsign + clan tag (rules in names.mjs; the server re-validates and is authoritative) ----
  initIdentity(){
    let name=null,tag='';try{name=localStorage.getItem('ao-player-name');tag=localStorage.getItem('ao-player-tag')||'';}catch{}
    const stored=checkCallsign(name),storedTag=checkTag(tag);
    this.adoptProfileName=!name;
    const callsign=stored.ok&&!stored.profane?stored.name:defaultCallsign();
    $('player-name').value=callsign;$('player-tag').value=storedTag.ok?storedTag.tag:'';this.storeIdentity();
    for(const id of ['player-name','player-tag']){$(id).addEventListener('input',()=>this.validateIdentity());$(id).addEventListener('change',()=>this.commitIdentity());}
    this.validateIdentity();
  }
  storeIdentity(){try{localStorage.setItem('ao-player-name',$('player-name').value.trim());localStorage.setItem('ao-player-tag',$('player-tag').value.trim());}catch{}}
  // Live feedback only. Text is always assigned with textContent.
  validateIdentity(){
    const name=checkCallsign($('player-name').value),tag=checkTag($('player-tag').value);
    const message=!name.ok?name.reason:name.profane?'That callsign is not allowed.':!tag.ok?tag.reason:'';
    const box=$('name-feedback');
    $('player-name').setAttribute?.('aria-invalid',String(!name.ok||!!name.profane));$('player-tag').setAttribute?.('aria-invalid',String(!tag.ok));
    if(box){box.textContent=message||('Shown as: '+formatName({name:name.name,tag:tag.tag}));box.classList.toggle('invalid',!!message);}
    return !message;
  }
  identityPayload(){
    if(!this.validateIdentity())return {};
    const name=checkCallsign($('player-name').value),tag=checkTag($('player-tag').value);
    return {name:name.name,tag:tag.tag};
  }
  commitIdentity(){if(!this.validateIdentity())return;this.storeIdentity();this.profile();}
  onCallsign(m){
    const box=$('name-feedback');
    if(m.ok===false&&m.reason){if(box){box.textContent=m.reason;box.classList.toggle('invalid',true);}return;}
    if(m.baseName&&$('player-name').value!==m.baseName){$('player-name').value=m.baseName;}
    if($('player-tag').value!==(m.tag||'')&&checkTag($('player-tag').value).ok&&checkTag($('player-tag').value).tag!==(m.tag||''))$('player-tag').value=m.tag||'';
    this.storeIdentity();
    if(box){box.textContent=m.notice||('Shown as: '+formatName({name:m.name,tag:m.tag}));box.classList.toggle('invalid',false);}
  }
  // A browser with no stored callsign takes the one saved on its profile.
  adoptProfileIdentity(profile){
    if(!this.adoptProfileName||!profile?.callsign||profile.callsign==='Operator')return;
    this.adoptProfileName=false;$('player-name').value=profile.callsign;$('player-tag').value=profile.tag||'';this.storeIdentity();this.validateIdentity();
  }
  lockIdentity(r){const locked=!!r&&!['waiting','ended'].includes(r.phase);for(const id of ['player-name','player-tag'])$(id).disabled=locked;}
  // ---- AI operators (host controls; the server enforces every limit) ----
  initBots(){
    if(!$('room-bots'))return;
    $('bots-add-alliance').onclick=()=>this.send({type:'bot-add',team:'alliance'});$('bots-add-horde').onclick=()=>this.send({type:'bot-add',team:'horde'});
    $('bots-difficulty').onchange=()=>this.send({type:'bot-settings',difficulty:$('bots-difficulty').value});
    $('bots-fill').onchange=()=>this.send({type:'bot-settings',fill:!!$('bots-fill').checked,target:Number($('bots-target').value)});
    $('bots-target').onchange=()=>this.send({type:'bot-settings',target:Number($('bots-target').value)});
  }
  renderBots(r,host,waiting){
    const panel=$('room-bots');if(!panel)return;
    const supported=botsSupported(r.mode);panel.hidden=!supported;if(!supported)return;
    const bots=r.bots||{difficulty:'normal',fill:false,target:6},royale=r.mode==='royale',editable=host&&waiting;
    $('bots-difficulty').value=bots.difficulty;$('bots-fill').checked=!!bots.fill;$('bots-target').value=String(bots.target);
    for(const id of ['bots-difficulty','bots-fill','bots-target','bots-add-alliance','bots-add-horde'])$(id).disabled=!editable;
    $('bots-add-alliance').textContent=royale?'+ ADD BOT (ALLIANCE)':'+ ALLIANCE BOT';$('bots-add-horde').textContent=royale?'+ ADD BOT (HORDE)':'+ HORDE BOT';
    const count=r.players.filter(p=>p.bot).length;
    $('bots-note').textContent=(count?count+(count===1?' BOT':' BOTS')+' IN LOBBY / ':'')+(editable?'BOTS NEVER EARN PROFILE XP':host?'LOCKED DURING THE MATCH':'ONLY THE LEADER CAN CHANGE BOTS');
  }
}

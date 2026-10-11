import {sessionScreen,countdownRemaining} from './match-session.mjs';
import {formatName} from './names.mjs';
const text=(element,value)=>{if(element.textContent!==value)element.textContent=value;};
const modeName=mode=>({tdm:'TEAM DEATHMATCH',royale:'BATTLE ROYALE',zombies:'UNDEAD CO-OP',domination:'DOMINATION'}[mode]||'PRIVATE MATCH');

export class MatchUI{
  constructor({onResume,onLeave,onReturn,onTransfer,onClass}){
    this.root=document.getElementById('match-session');this.room=null;this.receivedAt=0;this.signature='';
    this.byId=id=>document.getElementById(id);
    this.byId('session-resume').onclick=onResume;this.byId('session-leave').onclick=onLeave;this.byId('session-return').onclick=onReturn;
    this.byId('session-transfer').onclick=()=>onTransfer(this.byId('session-leader').value);
    this.byId('session-class').onchange=()=>onClass(Number(this.byId('session-class').value));
    this.xp=null;document.addEventListener?.('aoxp',event=>{this.xp=event.detail;this.renderXp();});
  }
  setRoom(room,id,{classes=[],activeClass=0}={}){
    this.room=room;this.id=id;this.receivedAt=performance.now();
    if(!room)return;
    if(room.phase==='loading'&&this.xp){this.xp=null;this.renderXp();}
    const signature=JSON.stringify([room.code,room.phase,room.host,room.mode,room.players.map(p=>[p.id,p.name,p.tag,p.bot,p.team,p.ready,p.loaded,Math.floor((p.loadProgress||0)*100),p.loadStage,p.kills,p.deaths,p.status]),classes,activeClass]);
    if(signature===this.signature)return;this.signature=signature;
    text(this.byId('session-mode'),modeName(room.mode));text(this.byId('session-map'),room.city.toUpperCase());
    const leader=room.players.find(p=>p.id===room.host);text(this.byId('session-room'),'LOBBY '+room.code+' / LEADER '+(leader?formatName(leader):'ASSIGNING'));
    const roster=this.byId('session-roster');roster.replaceChildren();
    for(const player of room.players){
      const row=document.createElement('div');row.className='session-player '+player.team;
      const name=document.createElement('strong');name.textContent=formatName(player)+(player.id===id?' / YOU':'')+(player.id===room.host?' / LEADER':'');
      const status=document.createElement('span');status.textContent=room.phase==='loading'?(player.loaded?'READY':(player.loadStage||'Waiting for map')+' / '+Math.round((player.loadProgress||0)*100)+'%'):room.phase==='countdown'?'DEPLOYMENT READY':room.mode==='zombies'?(player.status||'alive').toUpperCase()+' / '+player.kills+' K':player.kills+' K / '+player.deaths+' D';
      row.append(name,status);
      if(room.phase==='loading'){const progress=document.createElement('progress');progress.max=1;progress.value=player.loaded?1:player.loadProgress||0;progress.setAttribute('aria-label',formatName(player)+' map loading');row.append(progress);}
      roster.append(row);
    }
    const isHost=room.host===id;
    const choicesSignature=JSON.stringify([room.players.map(p=>[p.id,p.name,p.tag,p.bot]),classes,activeClass]);
    if(choicesSignature!==this.choicesSignature){
      this.choicesSignature=choicesSignature;
      const select=this.byId('session-leader'),old=select.value;
      select.replaceChildren(...room.players.filter(p=>p.id!==id&&!p.bot).map(p=>{const option=document.createElement('option');option.value=p.id;option.textContent=formatName(p);return option;}));
      if([...select.options].some(option=>option.value===old))select.value=old;
      const classSelect=this.byId('session-class');classSelect.replaceChildren(...classes.map((entry,index)=>{const option=document.createElement('option');option.value=index;option.textContent=entry.name;return option;}));classSelect.value=String(activeClass);
    }
    this.byId('session-host-tools').hidden=!isHost||room.players.length<2;
    this.byId('session-return').hidden=!isHost||room.phase!=='ended';
    this.byId('session-class-wrap').hidden=room.mode==='zombies'||!['playing','ended'].includes(room.phase);
    text(this.byId('session-class-note'),room.mode==='royale'?'Equips next match.':'Equips on your next respawn.');
  }
  renderXp(){
    const root=this.byId('session-xp');if(!root)return;const xp=this.xp;root.replaceChildren();root.hidden=!xp;if(!xp)return;
    const make=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e;};
    const head=make('div','xp-head');head.append(make('small','', 'MATCH REWARDS'),make('strong','','+'+xp.xp+' XP'));root.append(head);
    const list=make('ul','xp-lines');for(const line of xp.breakdown||[]){const li=make('li');li.append(make('span','',line.label+(line.count>1?' x'+line.count:'')),make('b','','+'+line.xp));list.append(li);}root.append(list);
    if(xp.capped)root.append(make('p','xp-note','Some rewards were reduced by per-match limits.'));
    const p=xp.profile,bar=make('div','xp-bar'),fill=make('i');fill.style.width=Math.round((p?.progress?.fraction??1)*100)+'%';bar.append(fill);
    root.append(make('p','xp-rank','LVL '+xp.levelAfter+' / '+(xp.rank||'').toUpperCase()),bar);
    if(xp.levelUps>0)root.append(make('p','xp-levelup','LEVEL UP x'+xp.levelUps));
    for(const item of xp.unlockedItems||[])root.append(make('p','xp-unlock','UNLOCKED: '+item.name+' ('+item.kind+')'));
  }
  update({locked=false,focused=true,now=performance.now()}={}){
    const room=this.room,screen=sessionScreen(room,{locked,focused});this.root.hidden=['lobby','live'].includes(screen);
    this.root.dataset.screen=screen;
    if(this.root.hidden)return;
    const countdown=Math.ceil(countdownRemaining(room,this.receivedAt,now)),loading=screen==='loading',ready=room.players.filter(p=>p.loaded).length;
    const title=loading?'PREPARING THE BATTLEFIELD':screen==='countdown'?'DEPLOYING TOGETHER':screen==='ended'?'MATCH COMPLETE':screen==='away'?'YOU ARE AWAY':'MATCH IN PROGRESS';
    const detail=loading?ready+' / '+room.players.length+' OPERATORS READY — EVERYONE DEPLOYS TOGETHER':screen==='countdown'?'GET READY / YOUR SQUAD IS IN POSITION':screen==='ended'?(room.winner==='draw'?'DRAW':room.royale?.winnerName?room.royale.winnerName+' WINS':room.winner?room.winner.toUpperCase()+' VICTORY':'Operation complete'):screen==='away'?'Your connection stays active. Return here and click to resume.':'Click to resume control. The match continues while this menu is open.';
    const xpBox=this.byId('session-xp');if(xpBox)xpBox.hidden=screen!=='ended'||!this.xp;
    text(this.byId('session-title'),title);text(this.byId('session-detail'),detail);
    const count=this.byId('session-countdown');count.hidden=screen!=='countdown';text(count,String(Math.max(1,countdown)));
    this.byId('session-resume').hidden=!['resume','away'].includes(screen);
    this.byId('session-resume').disabled=!focused;
  }
}

// Domination strip: [alliance score bar] [A][B][C] [horde score bar]. The model
// comes from dominationHudModel(); styling lives in domination.css / the theme.
export function renderDominationHud(root,model){
  if(!root)return;
  const active=!!model&&model.points.length>0;if(root.hidden===active)root.hidden=!active;
  if(!active)return;
  if(!root.firstChild){
    const make=(tag,cls)=>{const e=document.createElement(tag);e.className=cls;return e;};
    for(const team of ['alliance','horde']){
      const side=make('div','dom-side '+team),score=make('b','dom-score'),bar=make('i','dom-bar'),fill=make('i','dom-fill');bar.append(fill);side.append(score,bar);side.dataset.team=team;root.append(side);
      if(team==='alliance'){const points=make('div','dom-points');points.setAttribute('role','list');root.append(points);}
    }
  }
  const points=root.querySelector('.dom-points');
  if(points.children.length!==model.points.length)points.replaceChildren(...model.points.map(p=>{const e=document.createElement('span');e.className='dom-point';e.setAttribute('role','listitem');e.dataset.point=p.id;e.textContent=p.id;return e;}));
  model.points.forEach((p,i)=>{
    const e=points.children[i];const owner=p.owner||'none',side=p.side||'none';
    if(e.dataset.state!==p.state)e.dataset.state=p.state;if(e.dataset.owner!==owner)e.dataset.owner=owner;if(e.dataset.side!==side)e.dataset.side=side;
    const progress=String(Math.round(p.progress*100));if(e.style.getPropertyValue('--progress')!==progress)e.style.setProperty('--progress',progress);
    e.classList.toggle('contested',p.contested);
  });
  for(const team of ['alliance','horde']){
    const side=root.querySelector('.dom-side.'+team),score=side.querySelector('.dom-score'),fill=side.querySelector('.dom-fill'),value=String(model.label[team]);
    if(score.textContent!==value)score.textContent=value;const width=Math.round(model.bars[team]*1000)/10+'%';if(fill.style.width!==width)fill.style.width=width;
  }
}

// Thin DOM layer for the Armory class builder. All decisions (what is locked, what costs what, what a
// choice does) come from the pure modules src/loadout-view.mjs and src/loadout-rules.mjs.
// No WebGL here: the 3D weapon inspect canvas is driven by src/game.js, which reads the hidden
// #class-primary select. This builder writes the *inspected* gun index into it (hover/focus an
// option to preview that gun; otherwise the weapon of the slot you are editing).
import {GUNS} from './weapon-data.js';
import {exportClass,importClass,MAX_NICKNAME} from './loadout-rules.mjs';
import {
  classTabs,budgetMeter,slotGrid,GROUP_TITLES,slotOptions,applyChoice,statCard,classRows,classNotes,
  copyClassTo,resetClassAt,renameClass,setNickname,
} from './loadout-view.mjs';

const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const GROUP_ORDER=['weapons','attachments','perks','equipment','wildcards','style'];

export class ClassBuilder{
  constructor(lobby,$){
    this.lobby=lobby;this.$=$;this.openSlot=null;this.inspectIndex=null;this.resetArmedUntil=0;
    $('class-primary').replaceChildren(...GUNS.map((g,i)=>{const o=make('option','',g.name);o.value=i;return o;}));
    $('class-name').onchange=()=>this.commit(renameClass(this.lobby.loadout,$('class-name').value));
    $('class-copy').onclick=()=>this.copy();
    $('class-reset').onclick=()=>this.reset();
    $('class-share-toggle').onclick=()=>{const open=$('class-share').hidden;$('class-share').hidden=!open;$('class-share-toggle').setAttribute('aria-expanded',String(open));};
    $('class-export').onclick=()=>this.exportText();
    $('class-import').onclick=()=>this.importText();
  }
  get c(){return this.lobby.loadout;}
  say(text,notice=true){const m=this.$('class-share-msg');if(m)m.textContent=text;this.lobby.status(text,notice);}
  commit(loadout,message){this.lobby.commitClass(loadout,message);}

  // ---- actions ----------------------------------------------------------------------------------------------------------
  copy(){
    const to=Number(this.$('class-copy-target').value),from=this.lobby.activeClass,lock=this.lobby.slotLock(to);
    if(!Number.isInteger(to)||to===from||!this.lobby.classes[to])return this.say('Choose a different class slot to copy to.');
    if(lock)return this.say('Class '+(to+1)+' unlocks at level '+lock+'.');
    this.lobby.setClasses(copyClassTo(this.lobby.classes,from,to),'Copied to class '+(to+1)+'.');
  }
  reset(){
    const button=this.$('class-reset'),now=Date.now();
    if(now>this.resetArmedUntil){this.resetArmedUntil=now+3000;button.textContent='CONFIRM RESET';setTimeout(()=>{if(Date.now()>=this.resetArmedUntil)button.textContent='RESET';},3100);return;}
    this.resetArmedUntil=0;button.textContent='RESET';
    this.lobby.setClasses(resetClassAt(this.lobby.classes,this.lobby.activeClass),'Class reset to its preset.');
  }
  exportText(){
    const text=exportClass(this.c);this.$('class-json').value=text;this.$('class-json').select?.();
    try{navigator.clipboard?.writeText(text).then(()=>this.say('Class string copied to the clipboard.'),()=>this.say('Class string ready to copy.'));}catch{this.say('Class string ready to copy.');}
  }
  importText(){
    const r=importClass(this.$('class-json').value,{profile:this.lobby.progress});
    if(!r.ok)return this.say(r.error);
    const extra=[r.violations.length?'Locked items were swapped.':'',...r.notes].filter(Boolean).join(' ');
    this.commit(r.loadout,'Class imported.'+(extra?' '+extra:''));
  }
  choose(option){
    if(option.locked)return this.say('Unlocks at level '+option.level+'.');
    if(option.disabled)return this.say(option.reason);
    const result=applyChoice(this.c,this.openSlot,option.id,this.lobby.progress);
    if(!result.ok)return this.say(result.reason);
    this.commit(result.loadout,result.notes.length?result.notes.join(' '):undefined);
  }
  inspect(index){
    const value=Number.isInteger(index)?index:this.defaultInspect();
    if(this.inspectIndex===value)return;this.inspectIndex=value;this.$('class-primary').value=String(value);
  }
  defaultInspect(){return this.openSlot?.startsWith('secondary')?this.c.secondary:this.c.primary;}

  // ---- rendering -----------------------------------------------------------------------------------------------------------
  render(){
    const {$}=this,c=this.c,lobby=this.lobby,profile=lobby.progress;
    // tabs
    const tabs=$('class-slots');tabs.replaceChildren();
    for(const t of classTabs(lobby.classes,lobby.activeClass,profile)){
      const b=make('button','class-slot-card'),n=make('small','','CLASS '+t.number),name=make('strong','',t.name),w=make('span','',t.primary+' / '+t.secondary),pts=make('span','pick-count',t.cost+' / 10 PTS');
      b.type='button';b.dataset.classSlot=t.index;b.classList.toggle('active',t.active);b.classList.toggle('is-locked',t.locked);b.setAttribute('aria-pressed',String(t.active));
      b.append(n,name,w,pts);if(t.locked){const lock=make('span','lvl-lock','LVL '+t.level);b.append(lock);b.setAttribute('aria-disabled','true');}
      b.onclick=()=>lobby.selectClass(t.index);tabs.append(b);
    }
    if($('class-name').value!==c.name)$('class-name').value=c.name;
    // copy targets
    const target=$('class-copy-target'),previous=target.value;
    target.replaceChildren(...lobby.classes.map((entry,i)=>{const o=make('option','',(i+1)+' / '+entry.name+(lobby.slotLock(i)?' [LVL '+lobby.slotLock(i)+']':''));o.value=i;o.disabled=i===lobby.activeClass;return o;}));
    target.value=previous&&Number(previous)!==lobby.activeClass?previous:String((lobby.activeClass+1)%lobby.classes.length);
    // legacy hidden slot list kept for older callers
    $('class-slot').replaceChildren(...lobby.classes.map((entry,i)=>{const o=make('option','',(i+1)+' / '+entry.name);o.value=i;return o;}));$('class-slot').value=String(lobby.activeClass);
    // meter
    const meter=budgetMeter(c);$('pick10-text').textContent=meter.text;$('pick10-meter').classList.toggle('is-over',meter.over);$('pick10-meter').setAttribute('aria-valuenow',String(meter.used));
    $('pick10-meter').title=meter.lines.map(l=>l.label+' '+l.cost).join(' / ');
    $('pick10-pips').replaceChildren(...meter.pips.map(on=>make('i',on?'on':'')));
    // grid
    const grid=$('class-builder-grid'),slots=slotGrid(c);grid.replaceChildren();
    for(const group of GROUP_ORDER){
      const section=make('section','cb-group'),list=make('div','cb-slots');section.dataset.group=group;section.append(make('h3','',GROUP_TITLES[group]));
      for(const s of slots.filter(x=>x.group===group)){
        const b=make('button','cb-slot'),value=make('strong','cb-value',s.value||(s.available?'EMPTY':'LOCKED'));
        b.type='button';b.dataset.slot=s.id;b.disabled=!s.available;b.classList.toggle('is-empty',s.empty);b.classList.toggle('is-open',this.openSlot===s.id);b.setAttribute('aria-expanded',String(this.openSlot===s.id));
        b.append(make('small','cb-label',s.label),value);
        if(s.cost)b.append(make('b','cb-cost','-'+s.cost));
        if(s.hint)b.append(make('small','cb-hint',s.hint));
        b.onclick=()=>{this.openSlot=this.openSlot===s.id?null:s.id;this.inspectIndex=null;this.render();this.$('class-picker').querySelector('.cb-option:not(:disabled)')?.focus?.({preventScroll:true});};
        list.append(b);
      }
      section.append(list);grid.append(section);
    }
    this.renderPicker(meter);
    this.renderStats();
    this.inspect(this.hoverIndex);
    lobby.renderSummary?.();
  }
  renderPicker(meter){
    const {$}=this,box=$('class-picker'),c=this.c,focused=document.activeElement?.dataset?.option;box.replaceChildren();
    if(!this.openSlot){
      box.append(make('h3','','SELECT A SLOT'),make('p','cb-picker-note','Choose a slot on the left to see its options. Every item costs points; your class holds '+meter.max+'. You have '+meter.remaining+' left.'),
        make('p','cb-picker-note','Locked items show the level that unlocks them. Wildcards open extra slots.'));
      return;
    }
    const slot=slotGrid(c).find(s=>s.id===this.openSlot);if(!slot){this.openSlot=null;return this.renderPicker(meter);}
    box.append(make('h3','',slot.label),make('p','cb-picker-note',slot.hint||'Points left: '+meter.remaining+' of '+meter.max+'.'));
    const list=make('ul','cb-options'),isGun=this.openSlot==='primary'||this.openSlot==='secondary';
    for(const o of slotOptions(c,this.openSlot,this.lobby.progress)){
      const li=make('li'),b=make('button','cb-option');b.type='button';b.dataset.option=String(o.id);
      b.classList.toggle('is-selected',o.selected);b.classList.toggle('is-locked',o.locked);b.classList.toggle('is-disabled',o.disabled);b.classList.toggle('is-placeholder',o.placeholder);
      b.setAttribute('aria-pressed',String(o.selected));if(o.locked||o.disabled)b.setAttribute('aria-disabled','true');
      const head=make('span','cb-option-head');
      if(o.tint!==undefined){const sw=make('i','cb-swatch');if(o.tint)sw.style.background=o.tint;head.append(sw);}
      head.append(make('strong','',o.name));if(o.tag)head.append(make('small','cb-tag',o.tag));if(o.cost)head.append(make('b','cb-cost',o.cost+(o.cost===1?' PT':' PTS')));
      b.append(head);
      if(o.summary)b.append(make('span','cb-summary',o.summary));
      if(o.stats){const bars=make('span','cb-bars');for(const s of o.stats){const row=make('span','cb-bar');row.style.setProperty('--stat-fill',s.fill+'%');row.append(make('small','',s.label),make('i'));bars.append(row);}b.append(bars);}
      if(o.disabled&&o.reason)b.append(make('span','cb-reason',o.reason));
      if(o.locked)b.append(make('span','cb-lock','LVL '+o.level));
      b.onclick=()=>this.choose(o);
      if(isGun&&Number.isInteger(o.id)){const gunIndex=o.id;const preview=()=>{this.hoverIndex=gunIndex;this.inspect(gunIndex);};const leave=()=>{this.hoverIndex=null;this.inspect(null);};b.onmouseenter=preview;b.onfocus=preview;b.onmouseleave=leave;b.onblur=leave;}
      li.append(b);list.append(li);
    }
    box.append(list);
    if(focused!==undefined)box.querySelector('[data-option="'+CSS.escape(focused)+'"]')?.focus?.({preventScroll:true});
  }
  renderStats(){
    const sum=this.lobby.classSummary;sum.replaceChildren();const c=this.c,race=this.$('race').value;
    for(const slot of ['primary','secondary']){
      const card=statCard(c,slot,{race});if(!card)continue;
      const article=make('article','weapon-card'),heading=make('div','weapon-card-heading'),dl=make('dl','weapon-stats');article.dataset.slot=slot;
      heading.append(make('strong','',card.name),make('span','weapon-caliber',card.caliber));
      for(const r of card.rows){const dt=make('dt','',r.label),dd=make('dd','',r.value);dd.style.setProperty('--stat-fill',Math.min(100,r.fill)+'%');if(r.trend)dd.dataset.trend=r.trend;dl.append(dt,dd);}
      const nick=make('label','cb-nick'),input=make('input');input.maxLength=MAX_NICKNAME;input.placeholder='Nickname (optional)';input.value=card.nickname;input.setAttribute('aria-label',card.gunName+' nickname');input.onchange=()=>this.commit(setNickname(this.c,slot,input.value));nick.append(input);
      article.append(make('small','weapon-slot',slot.toUpperCase()+' / '+card.class+' / '+card.fireMode),heading,nick,dl);
      for(const a of card.attachments)article.append(make('p','perk-description attachment-description',a.name+': '+a.summary));
      sum.append(article);
    }
    const rows=classRows(c),article=make('article','weapon-card'),dl=make('dl','weapon-stats');
    for(const r of rows){const dd=make('dd','',r.value);dd.style.setProperty('--stat-fill',Math.min(100,r.fill)+'%');if(r.trend)dd.dataset.trend=r.trend;dl.append(make('dt','',r.label),dd);}
    article.append(make('small','weapon-slot','CLASS / PERKS'),dl);sum.append(article);
    for(const text of [...classNotes(c),'Figures include attachments, perks and your racial passive. Lower aim, recoil and reload numbers are faster. Saved classes apply to TDM, Domination and Battle Royale; Undead Co-op uses weapons and perks bought in the city. Camo, title and emblem are cosmetic.']){sum.append(make('p','weapon-stat-note',text));}
  }
}

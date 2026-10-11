const test=require('node:test'),assert=require('node:assert/strict');
// Smoke-tests the thin DOM layer with a tiny fake document: no browser, no WebGL.
class El{
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.attrs={};this.style={props:{},setProperty(k,v){this.props[k]=v;}};this.className='';this.textContent='';this.value='';this.hidden=false;this.disabled=false;this._cls=new Set();
    const self=this;this.classList={toggle(n,on){if(on===undefined?!self._cls.has(n):on)self._cls.add(n);else self._cls.delete(n);},add(n){self._cls.add(n);},remove(n){self._cls.delete(n);},contains:n=>self._cls.has(n)};}
  get classes(){return new Set([...this.className.split(/\s+/).filter(Boolean),...this._cls]);}
  append(...n){this.children.push(...n);}before(){}
  replaceChildren(...n){this.children=n;}
  setAttribute(k,v){this.attrs[k]=String(v);}
  focus(){El.focused=this;}select(){}
  querySelector(sel){const m=sel.startsWith('.')?n=>n.classes.has(sel.slice(1).split(':')[0]):n=>sel.includes('data-option')&&n.dataset.option===sel.match(/"(.*)"/)?.[1];const walk=n=>{for(const c of n.children){if(m(c)&&!(sel.includes(':not(:disabled)')&&c.disabled))return c;const r=walk(c);if(r)return r;}return null;};return walk(this);}
  all(pred,out=[]){for(const c of this.children){if(pred(c))out.push(c);c.all(pred,out);}return out;}
  get text(){return this.textContent+this.children.map(c=>c.text).join(' ');}
}
async function fixture(t,{progress=null}={}){
  const els=new Map(),$=id=>{if(!els.has(id))els.set(id,new El('x'));return els.get(id);};
  const old={document:global.document,CSS:global.CSS,navigator:global.navigator};
  global.document={createElement:tag=>new El(tag),activeElement:null,getElementById:$};global.CSS={escape:s=>s};
  Object.defineProperty(global,'navigator',{value:{clipboard:{writeText:()=>Promise.resolve()}},configurable:true});
  t.after(()=>{global.document=old.document;global.CSS=old.CSS;Object.defineProperty(global,'navigator',{value:old.navigator,configurable:true});});
  const {ClassBuilder}=await import('../src/loadout-ui.js'),{DEFAULT_CLASSES}=await import('../src/loadouts.mjs'),V=await import('../src/loadout-view.mjs'),R=await import('../src/loadout-rules.mjs');
  $('race').value='human';
  const lobby={classes:DEFAULT_CLASSES.map(c=>structuredClone(c)),activeClass:0,progress,classSummary:new El('section'),statuses:[],commits:[],
    get loadout(){return this.classes[this.activeClass];},slotLock(i){const id='slot:'+(i+1);return this.progress&&this.progress.level<({3:8,4:14}[i]||1)?({3:8,4:14}[i]):0;},
    status(m){this.statuses.push(m);},commitClass(c,m){this.commits.push(m);this.classes[this.activeClass]=c;this.builder.render();},setClasses(c,m){this.classes=c;this.statuses.push(m);this.builder.render();},renderSummary(){},selectClass(i){this.activeClass=i;this.builder.render();}};
  lobby.builder=new ClassBuilder(lobby,$);lobby.builder.render();
  return {lobby,$,El,V,R};
}

test('render builds tabs, meter, grouped slot grid and a picker prompt',async t=>{
  const {lobby,$}=await fixture(t);
  assert.equal($('class-slots').children.length,5);assert.match($('class-slots').children[0].text,/CLASS 01/);
  assert.equal($('pick10-pips').children.length,10);assert.match($('pick10-text').textContent,/ \/ 10$/);
  const groups=$('class-builder-grid').children;assert.deepEqual(groups.map(g=>g.dataset.group),['weapons','attachments','perks','equipment','wildcards','style']);
  const slots=$('class-builder-grid').all(n=>n.dataset.slot);assert.equal(slots.length,21);
  assert.ok(slots.find(s=>s.dataset.slot==='primary.att1').disabled,'extra attachment is closed without Gunfighter');
  assert.match($('class-picker').text,/SELECT A SLOT/);
  assert.equal($('class-primary').children.length,12,'inspect select knows all 12 guns');assert.equal($('class-copy-target').children.length,5);
  assert.equal(lobby.classSummary.children.filter(n=>n.className==='weapon-card').length,3,'primary, secondary and class cards');
  assert.match(lobby.classSummary.text,/Old|AN-94/);
});

test('opening a slot lists options with locks, choosing applies, hovering inspects',async t=>{
  const {lobby,$}=await fixture(t,{progress:{level:1,unlocked:[]}});
  const b=lobby.builder,slot=id=>$('class-builder-grid').all(n=>n.dataset.slot===id)[0];
  slot('perk.1.0').onclick();
  assert.equal(b.openSlot,'perk.1.0');const options=$('class-picker').all(n=>n.dataset.option!==undefined);
  assert.equal(options.length,5);const marathon=options.find(o=>/Marathon/.test(o.text));assert.ok(marathon.classes.has('is-locked'));assert.match(marathon.text,/LVL 14/);
  marathon.onclick();assert.match(lobby.statuses.at(-1),/level 14/);assert.equal(lobby.commits.length,0);
  options.find(o=>/Second Wind/.test(o.text)).onclick();assert.equal(lobby.commits.length,1);assert.deepEqual(lobby.loadout.perks.t1,['secondWind']);
  assert.match($('pick10-text').textContent,/^[0-9]+ \/ 10$/);
  // weapons: hover previews the gun in the 3D armory via the hidden select
  slot('secondary').onclick();assert.equal($('class-primary').value,String(lobby.loadout.secondary),'secondary slot inspects the secondary gun');
  const guns=$('class-picker').all(n=>n.dataset.option!==undefined),mp7=guns.find(o=>/MP7/.test(o.text));
  assert.ok(mp7.classes.has('is-locked'));mp7.onmouseenter();assert.equal($('class-primary').value,'4');mp7.onmouseleave();assert.equal($('class-primary').value,String(lobby.loadout.secondary));
  slot('primary').onclick();assert.equal($('class-primary').value,String(lobby.loadout.primary));
  // closing the same slot again
  slot('primary').onclick();assert.equal(b.openSlot,null);
  // lethal options are flagged as placeholders
  slot('lethal').onclick();const eq=$('class-picker').all(n=>n.dataset.option!==undefined);assert.ok(eq.slice(1).every(o=>o.classes.has('is-placeholder')&&/COMING SOON/.test(o.text)));
});

test('copy, reset (two clicks), export and import work through the DOM handlers',async t=>{
  const {lobby,$,R}=await fixture(t,{progress:{level:1,unlocked:[]}});
  // copy to a locked slot is refused
  $('class-copy-target').value='3';$('class-copy').onclick();assert.match(lobby.statuses.at(-1),/unlocks at level 8/);
  $('class-copy-target').value='2';$('class-copy').onclick();assert.equal(lobby.classes[2].name,lobby.classes[0].name);assert.match(lobby.statuses.at(-1),/Copied to class 3/);
  // reset needs a confirm click
  lobby.classes[0]={...lobby.classes[0],name:'Changed'};
  $('class-reset').onclick();assert.equal($('class-reset').textContent,'CONFIRM RESET');assert.equal(lobby.classes[0].name,'Changed');
  $('class-reset').onclick();assert.equal(lobby.classes[0].name,'Assault');assert.equal($('class-reset').textContent,'RESET');
  // export / import round trip, and hostile text is refused without changing anything
  $('class-export').onclick();const text=$('class-json').value;assert.ok(text.length>20&&text.length<R.MAX_EXPORT_CHARS);
  lobby.activeClass=1;const before=JSON.stringify(lobby.classes[1]);
  $('class-json').value='{"nope"';$('class-import').onclick();assert.equal(JSON.stringify(lobby.classes[1]),before);assert.match($('class-share-msg').textContent,/not valid/);
  $('class-json').value=text;$('class-import').onclick();assert.equal(lobby.classes[1].name,'Assault');assert.match(lobby.commits.at(-1),/imported/i);
  // toggling the share panel
  $('class-share').hidden=true;$('class-share-toggle').onclick();assert.equal($('class-share').hidden,false);assert.equal($('class-share-toggle').attrs['aria-expanded'],'true');
  // rename goes through validation
  $('class-name').value='  <b>Hax</b>  ';$('class-name').onchange();assert.ok(!/[<>]/.test(lobby.loadout.name));
});

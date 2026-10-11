const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),{WebSocket}=require('ws');
const load=async()=>({A:await import('../src/attachments.mjs'),L:await import('../src/loadouts.mjs'),D:await import('../src/weapon-data.js'),Z:await import('../src/zombie-upgrades.mjs'),R:await import('../src/racial-traits.mjs'),S:await import('../src/engine/weapon-simulation.mjs'),Aim:await import('../src/engine/aim.mjs')});
const byId=(D,id)=>D.GUNS.find(g=>g.id===id);

test('Catalog entries are complete, frozen and restricted to real weapon types',async()=>{
  const {A,D}=await load();
  assert.equal(A.ATTACHMENTS.length,8);assert.equal(new Set(A.ATTACHMENT_IDS).size,8);assert.deepEqual(A.ATTACHMENT_IDS.slice(0,5),['extMags','fastMags','foregrip','suppressor','redDot'],'original five keep their order');
  for(const a of A.ATTACHMENTS){assert.ok(a.name&&a.summary);assert.ok(Object.isFrozen(a));assert.ok(a.types.length&&a.types.every(t=>['rifle','sniper','pistol'].includes(t))&&a.group);assert.equal(A.ATTACHMENTS_BY_ID[a.id],a);}
  assert.equal(A.weaponType(byId(D,'an94_mp')),'rifle');assert.equal(A.weaponType(byId(D,'dsr50_mp')),'sniper');
  assert.ok(Object.isFrozen(A.ATTACHMENTS)&&Object.isFrozen(A.ATTACHMENTS[0].types));
});
test('Per-weapon validation: rifles take all, snipers only a subset, junk is rejected',async()=>{
  const {A,D}=await load(),an=byId(D,'an94_mp'),dsr=byId(D,'dsr50_mp'),bal=byId(D,'ballista_mp');
  assert.deepEqual(A.attachmentsFor(an).map(a=>a.id),['extMags','fastMags','foregrip','suppressor','redDot','quickdraw','reflex','compensator']);
  assert.deepEqual(A.attachmentsFor(dsr).map(a=>a.id),['fastMags','suppressor','compensator']);
  assert.deepEqual(A.attachmentsFor(bal).map(a=>a.id),['extMags','fastMags','suppressor','compensator']);
  for(const bad of ['foregrip','redDot','extMags'])assert.equal(A.canEquip(dsr,bad),false);
  for(const bad of ['__proto__','toString','constructor',7,null,undefined,{},['extMags']])assert.equal(A.canEquip(an,bad),false);
  assert.equal(A.cleanAttachmentId(dsr,'redDot'),null);assert.equal(A.cleanAttachmentId(an,'redDot'),'redDot');
  const before=structuredClone(dsr);assert.equal(A.applyAttachment(dsr,'redDot'),dsr);assert.deepEqual(dsr,before);
});
test('Attachment math is exact and never mutates the base weapon',async()=>{
  const {A,D,S}=await load(),an=byId(D,'an94_mp'),snap=structuredClone(an),dsr=byId(D,'dsr50_mp');
  const ext=A.applyAttachment(an,'extMags');assert.equal(ext.capacity,45);assert.equal(ext.reserve,an.reserve);assert.equal(ext.reload,an.reload*1.1);assert.equal(ext.reloadEmpty,an.reloadEmpty*1.1);assert.equal(ext.attachment,'extMags');
  assert.equal(A.applyAttachment(byId(D,'ballista_mp'),'extMags').capacity,11);
  const fast=A.applyAttachment(an,'fastMags');assert.equal(fast.capacity,30);assert.equal(fast.reload,an.reload*.85);assert.equal(fast.reloadEmpty,an.reloadEmpty*.85);
  const grip=A.applyAttachment(an,'foregrip');assert.equal(grip.recoil,.7);assert.equal(grip.adsIn,an.adsIn*1.1);assert.equal(grip.reload,an.reload);
  const dot=A.applyAttachment(an,'redDot');assert.equal(dot.adsFov,46);assert.equal(dot.adsIn,an.adsIn*1.05);
  const sup=A.applyAttachment(an,'suppressor');assert.equal(sup.quiet,true);assert.equal(sup.damage,an.damage);
  assert.equal(S.damageAt(sup,10),S.damageAt(an,10));assert.equal(S.damageAt(sup,20),S.damageAt(an,20));
  assert.ok(Math.abs(S.damageAt(sup,40)-S.damageAt(an,40)*.85)<1e-9);assert.ok(Math.abs(S.damageAt(sup,30)-S.damageAt(an,30)*(1-.15*.5))<1e-9);
  assert.ok(Math.abs(S.damageAt(sup,60)-S.damageAt(an,60)*.85)<1e-9);
  const ssup=A.applyAttachment(dsr,'suppressor');assert.ok(Math.abs(S.damageAt(ssup,110)-S.damageAt(dsr,110)*.85)<1e-9);assert.equal(S.damageAt(ssup,10),S.damageAt(dsr,10));
  assert.deepEqual(an,snap);
});
test('An attachment applies exactly once: re-application is ignored',async()=>{
  const {A,D}=await load(),an=byId(D,'an94_mp'),once=A.applyAttachment(an,'extMags');
  assert.equal(A.applyAttachment(once,'extMags'),once);assert.equal(A.applyAttachment(once,'fastMags'),once);
});
test('Composition: attachment then perks then racials, and Pack-a-Punch is order independent',async()=>{
  const {A,L,D,Z,R}=await load(),sc=D.GUNS.findIndex(g=>g.id==='scar_mp');
  const loadout=L.cleanLoadout({primary:sc,secondary:0,perk:'fastHands',attachments:{primary:'fastMags',secondary:'extMags'}});
  const cw=L.classWeapons(D.GUNS,loadout);
  assert.ok(Math.abs(cw[sc].reload-D.GUNS[sc].reload*.85*.85)<1e-12);assert.equal(cw[0].capacity,45);assert.ok(Math.abs(cw[0].reload-D.GUNS[0].reload*1.1*.85)<1e-12);
  assert.equal(cw[2].attachment,undefined);
  const racial=R.racialWeapons(cw,'gnome');assert.ok(Math.abs(racial[sc].reload-D.GUNS[sc].reload*.85*.85*.95)<1e-12);assert.equal(racial[sc].attachment,'fastMags');
  // Stockpile reserve is floored after attachments and unaffected by magazines.
  const st=L.classWeapons(D.GUNS,L.cleanLoadout({primary:0,secondary:1,perk:'stockpile',attachments:{primary:'extMags'}}));assert.equal(st[0].capacity,45);assert.equal(st[0].reserve,180);
  // Packed weapons: attachment before or after Pack-a-Punch gives the same result.
  const rules={perks:new Set(),packed:new Set([0,1,2,3])};
  for(const [i,g] of D.GUNS.entries()){
    for(const a of A.attachmentsFor(g)){
      const x=Z.survivalWeapons(D.GUNS.map((q,n)=>n===i?A.applyAttachment(q,a.id):q),rules)[i];
      const y=A.applyAttachment(Z.survivalWeapons(D.GUNS,rules)[i],a.id);
      assert.equal(x.capacity,y.capacity);assert.equal(x.attachment,a.id);assert.equal(y.attachment,a.id);
      assert.ok(Math.abs(x.reload-y.reload)<1e-9&&Math.abs(x.adsIn-y.adsIn)<1e-9&&x.adsFov===y.adsFov&&x.recoil===y.recoil&&x.quiet===y.quiet);
      assert.equal(x.damageCurve.length,y.damageCurve.length);x.damageCurve.forEach(([d,v],k)=>{assert.ok(Math.abs(d-y.damageCurve[k][0])<1e-9&&Math.abs(v-y.damageCurve[k][1])<1e-9);});
    }
  }
  assert.equal(Z.survivalWeapons(D.GUNS,rules)[0].recoil,undefined);
});
test('Foregrip recoil scales view kick; guns without a recoil field are unchanged',async()=>{
  const {A,D,Aim}=await load(),an=byId(D,'an94_mp');
  assert.equal(Aim.kickAfterShot(0,an),.003);assert.ok(Math.abs(Aim.kickAfterShot(0,A.applyAttachment(an,'foregrip'))-.0021)<1e-12);assert.equal(Aim.kickAfterShot(0,{}),.003);
});
test('cleanLoadout is backward compatible and drops invalid attachments',async()=>{
  const {L}=await load();
  const old=L.cleanLoadout({name:'Old',primary:1,secondary:2,perk:'fastHands'});assert.deepEqual(old.attachments,{primary:null,secondary:null});
  assert.deepEqual(L.cleanLoadout().attachments,{primary:null,secondary:null});
  assert.ok(L.DEFAULT_CLASSES.length===5&&L.DEFAULT_CLASSES.every(c=>JSON.stringify(L.cleanLoadout(c))===JSON.stringify(c)),'default classes are already clean');
  const ok=L.cleanLoadout({primary:0,secondary:2,attachments:{primary:'redDot',secondary:'suppressor'}});assert.deepEqual(ok.attachments,{primary:'redDot',secondary:'suppressor'});
  // Attachment invalid for the weapon (DSR 50 secondary cannot take a foregrip).
  assert.deepEqual(L.cleanLoadout({primary:0,secondary:2,attachments:{primary:'nope',secondary:'foregrip'}}).attachments,{primary:null,secondary:null});
  // Changing the weapon drops attachments that no longer fit.
  assert.equal(L.cleanLoadout({primary:2,secondary:0,attachments:{primary:'redDot'}}).attachments.primary,null);
  for(const junk of [null,'x',5,[],{primary:{},secondary:[]}]){const c=L.cleanLoadout({attachments:junk});assert.deepEqual(c.attachments,{primary:null,secondary:null});}
  assert.deepEqual(L.cleanLoadout(L.cleanLoadout(ok)),ok);
});
test('Server sanitizes client attachment ids and applies them authoritatively',async()=>{
  const {attachMultiplayer}=await import('../server/multiplayer.mjs'),server=http.createServer(),net=attachMultiplayer(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));const sockets=[];
  const wait=async p=>{const until=Date.now()+8000;while(!p()){if(Date.now()>until)throw Error('Timed out');await new Promise(r=>setTimeout(r,20));}};
  try{
    const ws=new WebSocket('ws://127.0.0.1:'+server.address().port+'/multiplayer'),c={};sockets.push(ws);ws.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='welcome')c.id=m.id;});await wait(()=>c.id);
    const send=m=>ws.send(JSON.stringify(m)),client=()=>net.clients.get(c.id);
    send({type:'profile',loadout:{primary:0,secondary:2,perk:'balanced',attachments:{primary:'extMags',secondary:'redDot',damage:99999}}});await wait(()=>client().pending.attachments.primary==='extMags');
    assert.equal(client().pending.attachments.secondary,null);assert.equal(client().pending.damage,undefined);
    send({type:'profile',loadout:{primary:0,secondary:1,attachments:{primary:{toString:1},secondary:'__proto__'}}});await wait(()=>client().pending.secondary===1);
    assert.deepEqual(client().pending.attachments,{primary:null,secondary:null});
    send({type:'profile',loadout:{primary:0,secondary:2,attachments:{primary:'suppressor',secondary:'fastMags'}}});await wait(()=>client().pending.attachments.primary==='suppressor');
    const {classWeapons}=await import('../src/loadouts.mjs'),{GUNS}=await import('../src/weapon-data.js'),spec=classWeapons(GUNS,client().loadout);
    assert.equal(spec[0].quiet,true);assert.ok(Math.abs(spec[2].reload-GUNS[2].reload*.85)<1e-12);
  }finally{for(const s of sockets)s.terminate();net.close?.();server.close();}
});

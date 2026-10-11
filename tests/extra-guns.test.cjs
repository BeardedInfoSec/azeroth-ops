const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const NEW=['mp7_mp','vector_mp','type95_mp','sig556_mp','mk48_mp','870mcs_mp','fiveseven_mp','as50_mp'];
const CLASSES={mp7_mp:'smg',vector_mp:'smg',type95_mp:'ar',sig556_mp:'ar',mk48_mp:'lmg','870mcs_mp':'shotgun',fiveseven_mp:'pistol',as50_mp:'sniper'};
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const glb=name=>{const file=fs.readFileSync('public/assets/weapons/'+name+'.glb');return {file,gltf:JSON.parse(file.toString('utf8',20,20+file.readUInt32LE(12)))};};

test('the original four guns keep their indices and gameplay values; new guns are appended',async()=>{
  const {GUNS}=await import('../src/weapon-data.js');
  assert.deepEqual(GUNS.slice(0,4).map(g=>g.id),['an94_mp','scar_mp','dsr50_mp','ballista_mp']);
  assert.deepEqual(GUNS.slice(4).map(g=>g.id),NEW);
  assert.deepEqual(GUNS.slice(0,4).map(g=>[g.capacity,g.damage,g.interval,g.cycle,g.reload,g.reloadEmpty,g.adsIn,g.bolt,g.key]),
    [[30,40,.096,.096,2.475,3.105,.25,false,'1'],[30,45,.096,.096,2.4,3,.25,false,'2'],[5,98,.4,1.5,3.4,4,.4,true,'6'],[7,95,.3,1.26,3.1,3.75,.35,true,'7']]);
});

test('each new gun records class, magazine, timings, damage curve and muzzle/sight tags from the patched definition',async()=>{
  const {GUNS}=await import('../src/weapon-data.js'),definitions=JSON.parse(fs.readFileSync('public/assets/weapons/definitions.json','utf8'));
  for(const id of NEW){
    const gun=GUNS.find(g=>g.id===id),fields=definitions[id].fields;
    assert.equal(gun.class,CLASSES[id],id);assert.equal(gun.muzzleTag,'tag_flash');assert.ok(gun.sightTag===null||/^tag_sights/.test(gun.sightTag));
    assert.equal(gun.capacity,Number(fields.clipSize));assert.equal(gun.model,fields.gunModel);assert.equal(gun.interval,Number(fields.fireTime));
    assert.ok(gun.reload>0&&gun.reloadEmpty>0&&gun.adsIn>0&&gun.damage>0,id);
    assert.ok(gun.damageCurve.length>=2&&gun.damageCurve.every(([range,value],i,all)=>range>=0&&value>0&&(i===0||range>=all[i-1][0])),id+' ordered curve');
    assert.equal(gun.magazine,fields.attachViewModel7||null);
    assert.equal(definitions[id].sha256.length,64);
    assert.equal(gun.key,'','not bound to a number key');
  }
  assert.equal(GUNS.find(g=>g.id==='870mcs_mp').pellets,8);assert.equal(GUNS.find(g=>g.id==='sig556_mp').fireMode,'burst');assert.equal(GUNS.find(g=>g.id==='as50_mp').scope,'/assets/weapons/scope_overlay_xpr50.png');
});

test('every new gun model, magazine, scope and texture is a prepared local file with provenance hashes',async()=>{
  const {GUNS}=await import('../src/weapon-data.js'),provenance=JSON.parse(fs.readFileSync('public/assets/weapons/provenance.json','utf8'));
  for(const id of NEW){
    const gun=GUNS.find(g=>g.id===id);
    for(const name of [gun.model,...gun.attachments.map(a=>a.model)]){
      const {file,gltf}=glb(name);assert.equal(file.readUInt32LE(8),file.length,name);assert.ok(gltf.meshes.length);
      for(const image of gltf.images)assert.ok(fs.existsSync('public/assets/weapons/'+image.uri),image.uri);
      assert.equal(provenance.hashes[name].output,sha(file),name+' output hash');assert.equal(provenance.hashes[name].source.length,64);
      const nodes=new Set(gltf.nodes.map(node=>node.name));
      if(name===gun.model){assert.ok(nodes.has('tag_flash'),name+' muzzle tag');if(gun.sightTag)assert.ok(nodes.has(gun.sightTag),name+' sight tag');}
    }
    if(gun.scope)assert.ok(fs.existsSync('public'+gun.scope));
  }
});

test('every gun has original BO2 firing and reload audio, and the new guns keep distinct firing recordings',()=>{
  const manifest=JSON.parse(fs.readFileSync('public/assets/audio/manifest.json','utf8')),signatures=new Set();
  for(const id of NEW){
    const weapon=manifest.weapons[id];assert.ok(weapon,id);assert.ok(weapon.shot.length&&weapon.remoteShot.length&&weapon.reload.length&&weapon.reloadEmpty.length,id);
    assert.match(weapon.shotAlias,/^wpn_\w+_fire_plr$/);
    const urls=[...weapon.shot,...weapon.remoteShot,...[...weapon.reload,...weapon.reloadEmpty,...(weapon.bolt||[])].flatMap(event=>event.clips)];
    for(const url of urls)assert.ok(manifest.files[url],url);
    signatures.add(weapon.shot.map(url=>manifest.files[url].sha256).join());
  }
  assert.equal(signatures.size,NEW.length);
});

test('new guns are selectable through classes (all 12 indices) but not bound to number keys',async()=>{
  const {cleanLoadout,DEFAULT_CLASSES}=await import('../src/loadouts.mjs');
  assert.ok(DEFAULT_CLASSES.every(c=>c.primary<4&&c.secondary<4),'level-1 presets only use the starter guns');
  const loadout=cleanLoadout({version:2,primary:5,secondary:10});assert.equal(loadout.primary,5);assert.equal(loadout.secondary,10);
  assert.equal(cleanLoadout({version:2,primary:11,secondary:6,wildcards:['wildcard:overkill']}).primary,11);
});

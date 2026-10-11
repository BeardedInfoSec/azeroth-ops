// Wrath MD20 (v264) + SKIN importer; source archives remain read-only.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {WowArchive,dbc}=require('./wow-archive.cjs');
// Optional final arguments: --only human (preserves the other imported races).
const only=process.argv[3]==='--only'?process.argv[4]:null;
if(process.argv[3]&&(!only||process.argv.length!==5))throw new Error('Usage: node scripts/import-characters.cjs <WoW directory> [--only <character>]');
if(only&&!['human','dwarf','nightelf','gnome','draenei','orc','forsaken','tauren','troll','bloodelf','zombie','ghoul'].includes(only))throw new Error('Unknown character: '+only);
const archive=new WowArchive(process.argv[2]);
const output=path.resolve(__dirname,'../public/assets/characters');
const cache=path.resolve(__dirname,'../cache/character-blp');
fs.mkdirSync(output,{recursive:true});fs.mkdirSync(cache,{recursive:true});
const extra=dbc(archive.read('DBFilesClient/CreatureDisplayInfoExtra.dbc'));
const hair=dbc(archive.read('DBFilesClient/CharHairGeosets.dbc'));
const facial=dbc(archive.read('DBFilesClient/CharacterFacialHairStyles.dbc'));
const sections=dbc(archive.read('DBFilesClient/CharSections.dbc'));
const items=dbc(archive.read('DBFilesClient/ItemDisplayInfo.dbc'));
const manifestPath=path.join(output,'manifest.json');
const manifests=only&&fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')).characters:[];
const writtenTextures=new Set();
// Human 136 supplies a dressed appearance with an actual hair cap, replacing bald NPC 45.
const preferredAppearance={human:136};
const vec=(b,p)=>[b.readFloatLE(p),b.readFloatLE(p+8),-b.readFloatLE(p+4)];
const string=(b,p,n)=>b.toString('utf8',p,p+Math.max(0,n-1));
const arr=(b,p)=>({count:b.readUInt32LE(p),offset:b.readUInt32LE(p+4)});
function texture(name){
  const key=crypto.createHash('sha1').update(name.toLowerCase()).digest('hex').slice(0,16);
  fs.writeFileSync(path.join(cache,key+'.blp'),archive.read(name));
  writtenTextures.add(key+'.blp');
  return '/assets/characters/textures/'+key+'.png';
}
function track(b,p,index,animBuffer,type){
  const global=b.readInt16LE(p+2),ti=arr(b,p+4),va=arr(b,p+12),slot=global>=0?0:index;
  if(slot>=ti.count||slot>=va.count)return null;
  const times=arr(b,ti.offset+slot*8),values=arr(b,va.offset+slot*8);
  if(!times.count||!values.count)return null;
  const source=global>=0?b:animBuffer;
  const stride=type==='rotation'?8:12;
  if(times.offset+times.count*4>source.length||values.offset+values.count*stride>source.length)throw new Error('Animation track out of bounds');
  const n=Math.min(times.count,values.count),t=[],v=[];
  for(let i=0;i<n;i++){
    t.push(source.readUInt32LE(times.offset+i*4)/1000);
    const at=values.offset+i*stride;
    if(type==='rotation'){
      const q=Array.from({length:4},(_,j)=>{const e=source.readInt16LE(at+j*2);return(e<0?e+32768:e-32767)/32767;});
      const len=Math.hypot(...q)||1;v.push(q[0]/len,q[2]/len,-q[1]/len,q[3]/len);
    }else{const value=vec(source,at);if(type==='scale')value[2]*=-1;v.push(...value);}
  }
  return {times:t,values:v,interpolation:b.readUInt16LE(p),global};
}
function exportModel(spec){
  const file=spec.file,b=archive.read(file),skin=archive.read(file.replace(/\.m2$/i,'00.skin'));
  if(b.toString('ascii',0,4)!=='MD20'||b.readUInt32LE(4)!==264||skin.toString('ascii',0,4)!=='SKIN')throw new Error('Expected Wrath M2 and SKIN');
  const vertices=arr(b,60),bonesInfo=arr(b,44),animationsInfo=arr(b,28),texInfo=arr(b,80),materialsInfo=arr(b,112),texCombos=arr(b,128);
  const positions=[],normals=[],uv=[],weights=[],joints=[],bones=[];
  for(let i=0;i<vertices.count;i++){
    const p=vertices.offset+i*48;positions.push(...vec(b,p));normals.push(...vec(b,p+20));uv.push(b.readFloatLE(p+32),b.readFloatLE(p+36));
    for(let j=0;j<4;j++){weights.push(b[p+12+j]/255);joints.push(b[p+16+j]);}
  }
  for(let i=0;i<bonesInfo.count;i++){const p=bonesInfo.offset+i*88;bones.push({parent:b.readInt16LE(p+8),pivot:vec(b,p+76),key:b.readInt32LE(p),flags:b.readUInt32LE(p+4)});}
  const animations=[];
  for(let i=0;i<animationsInfo.count;i++){const p=animationsInfo.offset+i*64;animations.push({id:b.readUInt16LE(p),variation:b.readUInt16LE(p+2),duration:b.readUInt32LE(p+4)/1000,flags:b.readUInt32LE(p+12),alias:b.readUInt16LE(p+62)});}
  const clips=[];
  for(const [id,name] of [[0,'idle'],[1,'death'],[4,'walk'],[5,'run'],[16,'attack'],[48,'rifle'],[49,'shoot']]){
    let index=animations.findIndex(a=>a.id===id&&a.variation===0);if(index<0)continue;
    const seen=new Set();while(animations[index].flags&64){if(seen.has(index))throw new Error('Animation alias loop');seen.add(index);index=animations[index].alias;}
    const a=animations[index];let animBuffer=b;
    if(!(a.flags&32))animBuffer=archive.read(file.replace(/\.m2$/i,String(a.id).padStart(4,'0')+'-'+String(a.variation).padStart(2,'0')+'.anim'));
    const tracks=[];
    for(let j=0;j<bones.length;j++)for(const [type,ofs] of [['position',16],['rotation',36],['scale',56]]){
      const data=track(b,bonesInfo.offset+j*88+ofs,index,animBuffer,type);if(data)tracks.push({bone:j,type,...data});
    }
    clips.push({id,name,duration:a.duration,tracks});
  }
  const tx=[];
  for(let i=0;i<texInfo.count;i++){
    const p=texInfo.offset+i*16,type=b.readUInt32LE(p);let name=type===0?string(b,b.readUInt32LE(p+12),b.readUInt32LE(p+8)):null;
    if(type===1)name=spec.body;if(type===6)name=spec.hair||spec.body;if(type>=11&&type<=13)name=spec.skin;
    tx.push(name?texture(name):null);
  }
  const lookup=arr(skin,4),triangles=arr(skin,12),subs=arr(skin,28),batches=arr(skin,36);
  const parts=[],used=new Set();
  for(let i=0;i<batches.count;i++){
    const p=batches.offset+i*24,sub=skin.readUInt16LE(p+4),mp=materialsInfo.offset+skin.readUInt16LE(p+10)*4,blend=b.readUInt16LE(mp+2);
    if(used.has(sub)||blend>1)continue;
    const sp=subs.offset+sub*48,geo=skin.readUInt16LE(sp),level=skin.readUInt16LE(sp+2);
    if(spec.geosets&&!spec.geosets.has(geo))continue;
    const combo=skin.readUInt16LE(p+16),tex=b.readUInt16LE(texCombos.offset+combo*2);if(!tx[tex])continue;
    const start=skin.readUInt16LE(sp+8)+(level<<16),count=skin.readUInt16LE(sp+10),indices=[];
    for(let j=start;j<start+count;j++){const v=skin.readUInt16LE(triangles.offset+j*2);indices.push(skin.readUInt16LE(lookup.offset+v*2));}
    parts.push({geoset:geo,texture:tx[tex],blend,indices});used.add(sub);
  }
  if(!parts.length)throw new Error('No visible character geometry: '+spec.id);
  const attachmentsInfo=arr(b,240),attachments=[];
  for(let i=0;i<attachmentsInfo.count;i++){const p=attachmentsInfo.offset+i*40;attachments.push({id:b.readUInt32LE(p),bone:b.readUInt16LE(p+4),position:vec(b,p+8)});}
  const result={id:spec.id,name:spec.name,faction:spec.faction,height:spec.height,source:file,npcDisplayExtra:spec.npcId,positions,normals,uv,weights,joints,bones,parts,clips,attachments};
  fs.writeFileSync(path.join(output,spec.id+'.json'),JSON.stringify(result));
  const entry={id:spec.id,name:spec.name,faction:spec.faction,height:spec.height,file:'/assets/characters/'+spec.id+'.json',source:file,npcDisplayExtra:spec.npcId,clips:clips.map(c=>c.name)},existing=manifests.findIndex(item=>item.id===spec.id);
  if(existing<0)manifests.push(entry);else manifests[existing]=entry;
  console.log(spec.id,vertices.count,'vertices',parts.length,'parts',clips.map(c=>c.name).join(','));
}
try{
for(const [id,name,race,folder,faction,height] of [
 ['human','Human',1,'Human','alliance',1.85],['dwarf','Dwarf',3,'Dwarf','alliance',1.45],['nightelf','Night Elf',4,'NightElf','alliance',2.15],['gnome','Gnome',7,'Gnome','alliance',1.05],['draenei','Draenei',11,'Draenei','alliance',2.25],
 ['orc','Orc',2,'Orc','horde',2.05],['forsaken','Forsaken',5,'Scourge','horde',1.80],['tauren','Tauren',6,'Tauren','horde',2.5],['troll','Troll',8,'Troll','horde',2.25],['bloodelf','Blood Elf',10,'BloodElf','horde',1.90]
]){
  if(only&&id!==only)continue;
  const candidates=extra.rows.filter(r=>r[1]===race&&r[2]===0&&(r[10]||r[11])&&r[13]&&r[8]===0);
  const preferred=preferredAppearance[id];
  const r=candidates.find(r=>(preferred===undefined||r[0]===preferred)&&archive.read('Textures/BakedNpcTextures/'+extra.str(r[20]),true));
  if(!r)throw new Error('No dressed NPC atlas for '+name);
  const hairstyle=hair.rows.find(h=>h[1]===race&&h[2]===0&&h[3]===r[5]);
  const face=facial.rows.find(f=>f[0]===race&&f[1]===0&&f[2]===r[7]);
  const hs=sections.rows.find(s=>s[1]===race&&s[2]===0&&s[3]===3&&s[8]===r[5]&&s[9]===r[6]);
  const geosets=new Set([0,hairstyle?.[4]??0,401,501,601,701,801,901,1001,1101,1201,1301]);
  // Wrath bald styles use the skin-textured scalp (geoset 1), not an absent hair mesh.
  if(hairstyle?.[5])geosets.add(1);
  for(let k=0;k<3;k++)geosets.add((k+1)*100+(face?.[k+3]??1));
  // Match the armor silhouette to the baked NPC atlas where available.
  const gloves=items.rows.find(i=>i[0]===r[16]),boots=items.rows.find(i=>i[0]===r[14]);
  if(gloves){geosets.delete(401);geosets.add(401+gloves[7]);}
  if(boots){geosets.delete(501);geosets.add(501+boots[7]);}
  exportModel({id,name,faction,height,npcId:r[0],file:`Character/${folder}/Male/${folder}Male.m2`,body:'Textures/BakedNpcTextures/'+extra.str(r[20]),hair:hs?sections.str(hs[4]):null,geosets});
}
if(!only||only==='zombie')exportModel({id:'zombie',name:'Risen Dead',faction:'scourge',height:1.8,file:'Creature/Zombie/Zombie.m2',skin:'Creature/Zombie/ZombieSkinGreen.blp'});
if(!only||only==='ghoul')exportModel({id:'ghoul',name:'Scourge Ghoul',faction:'scourge',height:1.6,file:'Creature/Ghoul/Ghoul.m2',skin:'Creature/Ghoul/GhoulSkinGrey.blp'});
fs.writeFileSync(manifestPath,JSON.stringify({build:12340,characters:manifests},null,2));
}finally{archive.close();}
const result=spawnSync('py',['-3.11',path.join(__dirname,'textures.py'),cache,path.join(output,'textures'),...writtenTextures],{stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);

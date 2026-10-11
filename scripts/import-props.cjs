// Read-only Wrath WMO doodads: original MODD placements, M2 meshes and collision.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {WowArchive}=require('./wow-archive.cjs');
const archive=new WowArchive(process.argv[2]);
const sources={stormwind:'World/wmo/Azeroth/Buildings/Stormwind/Stormwind.wmo',dalaran:'World/wmo/Northrend/Dalaran/ND_Dalaran.wmo',darnassus:'World/wmo/Kalimdor/Darnassis/Darnassis.wmo'};
const cities=process.argv[3]?[process.argv[3]]:Object.keys(sources);
const out=path.resolve(__dirname,'../public/assets/props'),cache=path.resolve(__dirname,'../cache/prop-blp');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(cache,{recursive:true});
const arr=(b,p)=>({count:b.readUInt32LE(p),offset:b.readUInt32LE(p+4)});
const vec=(b,p)=>[b.readFloatLE(p),b.readFloatLE(p+8),-b.readFloatLE(p+4)];
const str=(b,p)=>b.toString('utf8',p,b.indexOf(0,p));
const textureCache=new Map();
function texture(file){
  if(textureCache.has(file))return textureCache.get(file);
  const bytes=archive.read(file),id=crypto.createHash('sha1').update(file.toLowerCase()).digest('hex').slice(0,16);
  fs.writeFileSync(path.join(cache,id+'.blp'),bytes);const url='/assets/props/textures/'+id+'.png';textureCache.set(file,url);return url;
}
function chunks(b){const result={};for(let p=0;p+8<=b.length;){const size=b.readUInt32LE(p+4);if(p+8+size>b.length)throw Error('Bad chunk');result[b.toString('ascii',p,p+4).split('').reverse().join('')]=b.subarray(p+8,p+8+size);p+=8+size;}return result;}
function model(file){
  const b=archive.read(file),skin=archive.read(file.replace(/\.m2$/i,'00.skin'));
  if(b.toString('ascii',0,4)!=='MD20'||b.readUInt32LE(4)!==264||skin.toString('ascii',0,4)!=='SKIN')throw Error('Unsupported prop '+file);
  const vertices=arr(b,60),textures=arr(b,80),materials=arr(b,112),combos=arr(b,128);
  const positions=[],uv=[];
  for(let i=0;i<vertices.count;i++){const p=vertices.offset+i*48;positions.push(...vec(b,p));uv.push(b.readFloatLE(p+32),b.readFloatLE(p+36));}
  const tx=[];
  for(let i=0;i<textures.count;i++){const p=textures.offset+i*16,type=b.readUInt32LE(p);tx.push(type===0?texture(str(b,b.readUInt32LE(p+12))):null);}
  const lookup=arr(skin,4),triangles=arr(skin,12),subs=arr(skin,28),batches=arr(skin,36),parts=[],used=new Set();
  for(let i=0;i<batches.count;i++){
    const p=batches.offset+i*24,sub=skin.readUInt16LE(p+4),mp=materials.offset+skin.readUInt16LE(p+10)*4,blend=b.readUInt16LE(mp+2),flags=b.readUInt16LE(mp);
    const sp=subs.offset+sub*48,combo=skin.readUInt16LE(p+16),tex=b.readUInt16LE(combos.offset+combo*2);
    // Keep one base pass per submesh; secondary passes require WoW's shader pipeline.
    if(used.has(sub)||!tx[tex])continue;
    const start=skin.readUInt16LE(sp+8)+(skin.readUInt16LE(sp+2)<<16),count=skin.readUInt16LE(sp+10),indices=[];
    for(let j=start;j<start+count;j++)indices.push(skin.readUInt16LE(lookup.offset+skin.readUInt16LE(triangles.offset+j*2)*2));
    parts.push({texture:tx[tex],blend,flags,indices});used.add(sub);
  }
  const ci=arr(b,216),cv=arr(b,224),collision={positions:[],indices:[]};
  for(let i=0;i<cv.count;i++)collision.positions.push(...vec(b,cv.offset+i*12));
  for(let i=0;i<ci.count;i++)collision.indices.push(b.readUInt16LE(ci.offset+i*2));
  if(!parts.length)throw Error('No textured geometry '+file);
  return {source:file,positions,uv,parts,collision};
}
try{
 for(const city of cities){
  const source=sources[city];if(!source)throw Error('Unknown city '+city);const c=chunks(archive.read(source));
  const models=[],instances=[],modelsByName=new Map(),skipped=[];
  let setOffset=0;for(let p=0;p+32<=c.MODS.length;p+=32)if(str(c.MODS,p)==='Set_$DefaultGlobal'){setOffset=p;break;}
  const set=str(c.MODS,setOffset),first=c.MODS.readUInt32LE(setOffset+20),count=c.MODS.readUInt32LE(setOffset+24);
  for(let i=first;i<first+count;i++){
    const p=i*40,file=str(c.MODN,c.MODD.readUIntLE(p,3)).toLowerCase().replace(/\.(?:mdx|mdl)$/i,'.m2');
    if(!modelsByName.has(file)){
      try{const m=model(file);modelsByName.set(file,models.length);models.push(m);}catch(e){skipped.push({file,reason:e.message});modelsByName.set(file,-1);}
    }
    const index=modelsByName.get(file);if(index<0)continue;
    instances.push({model:index,position:vec(c.MODD,p+4),rotation:[c.MODD.readFloatLE(p+16),c.MODD.readFloatLE(p+24),-c.MODD.readFloatLE(p+20),c.MODD.readFloatLE(p+28)],scale:c.MODD.readFloatLE(p+32),sourceIndex:i});
  }
  fs.writeFileSync(path.join(out,city+'.json'),JSON.stringify({city,source,set,sourceInstances:count,models,instances,skipped}));
  console.log(JSON.stringify({city,set,sourceInstances:count,models:models.length,instances:instances.length,textures:textureCache.size,skipped},null,2));
 }
}finally{archive.close();}
const conversion=spawnSync('py',['-3.11',path.join(__dirname,'textures.py'),cache,path.join(out,'textures')],{stdio:'inherit'});if(conversion.status!==0)process.exit(conversion.status||1);

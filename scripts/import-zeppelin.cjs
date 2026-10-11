// Import one named Wrath Horde transport and its exact referenced dependencies.
// Original archives are opened read-only; no game process or full city is used.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {WowArchive}=require('./wow-archive.cjs');
const T=require('three');
const SOURCE='World/wmo/transports/transport_horde_zeppelin/Transport_Horde_Zeppelin.wmo';
const arr=(b,p)=>({count:b.readUInt32LE(p),offset:b.readUInt32LE(p+4)});
const vec=(b,p)=>[b.readFloatLE(p),b.readFloatLE(p+8),-b.readFloatLE(p+4)];
const str=(b,p)=>b.toString('utf8',p,b.indexOf(0,p)<0?b.length:b.indexOf(0,p));
function chunks(b,start=0){const result={};for(let p=start;p+8<=b.length;){const size=b.readUInt32LE(p+4),id=b.toString('ascii',p,p+4).split('').reverse().join('');if(p+8+size>b.length)throw Error('Invalid '+id+' chunk');if(!result[id])result[id]=b.subarray(p+8,p+8+size);p+=8+size;}return result;}

function importZeppelin(root){
  const archive=new WowArchive(root),project=path.resolve(__dirname,'..'),out=path.join(project,'public/assets/transports'),cache=path.join(project,'cache/zeppelin-blp');
  fs.mkdirSync(out,{recursive:true});fs.mkdirSync(cache,{recursive:true});
  let bytes=0;const reads=new Map(),textures=new Map();
  const read=file=>{const key=file.toLowerCase().replaceAll('\\','/');if(reads.has(key))return reads.get(key);const b=archive.read(file);bytes+=b.length;if(reads.size>=64||bytes>64*1024*1024)throw Error('Named zeppelin import exceeded its dependency budget');reads.set(key,b);return b;};
  const texture=file=>{
    if(!file)return null;const key=file.toLowerCase().replaceAll('\\','/');if(textures.has(key))return textures.get(key);
    const id=crypto.createHash('sha1').update(key).digest('hex').slice(0,16),url='/assets/transports/textures/'+id+'.png';
    fs.writeFileSync(path.join(cache,id+'.blp'),read(file));textures.set(key,url);return url;
  };
  function track(b,p,index,animBuffer,type){
    const global=b.readInt16LE(p+2),ti=arr(b,p+4),va=arr(b,p+12),slot=global>=0?0:index;
    if(slot>=ti.count||slot>=va.count)return null;
    const times=arr(b,ti.offset+slot*8),values=arr(b,va.offset+slot*8),source=global>=0?b:animBuffer,stride=type==='rotation'?8:12;
    if(!times.count||!values.count)return null;
    if(times.offset+times.count*4>source.length||values.offset+values.count*stride>source.length)throw Error('Zeppelin animation track out of bounds');
    const n=Math.min(times.count,values.count),t=[],v=[];
    for(let i=0;i<n;i++){
      t.push(source.readUInt32LE(times.offset+i*4)/1000);const at=values.offset+i*stride;
      if(type==='rotation'){
        const q=Array.from({length:4},(_,j)=>{const e=source.readInt16LE(at+j*2);return(e<0?e+32768:e-32767)/32767;}),len=Math.hypot(...q)||1;v.push(q[0]/len,q[2]/len,-q[1]/len,q[3]/len);
      }else{const value=vec(source,at);if(type==='scale')value[2]*=-1;v.push(...value);}
    }
    return {times:t,values:v,interpolation:b.readUInt16LE(p),global};
  }
  function model(file){
    const b=read(file),skin=read(file.replace(/\.m2$/i,'00.skin'));if(b.toString('ascii',0,4)!=='MD20'||b.readUInt32LE(4)!==264||skin.toString('ascii',0,4)!=='SKIN')throw Error('Expected Wrath M2: '+file);
    const vertices=arr(b,60),bonesInfo=arr(b,44),animInfo=arr(b,28),texInfo=arr(b,80),materialsInfo=arr(b,112),combos=arr(b,128),globalsInfo=arr(b,20);
    const positions=[],normals=[],uv=[],joints=[],weights=[],bones=[];
    for(let i=0;i<vertices.count;i++){const p=vertices.offset+i*48;positions.push(...vec(b,p));normals.push(...vec(b,p+20));uv.push(b.readFloatLE(p+32),b.readFloatLE(p+36));for(let j=0;j<4;j++){weights.push(b[p+12+j]/255);joints.push(b[p+16+j]);}}
    for(let i=0;i<bonesInfo.count;i++){const p=bonesInfo.offset+i*88;bones.push({parent:b.readInt16LE(p+8),pivot:vec(b,p+76)});}
    const animations=[];for(let i=0;i<animInfo.count;i++){const p=animInfo.offset+i*64;animations.push({id:b.readUInt16LE(p),variation:b.readUInt16LE(p+2),duration:b.readUInt32LE(p+4)/1000,flags:b.readUInt32LE(p+12),alias:b.readUInt16LE(p+62)});}
    let index=animations.findIndex(a=>a.id===0&&a.variation===0);if(index<0)index=0;
    const tracks=[],clips=[];
    if(animations.length){
      const seen=new Set();while(animations[index].flags&64){if(seen.has(index))throw Error('Animation alias loop');seen.add(index);index=animations[index].alias;}
      const a=animations[index],animBuffer=a.flags&32?b:read(file.replace(/\.m2$/i,String(a.id).padStart(4,'0')+'-'+String(a.variation).padStart(2,'0')+'.anim'));
      for(let bone=0;bone<bones.length;bone++)for(const [type,offset] of [['position',16],['rotation',36],['scale',56]]){const data=track(b,bonesInfo.offset+bone*88+offset,index,animBuffer,type);if(data)tracks.push({bone,type,...data});}
      const local=tracks.filter(t=>t.global<0);if(local.length)clips.push({name:'idle',duration:a.duration,tracks:local});
      for(let g=0;g<globalsInfo.count;g++){const set=tracks.filter(t=>t.global===g);if(set.length)clips.push({name:'global-'+g,duration:b.readUInt32LE(globalsInfo.offset+g*4)/1000,tracks:set});}
    }
    const tx=[];for(let i=0;i<texInfo.count;i++){const p=texInfo.offset+i*16;if(b.readUInt32LE(p)!==0)throw Error('Unexpected replaceable zeppelin texture in '+file);tx.push(texture(str(b,b.readUInt32LE(p+12))));}
    const lookup=arr(skin,4),triangles=arr(skin,12),subs=arr(skin,28),batches=arr(skin,36),parts=[],used=new Set();
    for(let i=0;i<batches.count;i++){
      const p=batches.offset+i*24,sub=skin.readUInt16LE(p+4),mp=materialsInfo.offset+skin.readUInt16LE(p+10)*4,blend=b.readUInt16LE(mp+2),flags=b.readUInt16LE(mp),sp=subs.offset+sub*48,tex=b.readUInt16LE(combos.offset+skin.readUInt16LE(p+16)*2);
      if(used.has(sub)||!tx[tex])continue;const start=skin.readUInt16LE(sp+8)+(skin.readUInt16LE(sp+2)<<16),count=skin.readUInt16LE(sp+10),indices=[];
      for(let j=start;j<start+count;j++)indices.push(skin.readUInt16LE(lookup.offset+skin.readUInt16LE(triangles.offset+j*2)*2));
      parts.push({texture:tx[tex],blend,flags,indices});used.add(sub);
    }
    if(!parts.length)throw Error('No visible geometry for '+file);
    return {source:file,positions,normals,uv,joints,weights,bones,parts,clips};
  }
  let result;
  try{
    const c=chunks(read(SOURCE));if(c.MVER.readUInt32LE(0)!==17)throw Error('Expected WMO v17');
    const materials=[];for(let p=0;p<c.MOMT.length;p+=64)materials.push({flags:c.MOMT.readUInt32LE(p),blend:c.MOMT.readUInt32LE(p+8),texture:texture(str(c.MOTX,c.MOMT.readUInt32LE(p+12)))});
    const groups=[];
    for(let i=0;i<c.MOHD.readUInt32LE(4);i++){
      const source=SOURCE.replace(/\.wmo$/i,'_'+String(i).padStart(3,'0')+'.wmo'),g=chunks(read(source)).MOGP,s=chunks(g,68),positions=[],normals=[],uv=[],indices=[],batches=[];
      for(let p=0;p<s.MOVT.length;p+=12)positions.push(...vec(s.MOVT,p));for(let p=0;p<s.MONR.length;p+=12)normals.push(...vec(s.MONR,p));
      for(let p=0;p<s.MOTV.length;p+=4)uv.push(s.MOTV.readFloatLE(p));for(let p=0;p<s.MOVI.length;p+=2)indices.push(s.MOVI.readUInt16LE(p));
      for(let p=0;p<s.MOBA.length;p+=24)batches.push({start:s.MOBA.readUInt32LE(p+12),count:s.MOBA.readUInt16LE(p+16),material:s.MOBA[p+23]});
      groups.push({source,name:str(c.MOGN,g.readUInt32LE(0)),positions,normals,uv,indices,batches});
    }
    const models=[],instances=[],modelIds=new Map();let setOffset=0;
    for(let p=0;p<c.MODS.length;p+=32)if(str(c.MODS,p)==='Set_$DefaultGlobal'){setOffset=p;break;}
    const first=c.MODS.readUInt32LE(setOffset+20),count=c.MODS.readUInt32LE(setOffset+24);
    for(let i=first;i<first+count;i++){
      const p=i*40,file=str(c.MODN,c.MODD.readUIntLE(p,3)).replace(/\.(?:mdx|mdl)$/i,'.m2');
      if(!modelIds.has(file)){modelIds.set(file,models.length);models.push(model(file));}
      instances.push({model:modelIds.get(file),position:vec(c.MODD,p+4),rotation:[c.MODD.readFloatLE(p+16),c.MODD.readFloatLE(p+24),-c.MODD.readFloatLE(p+20),c.MODD.readFloatLE(p+28)],scale:c.MODD.readFloatLE(p+32)});
    }
    // Verify an empty central walking-deck point directly against the named
    // transport hull. This keeps flight.position at the player's eye, not in
    // the balloon or underneath the gondola after model normalization.
    const hull=new T.Group();for(const group of groups){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(group.positions,3));geometry.setIndex(group.indices);hull.add(new T.Mesh(geometry,new T.MeshBasicMaterial({side:T.DoubleSide})));}
    hull.updateMatrixWorld(true);const hits=new T.Raycaster(new T.Vector3(0,40,5),new T.Vector3(0,-1,0),0,100).intersectObject(hull,true),deck=hits.find(hit=>hit.face.normal.y>.98&&hit.point.y>-20&&hit.point.y<-15);
    if(!deck)throw Error('Expected Horde transport deck anchor missing');
    const bounds=new T.Box3().setFromObject(hull),length=bounds.max.x-bounds.min.x,presentation={length:38,scale:38/length,yaw:-Math.PI/2,deckAnchor:deck.point.toArray(),nativeHullBounds:[bounds.min.toArray(),bounds.max.toArray()]};
    hull.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});
    result={id:'horde-zeppelin',name:'Horde Zeppelin',build:12340,source:SOURCE,materials,groups,models,instances,presentation};
    fs.writeFileSync(path.join(out,'horde-zeppelin.json'),JSON.stringify(result));
    fs.writeFileSync(path.join(out,'provenance.json'),JSON.stringify({build:12340,source:SOURCE,dependencies:[...reads.keys()],geometry:'Original full WMO hull plus every default doodad; original M2 idle and global bone animation tracks.',textures:'Original diffuse BLP textures converted to PNG (maximum 512px). Secondary WoW shader passes and particle emitters are not reproduced.',presentation},null,2));
  }finally{archive.close();}
  const conversion=spawnSync('py',['-3.11',path.join(__dirname,'textures.py'),cache,path.join(out,'textures')],{stdio:'inherit'});if(conversion.status!==0)throw Error('Zeppelin texture conversion failed');
  console.log(JSON.stringify({source:SOURCE,groups:result.groups.length,doodads:result.instances.length,models:result.models.length,textures:textures.size,sourceBytes:bytes,presentation:result.presentation},null,2));return result;
}
if(require.main===module)importZeppelin(process.argv[2]);
module.exports={importZeppelin,chunks,SOURCE};

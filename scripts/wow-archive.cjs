const fs=require('node:fs');
const path=require('node:path');
const {MPQArchive}=require('../vendor/mpq/mpq');
class WowArchive {
  constructor(root='D:/Recovered/World of Warcraft Wrath of the Lich King - Copy'){
    const data=path.join(root,'Data');
    const names=['patch-3.MPQ','patch-2.MPQ','patch.MPQ','enUS/patch-enUS-3.MPQ','enUS/patch-enUS-2.MPQ','enUS/patch-enUS.MPQ','enUS/locale-enUS.MPQ','lichking.MPQ','expansion.MPQ','common-2.MPQ','common.MPQ'];
    this.archives=names.filter(n=>fs.existsSync(path.join(data,n))).map(n=>new MPQArchive(path.join(data,n)));
    this.files=[...new Set(this.archives.flatMap(a=>a.files))];
  }
  read(name,optional=false){name=name.replaceAll('/','\\');for(const a of this.archives){const b=a.extractFile(name);if(b)return Buffer.from(b);}if(optional)return null;throw new Error('Missing WoW asset: '+name);}
  close(){for(const a of this.archives)a.close();}
}
function dbc(buffer){
  if(buffer.toString('ascii',0,4)!=='WDBC')throw new Error('Expected Wrath WDBC');
  const count=buffer.readUInt32LE(4),fields=buffer.readUInt32LE(8),size=buffer.readUInt32LE(12),strings=20+count*size;
  return {rows:Array.from({length:count},(_,i)=>Array.from({length:fields},(_,f)=>buffer.readUInt32LE(20+i*size+f*4))),str(offset){const start=strings+offset;return buffer.toString('utf8',start,buffer.indexOf(0,start));}};
}
module.exports={WowArchive,dbc};

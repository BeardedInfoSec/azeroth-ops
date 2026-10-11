const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const schema = import(pathToFileURL(path.resolve(__dirname,'../src/map-layout.mjs')).href);
const CITIES = new Set(['stormwind','dalaran','darnassus']);
const ROOT = path.resolve(__dirname,'..');

// Read only the small source/instance metadata. Numeric geometry arrays are
// discarded while streaming, before JSON.parse; editor requests never retain a
// second city mesh. This runs lazily when the editor opens, not at game startup.
async function readPropMetadata(file,{highWaterMark=65536,maxOutput=8*1024*1024,maxInput=96*1024*1024}={}){
  const stat=await fs.promises.stat(file);if(stat.size>maxInput)throw new Error('Prop metadata source exceeds the editor limit');
  const skipKeys=new Set(['positions','uv','indices','normals','weights','joints']);
  let output='',string=false,escape=false,token='',lastString=null,pending=false,skip=0,skipString=false,skipEscape=false;
  for await(const chunk of fs.createReadStream(file,{encoding:'utf8',highWaterMark})){
    for(let i=0;i<chunk.length;i++){
      const char=chunk[i];
      if(skip){
        if(skipString){if(skipEscape)skipEscape=false;else if(char==='\\')skipEscape=true;else if(char==='"')skipString=false;continue;}
        // Geometry is almost entirely numbers. Skip runs in one operation.
        const regex=/[\[\]"]/g;regex.lastIndex=i;const match=regex.exec(chunk);if(!match)break;i=match.index;
        if(match[0]==='"')skipString=true;else if(match[0]==='[')skip++;else skip--;
        continue;
      }
      if(string){output+=char;token+=char;if(token.length>8192)throw new Error('Oversized metadata string');if(escape)escape=false;else if(char==='\\')escape=true;else if(char==='"'){string=false;lastString=JSON.parse(token);}continue;}
      if(char==='"'){string=true;token='"';output+=char;continue;}
      if(char===':'&&skipKeys.has(lastString)){pending=true;lastString=null;output+=char;continue;}
      if(pending&&char==='['){output+='[]';skip=1;pending=false;continue;}
      if(!/\s/.test(char)){pending=false;lastString=null;}
      output+=char;
    }
    if(output.length>maxOutput)throw new Error('Prop metadata exceeds the editor limit');
  }
  if(skip||string)throw new Error('Incomplete prop metadata');
  return JSON.parse(output);
}

function createMapLayouts({root=ROOT,now=Date.now,ttlMs=60000}={}){
  const publicRoot=path.resolve(root,'public'),layoutRoot=path.join(publicRoot,'assets/layouts'),catalogCache=new Map(),writes=new Map();
  const requireCity=city=>{if(!CITIES.has(city))throw Object.assign(new Error('Unknown city'),{status:400});return city;};
  async function catalog(city){
    requireCity(city);const previous=catalogCache.get(city);if(previous&&now()<previous.expires)return previous.promise;
    const promise=(async()=>{
      const {EDITOR_CITIES,LAYOUT_PREFABS}=await schema;
      let data,warning;
      try{data=await readPropMetadata(path.join(publicRoot,'assets/props',city+'.json'));}catch(error){if(error.code!=='ENOENT')throw error;data={models:[],instances:[]};warning='Original props have not been imported for this city.';}
      const models=Array.isArray(data.models)?data.models:[],instances=Array.isArray(data.instances)?data.instances:[];
      if(models.length>20000||instances.length>20000)throw new Error('Editor prop count exceeds the limit');
      const prefabs=LAYOUT_PREFABS.map(value=>({...value}));
      models.forEach((model,index)=>{if(typeof model.source==='string')prefabs.push({id:'wow:'+index,name:model.source.split(/[\\/]/).pop().replace(/\.m2$/i,'').replace(/[_-]+/g,' '),category:'World of Warcraft',source:model.source,size:[1,1,1],modelIndex:index});});
      // Catalog only imported machine models, never placeholders or paths into
      // an installed game. These editor placements are scenery, not shop logic.
      try{
        const file=path.join(publicRoot,'assets/machines/manifest.json'),stat=await fs.promises.stat(file);
        if(stat.size<=128*1024){const manifest=JSON.parse(await fs.promises.readFile(file,'utf8'));const entries=Array.isArray(manifest.machines)?manifest.machines:Object.entries(manifest.machines||{}).map(([id,value])=>({id,...value}));
          for(const item of entries){const url=item.model||item.url||item.file;if(item.available!==false&&/^[a-z0-9_-]{1,48}$/.test(item.id||'')&&typeof url==='string'&&/^\/assets\/machines\/[a-zA-Z0-9_./-]+\.glb$/.test(url)&&!url.includes('..')){try{await fs.promises.access(path.join(publicRoot,url));prefabs.push({id:'machine:'+item.id,name:(item.name||item.id.replace(/_/g,' '))+' (scenery)',category:'Imported COD machines',size:[1,2.7,1],url});}catch{}}}
        }
      }catch(error){if(error.code!=='ENOENT')warning='Machine catalog unavailable; other props remain usable.';}
      const points=[];instances.forEach((instance,index)=>{if(Number.isSafeInteger(instance.model)&&instance.model>=0&&instance.model<models.length&&Array.isArray(instance.position)&&instance.position.length===3&&instance.position.every(Number.isFinite))points.push({id:index,model:instance.model,position:instance.position,rotation:instance.rotation,scale:instance.scale});});
      return {city,...EDITOR_CITIES[city],prefabs,instances:points,instanceCount:instances.length,warning};
    })();
    catalogCache.set(city,{promise,expires:now()+ttlMs});promise.catch(()=>catalogCache.delete(city));return promise;
  }
  async function readLayout(city){
    requireCity(city);const {defaultLayout,validateLayout}=await schema,file=path.join(layoutRoot,city+'.json');
    try{const stat=await fs.promises.stat(file);if(stat.size>256*1024)throw new Error('Layout file too large');return validateLayout(JSON.parse(await fs.promises.readFile(file,'utf8')),{city});}
    catch(error){if(error.code==='ENOENT')return defaultLayout(city);throw error;}
  }
  async function saveLayout(city,input){
    requireCity(city);const {validateLayout}=await schema,assets=await catalog(city),layout=validateLayout(input,{city,prefabIds:new Set(assets.prefabs.map(item=>item.id)),instanceCount:assets.instanceCount});
    const task=(writes.get(city)||Promise.resolve()).catch(()=>{}).then(async()=>{
      // Verify ancestors before creating a directory: public or assets could
      // itself be a junction into an original game installation.
      const actualRoot=await fs.promises.realpath(root),actualPublic=await fs.promises.realpath(publicRoot),actualAssets=await fs.promises.realpath(path.join(publicRoot,'assets'));
      if(!actualPublic.startsWith(actualRoot+path.sep)||!actualAssets.startsWith(actualPublic+path.sep))throw new Error('Asset directory leaves the workspace');
      await fs.promises.mkdir(layoutRoot,{recursive:true});
      const actualLayout=await fs.promises.realpath(layoutRoot);
      if(!actualLayout.startsWith(actualAssets+path.sep))throw new Error('Layout directory leaves the workspace');
      const file=path.join(actualLayout,city+'.json'),temporary=path.join(actualLayout,city+'.'+crypto.randomBytes(6).toString('hex')+'.tmp');
      try{await fs.promises.writeFile(temporary,JSON.stringify(layout,null,2)+'\n',{encoding:'utf8',flag:'wx'});await fs.promises.rename(temporary,file);}finally{await fs.promises.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
      return layout;
    });writes.set(city,task);try{return await task;}finally{if(writes.get(city)===task)writes.delete(city);}
  }
  function json(req,res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify(value));}
  async function handle(req,res,pathname){
    if(pathname!=='/api/editor/catalog'&&!pathname.startsWith('/api/layouts/'))return false;
    try{
      if(pathname==='/api/editor/catalog'){
        if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');json(req,res,405,{error:'Method not allowed'});return true;}
        json(req,res,200,await catalog(new URL(req.url,'http://localhost').searchParams.get('city')));return true;
      }
      const city=pathname.slice('/api/layouts/'.length);requireCity(city);
      if(['GET','HEAD'].includes(req.method)){json(req,res,200,await readLayout(city));return true;}
      if(req.method!=='PUT'){res.setHeader('Allow','GET, HEAD, PUT');json(req,res,405,{error:'Method not allowed'});return true;}
      if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{}if(!origin||origin.host!==req.headers.host){json(req,res,403,{error:'Save maps from this server address'});return true;}}
      if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||'')){json(req,res,415,{error:'Expected a JSON layout'});return true;}
      let body='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>256*1024)throw Object.assign(new Error('Layout request too large'),{status:413});body+=chunk.toString('utf8');}
      let input;try{input=JSON.parse(body);}catch{throw Object.assign(new Error('Invalid JSON layout'),{status:400});}
      let result;try{result=await saveLayout(city,input);}catch(error){if(!error.code)error.status=400;throw error;}json(req,res,200,result);
    }catch(error){json(req,res,error.status||503,{error:error.status?error.message:'Map editor data is unavailable. Check the imported props and layout files.'});}
    return true;
  }
  return {catalog,readLayout,saveLayout,handle};
}
module.exports={createMapLayouts,readPropMetadata};

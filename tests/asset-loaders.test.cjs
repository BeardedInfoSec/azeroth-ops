const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');

// Synthetic bytes and fake image decoders only: no browser, GPU, or game assets.
let fixtureId=0;
async function fixture({responses={},decodeError=null,parseError=false}={}){
  const state={fetched:[],live:new Map(),created:[],revoked:[],decoded:[],disposed:[],active:0,peak:0,parsed:[]};
  const assetFetch=async url=>{
    state.fetched.push(url);const value=responses[url];
    return {ok:value?.ok!==false,status:value?.status||200,blob:async()=>({url}),arrayBuffer:async()=>value?.bytes};
  };
  class TextureLoader{
    async loadAsync(url){
      assert.ok(state.live.has(url),'blob URL exists when decoding starts');const source=state.live.get(url).url;
      state.active++;state.peak=Math.max(state.peak,state.active);
      try{
        await new Promise(resolve=>setTimeout(resolve,3));assert.ok(state.live.has(url),'blob URL remains live until decoded');
        if(source===decodeError)throw new Error('decode failed');
        state.decoded.push(source);return {image:{source},dispose(){state.disposed.push(source);}};
      }finally{state.active--;}
    }
  }
  class LoadingManager{setURLModifier(modifier){this.modifier=modifier;return this;}}
  class GLTFLoader{
    constructor(manager){this.manager=manager;}
    async parseAsync(bytes,base){
      const view=new DataView(bytes),document=JSON.parse(new TextDecoder().decode(new Uint8Array(bytes,20,view.getUint32(12,true))));
      const resources=[...document.images||[],...document.buffers||[]].filter(item=>item.uri).map(item=>/^(?:data|blob):/.test(item.uri)?item.uri:new URL(item.uri,base).href);
      for(const resource of resources){const resolved=this.manager.modifier(resource);if(!/^(?:data|blob):/.test(resource))assert.ok(state.live.has(resolved),'GLB image/buffer uses cached live blob');}
      await new Promise(resolve=>setTimeout(resolve,3));
      for(const resource of resources)if(!/^(?:data|blob):/.test(resource))assert.ok(state.live.has(this.manager.modifier(resource)),'GLB blobs survive parsing');
      state.parsed.push({base,resources});if(parseError)throw new Error('parse failed');return {scene:{name:'synthetic weapon'}};
    }
  }
  const urls={createObjectURL(blob){const url='blob:fixture-'+state.created.length;state.live.set(url,blob);state.created.push(url);return url;},revokeObjectURL(url){assert.ok(state.live.has(url),'each URL revoked exactly once');state.live.delete(url);state.revoked.push(url);}};
  const key=++fixtureId;(globalThis.__cacheLoaderFixtures||={})[key]={THREE:{TextureLoader,LoadingManager},GLTFLoader,assetFetch,urls};
  let source=fs.readFileSync('src/asset-loaders.js','utf8').replace(/^import .*;\r?\n/gm,'');
  source=`const {THREE,GLTFLoader,assetFetch,urls}=globalThis.__cacheLoaderFixtures[${key}];\n`+source.replaceAll('URL.createObjectURL','urls.createObjectURL').replaceAll('URL.revokeObjectURL','urls.revokeObjectURL');
  const api=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));delete globalThis.__cacheLoaderFixtures[key];return {api,state};
}
function glb(document){
  const json=JSON.stringify(document),padding=(4-Buffer.byteLength(json)%4)%4,chunk=Buffer.from(json+' '.repeat(padding));
  const bytes=new ArrayBuffer(20+chunk.length),view=new DataView(bytes);view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,bytes.byteLength,true);view.setUint32(12,chunk.length,true);view.setUint32(16,0x4e4f534a,true);new Uint8Array(bytes,20).set(chunk);return bytes;
}

test('texture sets deduplicate requests, limit decodes, and revoke only after readiness',async()=>{
  const {api,state}=await fixture();const textures=await api.loadCachedTextureSet(['/assets/a.png','/assets/a.png','/assets/b.png','/assets/c.png','/assets/d.png'],texture=>{texture.configured=true;});
  assert.equal(textures.size,4);assert.equal(state.fetched.length,4);assert.equal(state.peak,2);assert.equal(state.live.size,0);assert.equal(state.revoked.length,4);
  for(const texture of textures.values()){assert.ok(texture.image.source);assert.equal(texture.configured,true);}assert.equal(state.disposed.length,0);
});
test('failed texture decode settles outstanding loads and disposes partial successes',async()=>{
  const {api,state}=await fixture({decodeError:'/assets/bad.png'});
  await assert.rejects(api.loadCachedTextureSet(['/assets/a.png','/assets/bad.png','/assets/c.png','/assets/d.png']),/decode failed/);
  assert.equal(state.active,0);assert.equal(state.live.size,0);assert.deepEqual(state.disposed.sort(),['/assets/a.png','/assets/c.png','/assets/d.png']);assert.equal(state.revoked.length,4);
});
test('HTTP failures create no blob URL and clean successful texture loads',async()=>{
  const {api,state}=await fixture({responses:{'/assets/missing.png':{ok:false,status:404}}});
  await assert.rejects(api.loadCachedTextureSet(['/assets/missing.png','/assets/good.png']),/HTTP 404/);assert.deepEqual(state.disposed,['/assets/good.png']);assert.equal(state.created.length,1);assert.equal(state.live.size,0);
});
test('configuration failures also dispose the texture being configured',async()=>{
  const {api,state}=await fixture();await assert.rejects(api.loadCachedTextureSet(['/assets/a.png'],()=>{throw new Error('configuration failed');}),/configuration failed/);assert.deepEqual(state.disposed,['/assets/a.png']);assert.equal(state.live.size,0);
});
test('GLB external PNGs and buffers come from cache and keep the original base path',async()=>{
  const bytes=glb({images:[{uri:'gun.png'},{uri:'gun.png'},{uri:'data:image/png;base64,AA=='}],buffers:[{uri:'geometry.bin'}]});
  const {api,state}=await fixture({responses:{'/assets/weapons/gun.glb':{bytes}}});const model=await api.loadCachedGLTF('/assets/weapons/gun.glb');
  assert.equal(model.scene.name,'synthetic weapon');assert.deepEqual(state.fetched,['/assets/weapons/gun.glb','http://localhost/assets/weapons/gun.png','http://localhost/assets/weapons/geometry.bin']);assert.equal(state.parsed[0].base,'http://localhost/assets/weapons/');assert.equal(state.created.length,2);assert.equal(state.live.size,0);
});
test('GLB rejects external and out-of-assets dependencies before loading them',async()=>{
  for(const uri of ['https://example.com/gun.png','../../api/server']){
    const {api,state}=await fixture({responses:{'/assets/weapons/gun.glb':{bytes:glb({images:[{uri}]})}}});await assert.rejects(api.loadCachedGLTF('/assets/weapons/gun.glb'),/outside local assets/);assert.equal(state.fetched.length,1);assert.equal(state.created.length,0);
  }
});
test('failed GLB dependency download releases other completed dependency blobs',async()=>{
  const {api,state}=await fixture({responses:{'/assets/weapons/gun.glb':{bytes:glb({images:[{uri:'good.png'},{uri:'bad.png'}]})},'http://localhost/assets/weapons/bad.png':{ok:false,status:404}}});
  await assert.rejects(api.loadCachedGLTF('/assets/weapons/gun.glb'),/HTTP 404/);assert.equal(state.created.length,1);assert.equal(state.live.size,0);assert.equal(state.parsed.length,0);
});
test('failed GLB parse still releases dependency blob URLs',async()=>{
  const {api,state}=await fixture({parseError:true,responses:{'/assets/weapons/gun.glb':{bytes:glb({images:[{uri:'gun.png'}]})}}});await assert.rejects(api.loadCachedGLTF('/assets/weapons/gun.glb'),/parse failed/);assert.equal(state.live.size,0);assert.equal(state.revoked.length,1);
});

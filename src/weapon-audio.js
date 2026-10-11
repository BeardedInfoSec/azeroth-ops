import {GUNS} from './weapon-data.js';
import {assetFetch} from './asset-cache.mjs';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const coords=value=>Array.isArray(value)?value:[value?.x||0,value?.y||0,value?.z||0];
const urls=value=>typeof value==='string'?[value]:Array.isArray(value)?value.flatMap(urls):value?.clips?urls(value.clips):value?.url?[value.url]:[];

// Original PCM clips, mixed locally. This does not recreate BO2's proprietary sound mixer.
export class WeaponAudio{
  constructor({manifestUrl='/assets/audio/manifest.json',volume=.65,maxVoices=24,context=null}={}){
    this.manifestUrl=manifestUrl;this.volume=clamp(volume,0,1);this.maxVoices=Math.max(1,Math.floor(maxVoices));this.context=context;this.buffers=new Map();this.voices=new Set();this.weapons={};this.decoded=[];this.events=[];this.errors=[];this.loaded=false;this.disposed=false;this.loading=null;
    this.stats={playedShots:0,localShots:0,remoteShots:0,playedReloads:0,cancelledReloads:0,cancelledActions:0,dropped:0,culled:0,lastShotGun:null,lastPan:0,lastGain:0};
  }
  ensureContext(){
    if(this.disposed)return null;
    if(!this.context){const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)return null;this.context=new Audio();}
    if(!this.master){this.master=this.context.createGain();this.master.gain.value=this.volume;this.limiter=this.context.createDynamicsCompressor();this.limiter.threshold.value=-8;this.limiter.knee.value=12;this.limiter.ratio.value=6;this.limiter.attack.value=.003;this.limiter.release.value=.15;this.master.connect(this.limiter);this.limiter.connect(this.context.destination);}
    return this.context;
  }
  unlock(){const context=this.ensureContext();if(!context)return Promise.resolve(false);return context.resume().then(()=>context.state==='running').catch(error=>{this.errors.push('Audio unlock: '+error.message);return false;});}
  async load(){
    if(this.loading)return this.loading;
    this.loading=this.loadAssets().catch(error=>{this.errors.push(error.message);return false;});return this.loading;
  }
  async loadAssets(){
    const context=this.ensureContext();if(!context)throw new Error('Web Audio is unavailable');
    const response=await assetFetch(this.manifestUrl);if(!response.ok)throw new Error('Weapon audio manifest: HTTP '+response.status);const manifest=await response.json();
    const weapons=manifest.weapons||{};this.weapons=Array.isArray(weapons)?Object.fromEntries(weapons.map((weapon,i)=>[weapon.id||GUNS[i]?.id,weapon])):weapons;
    const paths=new Set();for(const weapon of Object.values(this.weapons))for(const name of ['shot','reload','reloadEmpty','bolt'])for(const url of this.clipPaths(weapon[name]))paths.add(url);
    const queue=[...paths];let cursor=0;
    await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{while(cursor<queue.length){const url=queue[cursor++];try{const res=await assetFetch(url);if(!res.ok)throw new Error('HTTP '+res.status);const buffer=await context.decodeAudioData(await res.arrayBuffer());if(this.disposed)return;this.buffers.set(url,buffer);let peak=0,total=0,count=0;for(let channel=0;channel<buffer.numberOfChannels;channel++){const samples=buffer.getChannelData(channel),stride=Math.max(1,Math.floor(samples.length/8192));for(let i=0;i<samples.length;i+=stride){peak=Math.max(peak,Math.abs(samples[i]));total+=samples[i]*samples[i];count++;}}this.decoded.push({url,duration:buffer.duration,channels:buffer.numberOfChannels,sampleRate:buffer.sampleRate,peak,rms:Math.sqrt(total/Math.max(1,count))});}catch(error){this.errors.push(url+': '+error.message);}}}));
    this.loaded=true;return this.available;
  }
  clipPaths(value){if(Array.isArray(value))return value.flatMap(item=>this.clipPaths(item));if(value?.events)return this.clipPaths(value.events);return urls(value);}
  gunId(gun){return typeof gun==='number'?GUNS[gun]?.id:typeof gun==='string'?gun:gun?.id;}
  clips(value){return urls(value).filter(url=>this.buffers.has(url));}
  pick(value){const clips=this.clips(value);return clips.length?clips[Math.floor(Math.random()*clips.length)]:null;}
  sequence(value){if(!value)return [];if(value.events)return this.sequence(value.events);if(typeof value==='string')return [{at:0,clips:[value]}];if(Array.isArray(value))return value.every(item=>typeof item==='string')?[{at:0,clips:value}]:value;return [{at:0,...value}];}
  spatial({remote=false,position,listenerPosition,listenerQuaternion,volume=1}={}){
    if(!remote)return {gain:clamp(volume,0,1),pan:0,distance:0};
    const source=coords(position),listener=coords(listenerPosition),delta=source.map((v,i)=>v-listener[i]),distance=Math.hypot(...delta);let right=[1,0,0];
    if(listenerQuaternion){const q=Array.isArray(listenerQuaternion)?listenerQuaternion:[listenerQuaternion.x,listenerQuaternion.y,listenerQuaternion.z,listenerQuaternion.w], [x,y,z,w]=q;right=[1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w)];}
    return {gain:clamp(volume,0,1)/(1+(distance/12)**2),pan:distance?clamp(delta.reduce((sum,v,i)=>sum+v*right[i],0)/distance,-1,1):0,distance};
  }
  play(url,{kind='shot',gun=null,at=0,gain=1,pan=0,remote=false}={}){
    const context=this.context,buffer=this.buffers.get(url);if(this.disposed||!buffer||context?.state!=='running'){this.stats.dropped++;return false;}
    while(this.voices.size>=this.maxVoices){const oldest=[...this.voices].find(voice=>voice.remote)||this.voices.values().next().value;this.stopVoice(oldest);this.stats.dropped++;}
    const source=context.createBufferSource(),level=context.createGain(),stereo=context.createStereoPanner();source.buffer=buffer;level.gain.value=gain;stereo.pan.value=pan;source.connect(level);level.connect(stereo);stereo.connect(this.master);
    const voice={source,level,stereo,kind,gun,remote,url,when:context.currentTime+Math.max(0,at)};this.voices.add(voice);source.onended=()=>this.releaseVoice(voice);source.start(voice.when);
    this.events.push({type:kind,gun,url,remote,pan,gain,at:voice.when});if(this.events.length>64)this.events.shift();return true;
  }
  releaseVoice(voice){if(!this.voices.delete(voice))return;voice.source.onended=null;voice.source.disconnect();voice.level.disconnect();voice.stereo.disconnect();}
  stopVoice(voice){if(!voice)return;try{voice.source.stop();}catch{}this.releaseVoice(voice);}
  shot(gun,options={}){
    const id=this.gunId(gun),weapon=this.weapons[id],url=this.pick(weapon?.shot),space=this.spatial(options);if(space.distance>100||space.gain<.005){this.stats.culled++;return false;}
    if(!url){this.stats.dropped++;return false;}const played=this.play(url,{...space,kind:'shot',gun:id,remote:!!options.remote});if(!played)return false;
    this.stats.playedShots++;this.stats[options.remote?'remoteShots':'localShots']++;this.stats.lastShotGun=id;this.stats.lastPan=space.pan;this.stats.lastGain=space.gain;
    for(const event of this.sequence(weapon.bolt)){const clip=this.pick(event);if(clip)this.play(clip,{...space,kind:'bolt',gun:id,at:Number(event.at)||0,remote:!!options.remote});}return true;
  }
  reload(gun,{empty=false,duration}={}){
    this.cancelReload();const id=this.gunId(gun),weapon=this.weapons[id],config=GUNS.find(g=>g.id===id),base=empty?config?.reloadEmpty:config?.reload,scale=Number.isFinite(duration)&&duration>0&&base?duration/base:1;let scheduled=0;
    for(const event of this.sequence((empty&&weapon?.reloadEmpty)||weapon?.reload)){const url=this.pick(event);if(url&&this.play(url,{kind:'reload',gun:id,at:Math.max(0,Number(event.at)||0)*scale,gain:.75}))scheduled++;}
    if(scheduled)this.stats.playedReloads++;return scheduled>0;
  }
  cancelReload(){let reload=false,any=false;for(const voice of [...this.voices])if(!voice.remote&&(voice.kind==='reload'||voice.kind==='bolt')){reload||=voice.kind==='reload';any=true;this.stopVoice(voice);}if(reload)this.stats.cancelledReloads++;if(any)this.stats.cancelledActions++;}
  stopAll(){this.cancelReload();for(const voice of [...this.voices])this.stopVoice(voice);}
  get available(){return GUNS.every(gun=>this.clips(this.weapons[gun.id]?.shot).length>0);}
  get state(){return {...this.stats,manifestReady:this.loaded,available:this.available,unlocked:this.context?.state==='running',clipsLoaded:this.buffers.size,activeVoices:this.voices.size,scheduledActions:[...this.voices].filter(v=>v.kind!=='shot').length,decoded:this.decoded.map(clip=>({...clip})),events:this.events.map(event=>({...event})),errors:[...this.errors]};}
  dispose(){this.stopAll();this.disposed=true;this.buffers.clear();this.master?.disconnect();this.limiter?.disconnect();this.context?.close().catch(()=>{});}
}

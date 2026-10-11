import * as THREE from 'three';

const FLASH_DURATION=.055;

// Keep these lights directly on the scene, including between shots. Changing
// the visible light count changes Three's material program key across the map.
export function createMuzzleLights(scene,capacity=2){
  const slots=Array.from({length:capacity},()=>{
    const light=new THREE.PointLight(0xffbd68,0,3,2);
    scene.add(light);
    return {light,source:null,remaining:0};
  });
  const visible=source=>{for(let object=source;object;object=object.parent)if(!object.visible)return false;return true;};
  function updateSlot(slot){
    slot.light.intensity=slot.remaining>0&&slot.source&&visible(slot.source)?2.5*slot.remaining/FLASH_DURATION:0;
    if(slot.light.intensity>0)slot.source.getWorldPosition(slot.light.position);
  }
  return {
    flash(source){
      const slot=slots.find(item=>item.source===source)||slots.find(item=>item.remaining<=0)||slots.reduce((oldest,item)=>item.remaining<oldest.remaining?item:oldest);
      slot.source=source;slot.remaining=FLASH_DURATION;updateSlot(slot);
    },
    update(dt){for(const slot of slots){slot.remaining=Math.max(0,slot.remaining-Math.max(0,dt));updateSlot(slot);}},
    reset(){for(const slot of slots){slot.source=null;slot.remaining=0;slot.light.intensity=0;}},
    dispose(){for(const slot of slots){scene.remove(slot.light);slot.light.dispose();}}
  };
}

export function createMuzzleEffect(atlases,lights){
  const group=new THREE.Group(),sprites=[];
  for(let i=0;i<2;i++){
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:atlases.get('fxt_fire_gas_flash')[0],transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
    sprite.raycast=()=>{};group.add(sprite);sprites.push(sprite);
  }
  let remaining=0;group.visible=false;
  return {
    group,
    trigger(weapon=0){
      remaining=FLASH_DURATION;group.visible=true;
      const frame=Math.random()<.5?0:1;
      sprites[0].material.map=atlases.get('fxt_fire_gas_flash')[frame];
      sprites[1].material.map=atlases.get(weapon===1?'fxt_fire_flame_vert_e':'fxt_fire_flame_vert_c')[frame];
      for(let i=0;i<sprites.length;i++){
        const sprite=sprites[i];sprite.material.rotation=Math.random()*Math.PI*2;
        sprite.scale.setScalar((i?.3:.43)*(.8+Math.random()*.4));sprite.material.opacity=i?.9:.7;
      }
      lights?.flash(group);
    },
    update(dt){
      remaining=Math.max(0,remaining-Math.max(0,dt));group.visible=remaining>0;
      for(let i=0;i<sprites.length;i++)sprites[i].material.opacity=remaining/FLASH_DURATION*(i?.9:.7);
    },
    reset(){remaining=0;group.visible=false;},
    dispose(){group.visible=false;for(const sprite of sprites)sprite.material.dispose();}
  };
}

// World flashes retain their sprites and materials instead of allocating and
// disposing two materials (and a new light) for every bot or network shot.
export function createMuzzlePool(scene,createEffect,capacity=16){
  const effects=Array.from({length:capacity},()=>{const effect=createEffect();scene.add(effect.group);return effect;});
  let next=0;
  return {
    trigger(position,weapon=0){const effect=effects[next];next=(next+1)%effects.length;effect.group.position.copy(position);effect.trigger(weapon);},
    update(dt){for(const effect of effects)if(effect.group.visible)effect.update(dt);},
    reset(){for(const effect of effects)effect.reset();next=0;},
    dispose(){for(const effect of effects){scene.remove(effect.group);effect.dispose();}}
  };
}

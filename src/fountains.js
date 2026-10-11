import * as THREE from 'three';
// Reconstructed water animation fitted to the original fountain's model space.
export function createFountain(source){
  const group=new THREE.Group(),human=source.includes('stormwindfountain'),clock={value:0};
  group.name='animated-fountain-water';
  const water=new THREE.ShaderMaterial({transparent:true,depthWrite:false,side:THREE.DoubleSide,uniforms:{time:clock},
    vertexShader:'varying vec2 p; void main(){p=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:'uniform float time; varying vec2 p; void main(){float r=length(p);float wave=sin(r*19.-time*4.+sin(p.x*7.+time)*.6);float glint=pow(max(0.,wave),12.);vec3 color=mix(vec3(.13,.38,.43),vec3(.67,.89,.94),.35+.3*wave);gl_FragColor=vec4(color+glint*.2,.67);}' });
  function pool(inner,outer,height){const mesh=new THREE.Mesh(new THREE.RingGeometry(inner,outer,80),water);mesh.rotation.x=-Math.PI/2;mesh.position.y=height;mesh.raycast=()=>{};group.add(mesh);}
  if(human){pool(1.72,4.75,1.32);pool(.85,2.45,3.43);}else pool(.14,.77,1.95);
  const jets=human?16:8,drops=24,positions=new Float32Array(jets*drops*3);
  const point=(j,t)=>{const angle=j/jets*Math.PI*2,r=human?2.38+1.55*t:.12+.48*t;return new THREE.Vector3(Math.cos(angle)*r,human?3.5+1.05*Math.sin(Math.PI*t)-2.18*t:1.98+1.15*Math.sin(Math.PI*t),Math.sin(angle)*r);};
  const streamMaterial=new THREE.MeshBasicMaterial({color:0xb3e3eb,transparent:true,opacity:.32,depthWrite:false});
  for(let j=0;j<jets;j++){
    const path=new THREE.CatmullRomCurve3(Array.from({length:17},(_,i)=>point(j,i/16)));
    const stream=new THREE.Mesh(new THREE.TubeGeometry(path,24,human?.022:.012,4,false),streamMaterial);stream.raycast=()=>{};group.add(stream);
  }
  const particles=new THREE.BufferGeometry();particles.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const spray=new THREE.Points(particles,new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{},
    vertexShader:'void main(){vec4 v=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp(95./max(1.,-v.z),1.5,8.);}',
    fragmentShader:'void main(){float d=length(gl_PointCoord-.5);if(d>.5)discard;gl_FragColor=vec4(.78,.94,1.,.8*(1.-d*2.));}'}));spray.frustumCulled=false;spray.raycast=()=>{};group.add(spray);
  function update(time){clock.value=time;for(let j=0;j<jets;j++)for(let d=0;d<drops;d++){const t=(d/drops+time*.64+j*.071)%1,p=point(j,t);p.x+=Math.sin(d*17+j)*.025;p.z+=Math.cos(d*13+j)*.025;p.toArray(positions,(j*drops+d)*3);}particles.attributes.position.needsUpdate=true;}
  update(0);return {group,update};
}

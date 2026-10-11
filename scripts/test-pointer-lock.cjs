// Simulate DOM pointer lock in browser tests. Native headless Chrome pointer lock
// can confine the user's Windows desktop cursor, even with an invisible window.
module.exports=async function installTestPointerLock(page){
  await page.addInitScript(()=>{
    let locked=null;
    Object.defineProperty(document,'pointerLockElement',{get:()=>locked,configurable:true});
    HTMLElement.prototype.requestPointerLock=async function(){locked=this;document.dispatchEvent(new Event('pointerlockchange'));};
    document.exitPointerLock=()=>{locked=null;document.dispatchEvent(new Event('pointerlockchange'));};
  });
};

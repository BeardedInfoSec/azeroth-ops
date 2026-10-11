// The large frozen layout arrives during loading. Position snapshots carry only
// its revision; retain it only for the same room, map and load generation.
export function mergeRoomLayout(previous,next){
  if(Object.hasOwn(next,'layout'))return next;
  const same=!!next.layoutRevision&&previous?.code===next.code&&previous.city===next.city&&previous.layoutRevision===next.layoutRevision&&previous.loadGeneration===next.loadGeneration;
  return {...next,layout:same?previous.layout??null:null};
}

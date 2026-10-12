// Single source of truth for the Stormwind district maps. Shared by the browser,
// the multiplayer server, the pack build script and the tests, so a district is
// defined (and clipped) identically everywhere. Pure logic only: no I/O.
//
// A district is a circular slice of the full city. Coordinates are NEVER
// re-centred, so authored layouts, hidden-prop ids and placements stay valid.
// Generated packs live in git-ignored public/assets; see scripts/build-districts.cjs.

export const SOURCE_CITY = 'stormwind';
// Pack contents: every triangle whose centroid lies inside PACK_RADIUS of the
// origin. The combat limit (src/game.js, server/multiplayer.mjs) is
// COMBAT_RADIUS around the spawn found within SPAWN_SEARCH_RADIUS of the origin,
// so play can never leave the pack: 75 + 24 < 100. The extra ring is skyline.
export const COMBAT_RADIUS = 75;
export const SPAWN_SEARCH_RADIUS = 24;
export const PACK_RADIUS = 100;

const STORMWIND_SKY = {sky: 0x91b8d0, fog: 0xa7c3cd};

// Origins are verified on real street-level ground (the survey's first guesses for
// Dwarven and Valley were on upper terraces/islands with too little reachable
// ground; see scratch notes in the build report). Keep them in sync with the packs:
// changing an origin means re-running `npm run build:districts`.
// `id` is what players, rooms and layouts use. `packId` names the generated files
// (public/assets/<packId>.json and props/<packId>.json). The legacy id
// 'stormwind' is the Trade District, so existing layouts and lobbies keep working.
export const DISTRICTS = Object.freeze([
  {id: 'stormwind', packId: 'stormwind-trade', name: 'Stormwind', subtitle: 'Trade District', region: 'EASTERN KINGDOMS', packName: 'Stormwind',
    origin: [-141, -8.02, 3], yaw: 4.712, radius: PACK_RADIUS, ...STORMWIND_SKY, legacy: true,
    notes: 'Open plaza ringed by shop buildings. Proven layout; suits every mode.', suits: ['tdm', 'domination', 'zombies', 'royale']},
  {id: 'stormwind-dwarven', packId: 'stormwind-dwarven', name: 'Dwarven District', subtitle: 'Stormwind', region: 'STORMWIND DISTRICT', packName: 'Stormwind: Dwarven District',
    origin: [-473.2, -6.94, -280.8], yaw: 0, radius: PACK_RADIUS, ...STORMWIND_SKY,
    notes: 'Broad flat court ringed by towers and arches. Low vertical risk.', suits: ['tdm', 'domination', 'zombies']},
  {id: 'stormwind-valley', packId: 'stormwind-valley', name: 'Valley of Heroes', subtitle: 'Stormwind', region: 'STORMWIND DISTRICT', packName: 'Stormwind: Valley of Heroes',
    origin: [-89.8, -4.12, -221.8], yaw: 0, radius: PACK_RADIUS, ...STORMWIND_SKY,
    notes: 'Large paved yard with a garrison and halls. Open, moderate height.', suits: ['tdm', 'domination', 'zombies']},
  {id: 'stormwind-park', packId: 'stormwind-park', name: 'Stormwind Park', subtitle: 'Night Elf Quarter', region: 'STORMWIND DISTRICT', packName: 'Stormwind: Park',
    origin: [-472.2, -11.3, 363.2], yaw: 0, radius: PACK_RADIUS, sky: 0x7aa0b0, fog: 0x93b4b4,
    notes: 'Round Night Elf plaza with taverns. Fewest groups, fastest to load.', suits: ['tdm', 'domination']},
]);

const byId = new Map(DISTRICTS.map(d => [d.id, d]));
export const districtIds = () => DISTRICTS.map(d => d.id);
export const isDistrictId = id => typeof id === 'string' && byId.has(id);
export const getDistrict = id => byId.get(id) || null;
export const isStormwindCity = id => isDistrictId(id);
// Every playable city id: the districts plus the other Wrath cities.
export const OTHER_CITIES = Object.freeze(['dalaran', 'darnassus']);
export const cityIds = () => [...districtIds(), ...OTHER_CITIES];
export const isCityId = id => isDistrictId(id) || OTHER_CITIES.includes(id);
// Distance from the spawn at which free-roam (explore) play is returned to safe ground.
// Districts end where their pack ends, so free roam stops short of the clipped edge.
export const exploreLimit = id => { const d = getDistrict(id); return d ? d.radius - SPAWN_SEARCH_RADIUS : 750; };

// Files to try for a city, best first. A district prefers its small pack and falls
// back to the full city so a fresh clone without `npm run build:districts` still
// plays (just slower). Non-district cities have a single candidate.
export function cityAssetCandidates(id) {
  const d = getDistrict(id);
  if (!d) return [{geometry: id + '.json', props: 'props/' + id + '.json', pack: false}];
  return [
    {geometry: d.packId + '.json', props: 'props/' + d.packId + '.json', pack: true},
    {geometry: SOURCE_CITY + '.json', props: 'props/' + SOURCE_CITY + '.json', pack: false},
  ];
}
export const packFiles = id => { const d = getDistrict(id); return d ? {geometry: d.packId + '.json', props: 'props/' + d.packId + '.json'} : null; };

export const defaultLighting = id => (isStormwindCity(id) ? 'spooky' : 'day');

export function inDistrict(district, point, margin = 0) {
  const d = typeof district === 'string' ? getDistrict(district) : district;
  if (!d) return false;
  const x = Array.isArray(point) ? point[0] : point.x, z = Array.isArray(point) ? point[2] : point.z;
  const r = d.radius + margin, dx = x - d.origin[0], dz = z - d.origin[2];
  return dx * dx + dz * dz <= r * r;
}

export function validateDistrictTable(table = DISTRICTS) {
  const problems = [], ids = new Set(), packs = new Set();
  for (const d of table) {
    if (!/^stormwind(?:-[a-z]+)?$/.test(d.id)) problems.push('bad id ' + d.id);
    if (ids.has(d.id)) problems.push('duplicate id ' + d.id);
    ids.add(d.id);
    if (!/^stormwind-[a-z]+$/.test(d.packId)) problems.push('bad pack id ' + d.packId);
    if (packs.has(d.packId)) problems.push('duplicate pack ' + d.packId);
    packs.add(d.packId);
    if (!Array.isArray(d.origin) || d.origin.length !== 3 || !d.origin.every(Number.isFinite)) problems.push('bad origin ' + d.id);
    if (!(d.radius >= COMBAT_RADIUS + SPAWN_SEARCH_RADIUS)) problems.push('radius too small to contain the combat area ' + d.id);
    if (!d.name || !d.subtitle) problems.push('missing name ' + d.id);
  }
  return problems;
}

// --- clipping -------------------------------------------------------------------

// Triangle is kept when its centroid is within the district circle.
export function triangleInDistrict(district, positions, a, b, c) {
  const x = (positions[a * 3] + positions[b * 3] + positions[c * 3]) / 3, z = (positions[a * 3 + 2] + positions[b * 3 + 2] + positions[c * 3 + 2]) / 3;
  return inDistrict(district, {x, z});
}

// Clips one geometry group (positions/uv/indices/batches) to the district. Vertices
// are re-indexed in order of first use, so the result is deterministic. Batch
// order and material ids are kept. Returns null when nothing survives.
export function clipGroup(group, district) {
  const remap = new Map(), positions = [], uv = [], indices = [], batches = [];
  const vertex = old => {
    let v = remap.get(old);
    if (v === undefined) {
      v = positions.length / 3; remap.set(old, v);
      positions.push(group.positions[old * 3], group.positions[old * 3 + 1], group.positions[old * 3 + 2]);
      uv.push(group.uv[old * 2], group.uv[old * 2 + 1]);
    }
    return v;
  };
  for (const batch of group.batches) {
    const start = indices.length;
    for (let i = batch.start; i + 2 < batch.start + batch.count; i += 3) {
      const a = group.indices[i], b = group.indices[i + 1], c = group.indices[i + 2];
      if (!triangleInDistrict(district, group.positions, a, b, c)) continue;
      indices.push(vertex(a), vertex(b), vertex(c));
    }
    if (indices.length > start) batches.push({...batch, start, count: indices.length - start});
  }
  if (!indices.length) return null;
  return {...group, positions, uv, indices, batches};
}

// Clips a whole city manifest ({materials, groups}). Only materials that still
// have triangles are kept (re-numbered in first-use order of the ORIGINAL list, so
// output is stable). Returns the manifest plus statistics.
export function clipCity(city, district) {
  const clipped = [];
  for (const group of city.groups) { const g = clipGroup(group, district); if (g) clipped.push(g); }
  const used = new Set();
  for (const g of clipped) for (const b of g.batches) used.add(b.material);
  const order = [...used].sort((a, b) => a - b), renumber = new Map(order.map((old, i) => [old, i]));
  const groups = clipped.map(g => ({...g, batches: g.batches.map(b => ({...b, material: renumber.get(b.material)}))}));
  const materials = order.map(i => city.materials[i]);
  const triangles = groups.reduce((n, g) => n + g.indices.length / 3, 0);
  return {manifest: {...city, id: district.packId, name: district.packName, district: {id: district.id, origin: district.origin, radius: district.radius, source: SOURCE_CITY}, materials, groups},
    stats: {groups: groups.length, triangles, materials: materials.length, vertices: groups.reduce((n, g) => n + g.positions.length / 3, 0)}};
}

// Props: keep instances whose origin is inside the district. Every kept instance
// stores its ORIGINAL array position as `index` (hidden-prop ids refer to it) and
// the pack records the original total as `instanceCount`. Models that no kept
// instance uses are replaced by empty stubs so model numbers (wow:<n> prefabs)
// stay valid.
export function clipProps(props, district) {
  const instances = [], used = new Set();
  props.instances.forEach((instance, i) => {
    if (!inDistrict(district, instance.position)) return;
    instances.push({...instance, index: instance.index ?? i}); used.add(instance.model);
  });
  const models = props.models.map((model, i) => used.has(i) ? model
    : {source: model.source, stub: true, positions: [], uv: [], parts: [], collision: {positions: [], indices: []}});
  return {...props, district: {id: district.id, origin: district.origin, radius: district.radius, source: SOURCE_CITY},
    models, instances, instanceCount: props.instanceCount ?? props.instances.length};
}

// The original id (array position) of a prop instance, in a full file or a pack.
export const instanceIndex = (instance, position) => instance.index ?? position;

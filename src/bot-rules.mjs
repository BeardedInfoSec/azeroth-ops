// Shared, pure rules for server-side AI operators ("bots") in LAN rooms.
// Used by the authoritative server (server/multiplayer.mjs, server/bots.mjs), the lobby UI and the tests.
// No Three.js, DOM or clock access.
export const BOT_DIFFICULTIES=Object.freeze(['easy','normal','hard']);
export const DEFAULT_BOT_DIFFICULTY='normal';
export const BOT_LIMITS=Object.freeze({teamMax:5,roomMax:10,royaleMax:10,minOccupants:2});
// Kills on a bot pay a quarter of the normal XP and share a weekly allowance (see server/profiles.mjs).
export const BOT_XP_FACTOR=.25;
export const WEEKLY_BOT_XP_CAP=3000;
export const BOT_TAG='BOT';
// Bots are available wherever players occupy normal slots. Undead Co-op (server-run undead AI) is out of scope.
export const botsSupported=mode=>mode==='tdm'||mode==='domination'||mode==='royale';
export const isBotDifficulty=value=>BOT_DIFFICULTIES.includes(value);

// Fixed, Azeroth-flavoured callsign pool. Every entry satisfies the human callsign rules (src/names.mjs),
// and humans may not claim them, so a bot name can never be impersonated.
export const BOT_NAMES=Object.freeze([
  'Gruntling','Ironforge Vet','Stormcrow','Moonwarden','Felhound','Ashenvale','Darkspear','Westfall Jack',
  'Murloc Mike','Defias Dan','Barrens Bandit','Gnomish Gus','Sunwell Scout','Orgrimmar Oz','Elwynn Ed','Teldrassil Tim',
  'Thunder Bluff','Silvermoon Sam','Exodar Eve','Undercity Uma','Karazhan Kai','Duskwood Dax','Hillsbrad Hal','Nagrand Nia',
  'Tanaris Tess','Winterspring','Felwood Finn','Mulgore Max','Dun Morogh Dee','Booty Bay Bo','Lordaeron Lee','Gilneas Greta',
  'Zangarmarsh','Stranglethorn','Redridge Rick','Arathi Ari','Azshara Ash','Ratchet Rae','Goldshire Gil','Sentinel Sky',
  'Cenarion Cal','Wildhammer','Frostwolf Fay','Stormpike Sid','Argent Abe','Scarlet Sue','Naxx Nate','Sholazar Sol',
]);
const keyOf=name=>String(name).toLowerCase();

// Next free pool name for a room. `used` holds the names already in the room (any case).
export function pickBotName(used,random=Math.random){
  const taken=new Set([...used].map(keyOf)),free=BOT_NAMES.filter(n=>!taken.has(keyOf(n)));
  if(free.length)return free[Math.min(free.length-1,Math.floor(Math.max(0,Math.min(1-Number.EPSILON,random()))*free.length))];
  // Pool exhausted (cannot happen with the 10-seat cap, kept as a safe fallback).
  for(let n=2;n<100;n++){const candidate=BOT_NAMES[0].slice(0,12)+' '+n;if(!taken.has(keyOf(candidate)))return candidate;}
  return 'Gruntling';
}

// Seats a room can hold for a mode (humans and bots together).
export const roomCapacity=mode=>mode==='zombies'?4:BOT_LIMITS.roomMax;
const teamsOf=players=>({alliance:players.filter(p=>p.team==='alliance').length,horde:players.filter(p=>p.team==='horde').length});

// Can a bot join `team` right now?  players: [{team,bot}]. Returns '' when allowed, else a user-facing reason.
export function botAddProblem(mode,players,team){
  if(!botsSupported(mode))return mode==='zombies'?'Bots are not available in Undead Co-op':'Bots are not available in this mode';
  if(team!=='alliance'&&team!=='horde')return 'Choose Alliance or Horde';
  if(players.length>=BOT_LIMITS.roomMax)return 'The lobby is full';
  if(mode!=='royale'&&teamsOf(players)[team]>=BOT_LIMITS.teamMax)return 'Team modes allow five players per faction';
  return '';
}
// Which faction should the next bot join? Keeps the sides even; ties go to the side with fewer humans.
export function balancedTeam(mode,players){
  const t=teamsOf(players);
  if(t.alliance!==t.horde)return t.alliance<t.horde?'alliance':'horde';
  const h=teamsOf(players.filter(p=>!p.bot));
  return h.alliance<=h.horde?'alliance':'horde';
}

// Target occupancy -> what to add/remove. players: [{id,team,bot}], target: total occupants wanted.
// Humans are never removed.  Returns {add:[team,...], remove:[id,...]}.
export function fillPlan({mode,players,target}){
  const out={add:[],remove:[]};if(!botsSupported(mode))return {add:[],remove:players.filter(p=>p.bot).map(p=>p.id)};
  const cap=Math.min(BOT_LIMITS.roomMax,Math.max(BOT_LIMITS.minOccupants,Math.floor(Number(target))||BOT_LIMITS.minOccupants));
  const sim=players.map(p=>({...p}));const count=()=>sim.length;
  const over=team=>mode!=='royale'&&teamsOf(sim)[team]>BOT_LIMITS.teamMax;
  // Trim: faction overflow first, then the most populated side.
  for(const team of ['alliance','horde'])while(over(team)){const i=sim.findIndex(p=>p.bot&&p.team===team);if(i<0)break;out.remove.push(sim[i].id);sim.splice(i,1);}
  while(count()>cap){
    const t=teamsOf(sim),candidates=sim.filter(p=>p.bot);if(!candidates.length)break;
    const heavy=t.alliance>=t.horde?'alliance':'horde',pick=candidates.reverse().find(p=>p.team===heavy)||candidates[0];
    out.remove.push(pick.id);sim.splice(sim.findIndex(p=>p.id===pick.id),1);
  }
  while(count()<cap){
    const team=balancedTeam(mode,sim);
    if(botAddProblem(mode,sim,team)){
      const other=team==='alliance'?'horde':'alliance';if(botAddProblem(mode,sim,other))break;
      out.add.push(other);sim.push({id:'new',team:other,bot:true});continue;
    }
    out.add.push(team);sim.push({id:'new',team,bot:true});
  }
  return out;
}

// Validates a host `bot-settings` message against current limits. Returns {ok,settings,reason}.
export function cleanBotSettings(m,current){
  const settings={difficulty:current.difficulty,fill:current.fill,target:current.target};
  if(m.difficulty!==undefined){if(!isBotDifficulty(m.difficulty))return {ok:false,reason:'Unknown bot difficulty'};settings.difficulty=m.difficulty;}
  if(m.fill!==undefined){if(typeof m.fill!=='boolean')return {ok:false,reason:'Invalid fill setting'};settings.fill=m.fill;}
  if(m.target!==undefined){
    if(!Number.isInteger(m.target)||m.target<BOT_LIMITS.minOccupants||m.target>BOT_LIMITS.roomMax)return {ok:false,reason:'Occupant target must be between '+BOT_LIMITS.minOccupants+' and '+BOT_LIMITS.roomMax};
    settings.target=m.target;
  }
  return {ok:true,settings};
}
export const defaultBotSettings=()=>({difficulty:DEFAULT_BOT_DIFFICULTY,fill:false,target:6});

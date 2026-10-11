// Callsign rules shared by the authoritative server and the lobby UI (client validation is only UX).
// Pure: no DOM, no clock. Names are plain text and must only ever be rendered with textContent.
import {BOT_NAMES,BOT_TAG} from './bot-rules.mjs';

export const NAME_MIN=3,NAME_MAX=16,TAG_MIN=2,TAG_MAX=4,RAW_LIMIT=64,NAME_CHANGE_COOLDOWN_MS=10000;
// ASCII letters, digits, space and _ - . ' only. Control, zero-width, bidi and every other non-ASCII
// code point are rejected rather than silently stripped, so nobody can spoof or reorder a name.
const ALLOWED=/^[A-Za-z0-9 _\-.']+$/,EDGE=/^[A-Za-z0-9](?:[\s\S]*[A-Za-z0-9])?$/;
const keyOf=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
const RESERVED_WORDS=['bot','admin','server','system'];
const RESERVED_KEYS=new Set([...RESERVED_WORDS,...BOT_NAMES.map(keyOf)]);
const RESERVED_TAGS=new Set([BOT_TAG,'ADM','SYS','SRV','MOD','GM']);
const reservedKey=key=>RESERVED_KEYS.has(key)||/^(bot|admin|server|system)\d*$/.test(key);

// ---- Profanity (small, local, obfuscated at rest) -------------------------------------------------------
// Entries are stored base64 so the source stays tame. "Substring" entries match anywhere in the
// normalised text; "token" entries only match a whole word (avoids Scunthorpe-style false positives).
const decode=b64=>(typeof Buffer!=='undefined'?Buffer.from(b64,'base64').toString('utf8'):atob(b64)).split(',');
const SUBSTRING_B64='ZnVjayxzaGl0LGJpdGNoLHB1c3N5LHdob3JlLGJhc3RhcmQsYXNzaG9sZSxuaWdnZXIsbmlnZ2EsZmFnZ290LHJldGFyZCxoaXRsZXIsZGlsZG8scGVuaXMsdmFnaW5hLHNsdXQsbW90aGVyZg==';
const TOKEN_B64='YXNzLGRpY2ssY29jayxmYWcscmFwZSxyYXBpc3QsbmF6aSxraWtlLHNwaWMsY2hpbmssdHdhdCx3YW5rLHBpc3MscG9ybix0aXRzLGFuYWwsY3VtLGN1bnQ=';
const LEET={'0':'o','1':'i','3':'e','4':'a','5':'s','7':'t','8':'b','9':'g','@':'a','$':'s','!':'i','+':'t','(':'c','|':'i'};
const squeeze=text=>text.replace(/(.)\1+/g,'$1');
const SUBSTRINGS=decode(SUBSTRING_B64).map(squeeze),TOKENS=new Set(decode(TOKEN_B64).map(squeeze));
// Leetspeak normalisation: lower case, map look-alike digits/symbols, then compare with repeated letters collapsed.
export function normalizeForFilter(text){
  return String(text).toLowerCase().replace(/[0-9@$!+(|]/g,c=>LEET[c]||c).replace(/[^a-z]+/g,' ').trim();
}
export function isProfane(text){
  const spaced=normalizeForFilter(text);if(!spaced)return false;
  const tokens=spaced.split(' ').map(squeeze),joined=squeeze(tokens.join(''));
  return tokens.some(t=>TOKENS.has(t))||SUBSTRINGS.some(w=>joined.includes(w));
}

// ---- Callsigns -------------------------------------------------------------------------------------------
const fail=(code,reason)=>({ok:false,code,reason});
export function defaultCallsign(random=Math.random){return 'Operator '+String(100+Math.floor(Math.max(0,Math.min(1-Number.EPSILON,random()))*900));}
/** Strict validation. Returns {ok:true,name,profane} or {ok:false,code,reason}. Never throws. */
export function checkCallsign(raw){
  if(typeof raw!=='string')return fail('type','Callsign must be text');
  if(raw.length>RAW_LIMIT)return fail('long','Callsign is too long');
  const trimmed=raw.replace(/^ +| +$/g,'');
  if(!trimmed)return fail('short','Callsign must be '+NAME_MIN+'-'+NAME_MAX+' characters');
  if(!ALLOWED.test(trimmed))return fail('chars',"Use letters, numbers, spaces and _ - . ' only");
  const name=trimmed.replace(/ {2,}/g,' ');
  if(name.length<NAME_MIN)return fail('short','Callsign must be at least '+NAME_MIN+' characters');
  if(name.length>NAME_MAX)return fail('long','Callsign can be at most '+NAME_MAX+' characters');
  if(!EDGE.test(name))return fail('edge','Callsign must start and end with a letter or number');
  if(reservedKey(keyOf(name)))return fail('reserved','That callsign is reserved');
  return {ok:true,name,profane:isProfane(name)};
}
/** Validation plus the profanity rule: a filtered name is replaced by "Operator NNN" and flagged. */
export function acceptCallsign(raw,{random=Math.random}={}){
  const result=checkCallsign(raw);if(!result.ok)return result;
  if(result.profane)return {ok:true,name:defaultCallsign(random),replaced:true,notice:'That callsign is not allowed. You have been given a default callsign.'};
  return {ok:true,name:result.name,replaced:false};
}
/** Optional clan tag, 2-4 letters/digits, shown upper case. '' clears it. */
export function checkTag(raw){
  if(raw===undefined||raw===null||raw==='')return {ok:true,tag:''};
  if(typeof raw!=='string'||raw.length>16)return fail('tag','Clan tag must be '+TAG_MIN+'-'+TAG_MAX+' letters or numbers');
  const tag=raw.replace(/^ +| +$/g,'');
  if(!tag)return {ok:true,tag:''};
  if(!/^[A-Za-z0-9]+$/.test(tag)||tag.length<TAG_MIN||tag.length>TAG_MAX)return fail('tag','Clan tag must be '+TAG_MIN+'-'+TAG_MAX+' letters or numbers');
  const upper=tag.toUpperCase();
  if(RESERVED_TAGS.has(upper))return fail('reserved','That clan tag is reserved');
  if(isProfane(upper))return fail('profane','That clan tag is not allowed');
  return {ok:true,tag:upper};
}
/** Case-insensitive uniqueness within a room: "Name", "Name (2)", "Name (3)" ... always <= NAME_MAX. */
export function uniqueName(name,taken){
  const used=new Set([...taken].map(n=>String(n).toLowerCase()));
  if(!used.has(name.toLowerCase()))return name;
  for(let n=2;n<1000;n++){
    const suffix=' ('+n+')',base=name.slice(0,NAME_MAX-suffix.length).replace(/[^A-Za-z0-9]+$/,''),candidate=base+suffix;
    if(!used.has(candidate.toLowerCase()))return candidate;
  }
  return name;
}
// ---- Formatting (one formatter for lobby, nameplates, scoreboard, results) ------------------------------
/** "[TAG] Name"; bots read "[BOT] Name" (the BOT tag is reserved, so humans cannot fake it). */
export function formatName(p){
  if(!p)return '';
  const tag=p.bot?BOT_TAG:p.tag;
  return (tag?'['+tag+'] ':'')+String(p.name??'');
}

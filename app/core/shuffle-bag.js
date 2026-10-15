/**
 * A strict, persistent freshness scheduler.
 * Unlike the old score-only shuffle bag, recently exposed source passages
 * are excluded, even when the displayed session is a multi-source deck.
 * A duplicate with a different ID is also excluded by normalized content.
 * The only way to repeat a recent passage automatically is to opt in via
 * allowRepeats (used exclusively by the explicit Replay action).
 */
import { getSeenState, saveSeenState } from './storage.js';

const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
export const TARGET_CHARS_BY_LEVEL={1:420,2:580,3:760,4:980,5:1250};
export const LENGTH_MULTIPLIERS={standard:1,long:1.32,endurance:1.72};
export const DEFAULT_COOLDOWN_DAYS=21;
const DAY_MS=86400000;
const MAX_HISTORY=640;

export function targetCharacters(level=3,lengthMode='long'){
  const base=TARGET_CHARS_BY_LEVEL[clamp(Number(level)||3,1,5)]||700;
  return Math.round(base*(LENGTH_MULTIPLIERS[lengthMode]||1.28));
}

export function canonicalText(text=''){
  return String(text||'').normalize('NFC')
    .replace(/[يى]/gu,'ی').replace(/ك/gu,'ک')
    .replace(/[\u064b-\u065f\u0670\u0640\u200e\u200f]/gu,'')
    .toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu,' ').trim();
}
export function contentFingerprint(text=''){
  const normalized=canonicalText(text);
  let hash=2166136261;
  for(let i=0;i<normalized.length;i++)hash=Math.imul(hash^normalized.charCodeAt(i),16777619);
  return (hash>>>0).toString(36);
}

/** Near duplicates are frequently made by changing a title, punctuation or one sentence. */
export function isNearDuplicate(a,b){
  const x=canonicalText(a),y=canonicalText(b);
  if(!x || !y)return false;
  if(x===y)return true;
  const shorter=x.length<y.length?x:y,longer=x.length<y.length?y:x;
  if(shorter.length>=80 && longer.includes(shorter))return true;
  const xa=x.split(' '),ya=y.split(' ');
  if(xa.length<10 || ya.length<10)return false;
  const shingle=tokens=>new Set(tokens.slice(0,-3).map((_,i)=>tokens.slice(i,i+4).join(' ')));
  const s=shingle(xa),t=shingle(ya);
  let common=0;for(const v of s)if(t.has(v))common++;
  return common>=8 && (common/Math.min(s.size,t.size)>=.73 || common/(s.size+t.size-common)>=.58);
}

function object(raw){return raw && typeof raw==='object' && !Array.isArray(raw) ? raw : {};}
function bucketFor(state,language){
  const key=`deck:${language}`,raw=object(state[key]);
  return {key,bucket:{
    recentIds:Array.isArray(raw.recentIds)?raw.recentIds:[],
    recentFingerprints:Array.isArray(raw.recentFingerprints)?raw.recentFingerprints:[],
    counts:object(raw.counts),lastSeen:object(raw.lastSeen),
    history:Array.isArray(raw.history)?raw.history.filter(v=>v&&typeof v==='object'&&typeof v.fp==='string'):[],
    completions:object(raw.completions),
    // Old builds carried an undated recent tail. Quarantine it once, then
    // expire it; never treat new 2.7 exposures as permanent legacy entries.
    legacyIds:Array.isArray(raw.legacyIds)?raw.legacyIds:(!raw.freshSchema?raw.recentIds||[]:[]),
    legacyFps:Array.isArray(raw.legacyFps)?raw.legacyFps:(!raw.freshSchema?raw.recentFingerprints||[]:[]),
    legacyUntil:Number(raw.legacyUntil)||0, freshSchema:2
  }};
}

/** Previous versions recorded IDs and timestamps but no per-content dates. */
function historicFreshness(item,bucket,now,cooldownDays){
  const fp=contentFingerprint(item.text),id=String(item.id||fp);
  const since=now-cooldownDays*DAY_MS;
  if(bucket.history.some(x=>x.at>=since && (x.fp===fp || x.id===id)))return true;
  const legacySeen=Number(bucket.lastSeen[id]||0);
  if(legacySeen>=since && legacySeen<=now+DAY_MS)return true;
  // Migration safety: old versions used fixed-size recent tails without times.
  // We exclude them until enough fresh content replaces those slots.
  if((bucket.legacyUntil||0)>=now){
    if(bucket.legacyIds.slice(-80).includes(id))return true;
    if(bucket.legacyFps.slice(-80).includes(fp))return true;
  }
  return false;
}

function recentSamples(bucket,now,cooldownDays){
  const cutoff=now-cooldownDays*DAY_MS;
  return bucket.history.filter(x=>x.at>=cutoff&&typeof x.sample==='string'&&x.sample.length>=40).map(x=>x.sample);
}

function eligible(items,{language='en',excludeIds=[],tag=null,bucket,now,cooldownDays,allowRepeats}){
  const except=new Set(excludeIds.map(String));
  const samples=recentSamples(bucket,now,cooldownDays);
  let candidates=items.filter(x=>x&&x.language===language&&typeof x.text==='string'&&x.text.trim()&&!except.has(String(x.id)));
  if(tag){candidates=candidates.filter(x=>(x.tags||[]).some(t=>String(t).toLowerCase().includes(String(tag).toLowerCase())));}
  // Deduplicate the pool by content, not ID. Identical custom and original
  // content can coexist in the Library but should appear just once in the deck.
  const known=new Set();
  candidates=candidates.filter(item=>{const fp=contentFingerprint(item.text);if(known.has(fp))return false;known.add(fp);return true;});
  if(!allowRepeats)candidates=candidates.filter(item=>!historicFreshness(item,bucket,now,cooldownDays) && !samples.some(sample=>isNearDuplicate(item.text,sample)));
  return candidates;
}

function rankCandidates(candidates,bucket,level){
  const exact=candidates.filter(x=>Number(x.level||level)===Number(level));
  const near=candidates.filter(x=>Number(x.level||level)!==Number(level)&&Math.abs(Number(x.level||level)-Number(level))===1);
  const far=candidates.filter(x=>Math.abs(Number(x.level||level)-Number(level))>1);
  const rank=xs=>xs.map(item=>({item,score:(Number(bucket.counts[item.id])||0)*1000-(Number(bucket.lastSeen[item.id])||0)/1e11+Math.random()*35})).sort((a,b)=>a.score-b.score).map(x=>x.item);
  return [...rank(exact),...rank(near),...rank(far)];
}

function recordExposure(bucket,selected,now){
  for(const item of selected){
    const id=String(item.id||contentFingerprint(item.text)),fp=contentFingerprint(item.text);
    bucket.recentIds.push(id);bucket.recentFingerprints.push(fp);
    bucket.lastSeen[id]=now;
    bucket.counts[id]=(Number(bucket.counts[id])||0)+1;
    bucket.history.push({id,fp,at:now,sample:String(item.text).slice(0,1800)});
  }
  bucket.recentIds=bucket.recentIds.slice(-MAX_HISTORY);
  bucket.recentFingerprints=bucket.recentFingerprints.slice(-MAX_HISTORY);
  bucket.history=bucket.history.slice(-MAX_HISTORY);
  // Guard against unbounded localStorage growth from AI-generated IDs.
  const oldest=Object.entries(bucket.lastSeen).sort((a,b)=>Number(b[1]||0)-Number(a[1]||0)).slice(0,MAX_HISTORY);
  const ids=new Set(oldest.map(([id])=>id));
  bucket.lastSeen=Object.fromEntries(oldest);
  bucket.counts=Object.fromEntries(Object.entries(bucket.counts).filter(([id])=>ids.has(id)));
}

function select(items,{language='en',level=3,recentWindow=24,lengthMode='long',targetChars=null,tag=null,excludeIds=[],allowRepeats=false,cooldownDays=DEFAULT_COOLDOWN_DAYS,now=Date.now(),single=false}={}){
  const state=getSeenState(),{key,bucket}=bucketFor(state,language);
  if(bucket.legacyIds.length && !bucket.legacyUntil){
    bucket.legacyUntil=now+cooldownDays*DAY_MS;
    state[key]=bucket;saveSeenState(state); // Save migration even when no fresh choices exist.
  }
  let candidates=eligible(items,{language,excludeIds,tag,bucket,now,cooldownDays,allowRepeats});
  if(!candidates.length)return null; // Never silently give yesterday's content again.
  const target=single?0:Math.max(180,targetChars??targetCharacters(level,lengthMode));
  const ordered=rankCandidates(candidates,bucket,level);
  const selected=[];let size=0;
  for(const item of ordered){
    if(selected.some(chosen=>isNearDuplicate(chosen.text,item.text)))continue;
    selected.push(item);size+=String(item.text||'').length+2;
    if(single || size>=target || selected.length>=12)break;
  }
  if(!selected.length)return null;
  recordExposure(bucket,selected,now);
  state[key]=bucket;const saved=saveSeenState(state);
  if(single)return {...selected[0],freshHistorySaved:saved};
  const first=selected[0],joined=selected.map(x=>String(x.text||'').trim()).join('\n\n').trim();
  if(selected.length===1)return {...first,sourceIds:[first.id],shortfallChars:Math.max(0,target-joined.length),freshSelection:!allowRepeats,freshHistorySaved:saved};
  return {
    id:`deck-${language}-${now}-${selected.map(x=>x.id).join('-')}`,
    language,level,title:language==='fa'?`مجموعه تمرین ${selected.length} بخشی`:`${selected.length}-passage practice deck`,
    source:'smart-deck',tags:['smart-deck',...(first.tags||[]).slice(0,2)],
    sourceIds:selected.map(x=>x.id),shortfallChars:Math.max(0,target-joined.length),
    freshSelection:!allowRepeats,freshHistorySaved:saved,text:joined
  };
}

export function pickFreshText(items,options={}){return select(items,{...options,single:true});}
export function pickFreshPassage(items,options={}){return select(items,options);}

/** Gives the UI actionable information when the pool is exhausted. */
export function deckAvailability(items,{language='en',level=3,cooldownDays=DEFAULT_COOLDOWN_DAYS,now=Date.now()}={}){
  const state=getSeenState(),{bucket}=bucketFor(state,language);
  if(bucket.legacyIds.length && !bucket.legacyUntil)bucket.legacyUntil=now+cooldownDays*DAY_MS;
  const all=eligible(items,{language,bucket,now,cooldownDays,allowRepeats:true,excludeIds:[]});
  const fresh=eligible(items,{language,bucket,now,cooldownDays,allowRepeats:false,excludeIds:[]});
  const exact=fresh.filter(x=>Number(x.level)===Number(level)).length;
  return {total:all.length,fresh:fresh.length,used:all.length-fresh.length,exact,days:cooldownDays,exhausted:all.length>0&&fresh.length===0};
}

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

/** Near duplicates are frequently made by changing a title, punctuation or one sentence.
 * Memoize n-gram sets so an N-text candidate pool doesn't retokenize the
 * same historical samples thousands of times on startup. */
const similarityCache=new Map();
const cachedTokens=raw=>{
  let hit=similarityCache.get(raw);if(hit)return hit;
  const normalized=canonicalText(raw),tokens=normalized.split(' ');
  const shingles=new Set();for(let i=0;i+4<=tokens.length;i++)shingles.add(tokens.slice(i,i+4).join(' '));
  hit={normalized,tokens,shingles};
  if(similarityCache.size>=500)similarityCache.delete(similarityCache.keys().next().value);
  similarityCache.set(raw,hit);return hit;
};
export function isNearDuplicate(a,b){
  const A=cachedTokens(a),B=cachedTokens(b);
  const x=A.normalized,y=B.normalized;
  if(!x || !y)return false;
  if(x===y)return true;
  const shorter=x.length<y.length?x:y,longer=x.length<y.length?y:x;
  if(shorter.length>=80 && longer.includes(shorter))return true;
  if(A.tokens.length<10 || B.tokens.length<10)return false;
  if(Math.max(A.tokens.length,B.tokens.length)>Math.min(A.tokens.length,B.tokens.length)*2.2)return false;
  const s=A.shingles,t=B.shingles;
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
    legacyUntil:Number(raw.legacyUntil)||0, freshSchema:Math.max(2,Number(raw.freshSchema)||0)
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
  const rank=xs=>xs.map(item=>({item,score:(Number(bucket.counts[item.id])||0)*1000+(Number(bucket.lastSeen[item.id])||0)/1e11+Math.random()*35})).sort((a,b)=>a.score-b.score).map(x=>x.item);
  return [...rank(exact),...rank(near),...rank(far)];
}

function recordExposure(bucket,selected,now,committed=false){
  for(const item of selected){
    const id=String(item.id||contentFingerprint(item.text)),fp=contentFingerprint(item.text);
    bucket.recentIds.push(id);bucket.recentFingerprints.push(fp);
    bucket.lastSeen[id]=now;
    bucket.counts[id]=(Number(bucket.counts[id])||0)+1;
    bucket.history.push({id,fp,at:now,sample:String(item.text).slice(0,1800),committed});
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

function select(items,{language='en',level=3,recentWindow=24,lengthMode='long',targetChars=null,tag=null,excludeIds=[],allowRepeats=false,cooldownDays=DEFAULT_COOLDOWN_DAYS,now=Date.now(),single=false,record=true}={}){
  const state=getSeenState(),{key,bucket}=bucketFor(state,language);
  if(bucket.legacyIds.length && !bucket.legacyUntil){
    bucket.legacyUntil=now+cooldownDays*DAY_MS;
    state[key]=bucket;saveSeenState(state); // Save migration even when no fresh choices exist.
  }
  let candidates=eligible(items,{language,excludeIds,tag,bucket,now,cooldownDays,allowRepeats});
  if(!candidates.length)return null; // Never silently give yesterday's content again.
  const target=single?0:Math.max(180,targetChars??targetCharacters(level,lengthMode));
  const ordered=rankCandidates(candidates,bucket,level);
  const selected=[];let size=0;const usedTopics=new Set();
  while(selected.length<12 && (single || size<target) && selected.length<ordered.length){
    let bestIndex=-1,bestScore=-1e9;
    for(let i=0;i<ordered.length;i++){
      const item=ordered[i];if(!item || selected.some(x=>x.id===item.id))continue;
      if(selected.some(x=>isNearDuplicate(x.text,item.text)))continue;
      const topic=String((item.tags||[]).find(t=>t!=='general')||item.source||'general');
      const remaining=Math.max(0,target-size),length=String(item.text||'').length;
      const score=-(i*4)+(usedTopics.has(topic)?-20:20)+(length<=remaining+120?18:0);
      if(score>bestScore){bestIndex=i;bestScore=score;}
    }
    if(bestIndex<0)break;
    const item=ordered[bestIndex];selected.push(item);
    usedTopics.add(String((item.tags||[]).find(t=>t!=='general')||item.source||'general'));
    size+=String(item.text||'').length+2;
    if(single)break;
  }
  if(!selected.length)return null;
  if(record)recordExposure(bucket,selected,now);
  state[key]=bucket;const saved=record?saveSeenState(state):true;
  if(single)return {...selected[0],sourceIds:[selected[0].id],sourceParts:[{id:selected[0].id,title:selected[0].title,text:selected[0].text,start:0,end:selected[0].text.length}],freshHistorySaved:saved};
  const first=selected[0],joined=selected.map(x=>String(x.text||'').trim()).join('\n\n').trim();
  const sourceParts=[];let offset=0;
  for(const item of selected){const value=String(item.text||'').trim();sourceParts.push({id:item.id,title:item.title||'',text:value,start:offset,end:offset+value.length});offset+=value.length+2;}
  if(selected.length===1)return {...first,sourceIds:[first.id],sourceParts,shortfallChars:Math.max(0,target-joined.length),freshSelection:!allowRepeats,freshHistorySaved:saved};
  return {
    id:`deck-${language}-${now}-${selected.map(x=>x.id).join('-')}`,
    language,level,title:language==='fa'?`مجموعه تمرین ${selected.length} بخشی`:`${selected.length}-passage practice deck`,
    source:'smart-deck',tags:['smart-deck',...(first.tags||[]).slice(0,2)],
    sourceIds:selected.map(x=>x.id),sourceParts,shortfallChars:Math.max(0,target-joined.length),
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

/** Commit an exposure only after the first real typing attempt. Previewing a
 * passage or closing the app without typing must not exhaust the library. */
export function commitPassageExposure(passage,{now=Date.now()}={}){
  if(!passage || passage.source==='adaptive' || passage.source==='recovery' || passage.source==='rhythm' || passage.source==='microscope')return true;
  const parts=Array.isArray(passage.sourceParts)&&passage.sourceParts.length?passage.sourceParts:[{id:passage.id,text:passage.text}];
  const state=getSeenState(),{key,bucket}=bucketFor(state,passage.language);
  recordExposure(bucket,parts,now,true);state[key]=bucket;return saveSeenState(state);
}

/** One-time correction for pre-2.8 histories: older versions recorded a
 * passage as practiced upon display, even when no keys were pressed. Only
 * reconcile those historical schemas; new committed exposures are authoritative.
 * A finished (even partial sprint) session establishes real activity.
 */
export function reconcileLegacyExposures(sessions=[],items=[],language='en'){
  const state=getSeenState(),key=`deck:${language}`,raw=state[key];
  if(!raw || Number(raw.freshSchema)>=3)return {changed:false,restored:0};
  const practicedIds=new Set(),practicedFingerprints=new Set();
  const passages=items.filter(x=>x.language===language&&x.text?.length>=20);
  for(const session of sessions){
    if(session.language!==language||!(session.completedChars>0))continue;
    if(session.textId)practicedIds.add(String(session.textId));
    for(const id of session.sourceIds||[])practicedIds.add(String(id));
    if(session.text) {
      practicedFingerprints.add(contentFingerprint(session.text));
      if(session.textId?.startsWith('deck-')){
        for(const item of passages){if(session.text.includes(item.text)){
          practicedIds.add(String(item.id));practicedFingerprints.add(contentFingerprint(item.text));
        }}
      }
    }
  }
  // Preserve exact sessions and their passage sources, discard display-only
  // usage from old versions that produced a false 'you have practiced all'.
  const old=Array.isArray(raw.history)?raw.history:[];
  const history=old.filter(h=>h.committed===true||practicedIds.has(String(h.id))||practicedFingerprints.has(h.fp));
  const restored=Math.max(0,old.length-history.length);
  raw.history=history;
  const keptIds=new Set(history.map(h=>String(h.id)));
  raw.counts=Object.fromEntries(Object.entries(raw.counts||{}).filter(([id])=>keptIds.has(id)));
  raw.lastSeen=Object.fromEntries(Object.entries(raw.lastSeen||{}).filter(([id])=>keptIds.has(id)));
  raw.recentIds=history.map(h=>h.id).slice(-MAX_HISTORY);
  raw.recentFingerprints=history.map(h=>h.fp).slice(-MAX_HISTORY);
  raw.legacyIds=[];raw.legacyFps=[];raw.legacyUntil=0;raw.freshSchema=3;
  state[key]=raw;
  return {changed:saveSeenState(state),restored};
}

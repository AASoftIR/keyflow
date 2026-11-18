/**
 * A strict, persistent freshness scheduler.
 * Unlike the old score-only shuffle bag, recently exposed source passages
 * are excluded, even when the displayed session is a multi-source deck.
 * A duplicate with a different ID is also excluded by normalized content.
 * The only way to repeat a recent passage automatically is to opt in via
 * allowRepeats (used exclusively by the explicit Replay action).
 */
import { getSeenState, saveSeenState } from './storage.js';
import { completedSourceIds } from '../next/review.js';

const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
export const TARGET_CHARS_BY_LEVEL={1:420,2:580,3:760,4:980,5:1250};
export const LENGTH_MULTIPLIERS={quick:.55,standard:1,long:1.32,endurance:1.72};
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
  // Schema <=3 stored first-keypress events as if they were completions.
  // Until migration, none of those records can safely quarantine a source.
  if(bucket.freshSchema>=4){
    if(bucket.history.some(x=>x.completed===true && x.at>=since && (x.fp===fp || x.id===id)))return true;
    // lastSeen from schema <=3 may be a first keypress, not a completion.
    // Authoritative history records are the only freshness source.
  }
  // Migration safety: old versions used fixed-size recent tails without times.
  // We exclude them until enough fresh content replaces those slots.
  if(bucket.freshSchema>=4 && (bucket.legacyUntil||0)>=now){
    if(bucket.legacyIds.slice(-80).includes(id))return true;
    if(bucket.legacyFps.slice(-80).includes(fp))return true;
  }
  return false;
}

function recentSamples(bucket,now,cooldownDays){
  const cutoff=now-cooldownDays*DAY_MS;
  return bucket.history.filter(x=>x.completed===true&&x.at>=cutoff&&typeof x.sample==='string'&&x.sample.length>=40).map(x=>x.sample);
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

function recordExposure(bucket,selected,now){
  for(const item of selected){
    const id=String(item.id||contentFingerprint(item.text)),fp=contentFingerprint(item.text);
    bucket.recentIds.push(id);bucket.recentFingerprints.push(fp);
    bucket.lastSeen[id]=now;
    bucket.counts[id]=(Number(bucket.counts[id])||0)+1;
    bucket.history.push({id,fp,at:now,sample:String(item.text).slice(0,1800),committed:true,completed:true});
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

/** Keep the last passage inside the requested length band without cutting
 * in the middle of a word. Prefer natural sentence or paragraph boundaries.
 * A partial excerpt still retains the ORIGINAL source ID for freshness history.
 */
export function excerptAtBoundary(raw,limit,{language='en'}={}){
  const text=String(raw||'').trim();
  if(text.length<=limit)return text;
  if(limit<30)return '';
  const min=Math.max(30,Math.floor(limit*.78));
  const head=text.slice(0,limit+1);
  const endings=language==='fa'?/[.!؟؛\n](?=\s|$)/gu:/[.!?;\n](?=\s|$)/gu;
  const candidates=[...head.matchAll(endings)].map(m=>m.index+1).filter(i=>i>=min&&i<=limit);
  if(candidates.length)return head.slice(0,candidates.at(-1)).trim();
  const lastSpace=Math.max(head.lastIndexOf(' ',limit),head.lastIndexOf('\n',limit));
  if(lastSpace>=min)return head.slice(0,lastSpace).trim();
  return ''; // Never silently cut in the middle of an unbreakable token.
}

function select(items,{language='en',level=3,recentWindow=24,lengthMode='long',targetChars=null,tag=null,excludeIds=[],allowRepeats=false,cooldownDays=DEFAULT_COOLDOWN_DAYS,now=Date.now(),single=false,record=false}={}){
  const state=getSeenState(),{key,bucket}=bucketFor(state,language);
  if(bucket.freshSchema>=4 && bucket.legacyIds.length && !bucket.legacyUntil){
    bucket.legacyUntil=now+cooldownDays*DAY_MS;
    state[key]=bucket;saveSeenState(state);
  }
  // A user's selected difficulty is a real content constraint. Never mix
  // level-1 passages into a level-5 session merely to make it longer.
  const candidates=eligible(items,{language,excludeIds,tag,bucket,now,cooldownDays,allowRepeats})
    .filter(x=>Number(x.level||level)===Number(level));
  if(!candidates.length)return null;
  const target=single?0:Math.max(180,targetChars??targetCharacters(level,lengthMode));
  const minimum=Math.ceil(target*.88),maximum=Math.floor(target*1.1);
  const ordered=rankCandidates(candidates,bucket,level);
  const selected=[];let size=0;const usedTopics=new Set();
  while(selected.length<18 && (single||size<minimum) && selected.length<ordered.length){
    let best=null,bestScore=-Infinity;
    for(let i=0;i<ordered.length;i++){
      const item=ordered[i];if(selected.some(x=>x.id===item.id))continue;
      if(selected.some(x=>isNearDuplicate(x.original.text,item.text)))continue;
      const topic=String((item.tags||[]).find(t=>t!=='general')||item.source||'general');
      const remaining=Math.max(0,target-size-(size?2:0));
      const originalText=String(item.text||'').trim();
      let text=originalText;
      if(!single && originalText.length>remaining){
        text=excerptAtBoundary(originalText,Math.min(originalText.length,maximum-size-(size?2:0)),{language});
        if(!text)continue;
      }
      const resulting=size+(size?2:0)+text.length;
      if(!single && resulting>maximum)continue;
      const distance=single?0:Math.abs(target-resulting);
      // Favor a close fit, less-used sources, and topic variety rather than
      // overlong random mixtures or picking the same introductory passage.
      const score=-distance*.18-i*2+(usedTopics.has(topic)?-13:13)+(resulting>=minimum?22:0);
      if(score>bestScore){bestScore=score;best={original:item,text,topic};}
    }
    if(!best)break;
    selected.push(best);usedTopics.add(best.topic);
    size+=best.text.length+(selected.length===1?0:2);
    if(single)break;
  }
  if(!selected.length)return null;
  // Save whole originals as exposure records; the displayed excerpt may be
  // shorter, but its source identity must remain quarantined until cooldown.
  if(record)recordExposure(bucket,selected.map(x=>x.original),now);
  state[key]=bucket;const saved=record?saveSeenState(state):true;
  const sourceParts=[];let offset=0;
  for(const s of selected){
    sourceParts.push({id:s.original.id,title:s.original.title||'',text:s.text,start:offset,end:offset+s.text.length,
      originalText:String(s.original.text),originalLength:String(s.original.text).length,excerpt:s.text.length<String(s.original.text).trim().length});
    offset+=s.text.length+2;
  }
  const first=selected[0].original;
  const joined=selected.map(x=>x.text).join('\n\n');
  if(single)return {...first,sourceIds:[first.id],sourceParts:[{...sourceParts[0],text:first.text,end:first.text.length,excerpt:false}],freshHistorySaved:saved};
  const info={sourceIds:selected.map(x=>x.original.id),sourceParts,
    shortfallChars:joined.length<minimum?Math.max(0,target-joined.length):0,freshSelection:!allowRepeats,
    freshHistorySaved:saved,targetChars:target,lengthBand:{min:minimum,max:maximum}};
  if(selected.length===1)return {...first,...info,text:joined};
  return {id:`deck-${language}-${now}-${selected.map(x=>x.original.id).join('-')}`,
    language,level,title:language==='fa'?`مجموعه تمرین ${selected.length} بخشی`:`${selected.length}-passage practice deck`,
    source:'smart-deck',tags:['smart-deck',...(first.tags||[]).slice(0,2)],...info,text:joined};
}


/** Blend a scarce topic-specific passage with general practice without
 * exceeding the selected length or consuming unseen source components.
 * Returns null if it cannot safely append a meaningful excerpt. */
export function blendBoundedPassages(focused,rest,{targetChars,language='en'}={}){
  if(!focused?.text||!rest?.text)return null;
  const target=Math.max(180,Number(targetChars)||targetCharacters(focused.level,'standard'));
  const budget=Math.floor(target*1.1)-focused.text.length-2;
  const excerpt=excerptAtBoundary(rest.text,budget,{language});
  if(!excerpt)return null;
  const shift=focused.text.length+2;
  const extraParts=(rest.sourceParts||[]).filter(p=>p.start<excerpt.length).map(p=>{
    const newEnd=Math.min(p.end,excerpt.length);
    return {...p,text:excerpt.slice(p.start,newEnd),end:newEnd,start:p.start};
  });
  if(!extraParts.length)return null;
  const joined=`${focused.text}\n\n${excerpt}`;
  const sourceIds=[...new Set([...(focused.sourceIds||[focused.id]),...extraParts.map(p=>p.id)])];
  return {...focused,id:`${focused.id}+${rest.id}`,title:`${focused.title} + ${rest.title}`,
    source:'smart-deck',text:joined,sourceIds,
    sourceParts:[...(focused.sourceParts||[]),...extraParts.map(p=>({...p,start:p.start+shift,end:p.end+shift}))],
    targetChars:target,shortfallChars:joined.length<Math.ceil(target*.88)?target-joined.length:0};
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

/** Compatibility helper for *explicitly completed* passages only. Never call
 * this on selection or first keypress; app production uses commitSessionCompletions. */
export function commitPassageExposure(passage,{now=Date.now()}={}){
  if(!passage || passage.source==='adaptive' || passage.source==='recovery' || passage.source==='rhythm' || passage.source==='microscope')return true;
  const parts=Array.isArray(passage.sourceParts)&&passage.sourceParts.length?passage.sourceParts:[{id:passage.id,text:passage.text}];
  const state=getSeenState(),{key,bucket}=bucketFor(state,passage.language);
  recordExposure(bucket,parts.map(p=>({...p,text:p.originalText||p.text})),now);bucket.freshSchema=4;state[key]=bucket;return saveSeenState(state);
}

/** Retained legacy conversion helper; v3.2 uses reconcileFirstKeyHistory,
 * which requires actual passage completion rather than any typed character. */
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

/** Called only AFTER a finished session is durably saved. A started or abandoned
 * passage is intentionally absent from the anti-repeat pool. Mixed decks commit
 * only those source parts whose final grapheme was reached. */
export function commitSessionCompletions(session,passage,{now=Date.now()}={}){
  const ids=new Set(completedSourceIds(session));
  if(!ids.size)return {completed:[],saved:true};
  const parts=(Array.isArray(passage?.sourceParts)&&passage.sourceParts.length)
    ?passage.sourceParts:[{id:passage?.id,text:passage?.text,originalText:passage?.text}];
  const selected=parts.filter(p=>ids.has(p.id));
  if(!selected.length)return {completed:[],saved:true};
  const state=getSeenState(),{key,bucket}=bucketFor(state,session.language);
  // Idempotence: the same completed session may be reprocessed after a crash.
  const already=new Set(bucket.history.filter(h=>h.sessionId===session.id).map(h=>h.id));
  const fresh=selected.filter(p=>!already.has(p.id));
  if(!fresh.length)return {completed:[...ids],saved:true};
  // Old first-keypress records must not become authoritative merely because
  // one new passage completed before the background migration ran.
  if(bucket.freshSchema<4){bucket.history=[];bucket.recentIds=[];bucket.recentFingerprints=[];bucket.lastSeen={};bucket.counts={};}
  recordExposure(bucket,fresh.map(p=>({id:p.id,text:p.originalText||p.text})),now);
  for(const entry of bucket.history.slice(-fresh.length))entry.sessionId=session.id;
  bucket.freshSchema=4;bucket.legacyIds=[];bucket.legacyFps=[];bucket.legacyUntil=0;
  state[key]=bucket;
  return {completed:fresh.map(p=>p.id),saved:saveSeenState(state)};
}

/** Upgrade v3.1 history, where "committed" meant one pressed key. Reconstruct
 * exact completions from saved sessions. Old incomplete work is NOT consumed.
 * No forced reopening of a passage or destructive change to the sessions DB. */
export function reconcileFirstKeyHistory(sessions=[],texts=[],language='en'){
  const state=getSeenState(),{key,bucket}=bucketFor(state,language);
  if(bucket.freshSchema>=4)return {changed:false,restored:0};
  const lookup=new Map(texts.filter(p=>p.language===language).map(p=>[String(p.id),p]));
  const reconstructed=[];
  for(const session of sessions){
    if(session.language!==language||session.summary?.reliable===false)continue;
    const ids=completedSourceIds(session);
    for(const id of ids){
      const passage=lookup.get(String(id));
      if(!passage)continue;
      reconstructed.push({id:String(id),fp:contentFingerprint(passage.text),
        at:Number(session.endedAt||session.startedAt)||Date.now(),sample:String(passage.text).slice(0,1800),
        committed:true,completed:true,sessionId:session.id});
    }
  }
  reconstructed.sort((a,b)=>a.at-b.at);
  const complete=reconstructed.slice(-MAX_HISTORY),oldCount=bucket.history.length;
  bucket.history=complete;bucket.recentIds=complete.map(h=>h.id);
  bucket.recentFingerprints=complete.map(h=>h.fp);
  bucket.counts={};bucket.lastSeen={};
  for(const item of complete){bucket.counts[item.id]=(bucket.counts[item.id]||0)+1;bucket.lastSeen[item.id]=item.at;}
  bucket.freshSchema=4;bucket.legacyIds=[];bucket.legacyFps=[];bucket.legacyUntil=0;
  state[key]=bucket;
  return {changed:saveSeenState(state),restored:Math.max(0,oldCount-complete.length)};
}

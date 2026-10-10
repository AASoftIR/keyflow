import { getSeenState, saveSeenState } from './storage.js';

const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
export const TARGET_CHARS_BY_LEVEL={1:420,2:580,3:760,4:980,5:1250};
export const LENGTH_MULTIPLIERS={standard:1,long:1.32,endurance:1.72};

export function targetCharacters(level=3,lengthMode='long'){
  const base=TARGET_CHARS_BY_LEVEL[clamp(Number(level)||3,1,5)]||700;
  return Math.round(base*(LENGTH_MULTIPLIERS[lengthMode]||1.28));
}

export function contentFingerprint(text=''){
  const normalized=String(text).toLowerCase().replace(/[\p{P}\p{S}\s]+/gu,' ').trim();
  let hash=2166136261;
  for(let i=0;i<normalized.length;i++){hash^=normalized.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return (hash>>>0).toString(36);
}

function bucketFor(state,language){
  const key=`deck:${language}`;
  const raw=state[key]||{};
  return {key,bucket:{recentIds:Array.isArray(raw.recentIds)?raw.recentIds:[],recentFingerprints:Array.isArray(raw.recentFingerprints)?raw.recentFingerprints:[],counts:raw.counts||{},lastSeen:raw.lastSeen||{}}};
}

function rankCandidates(candidates,bucket,level,recentWindow){
  const now=Date.now();
  const recentSet=new Set(bucket.recentIds.slice(-recentWindow));
  return candidates.map(item=>{
    const count=bucket.counts[item.id]||0;
    const age=now-(bucket.lastSeen[item.id]||0);
    const recentPenalty=recentSet.has(item.id)?500:0;
    const levelPenalty=Math.abs(Number(item.level||level)-Number(level))*34;
    const ageBonus=Math.min(120,age/3.6e6); // one point per hour, capped
    return {item,score:count*120+recentPenalty+levelPenalty-ageBonus+Math.random()*18};
  }).sort((a,b)=>a.score-b.score);
}


function effectiveRecentWindow(candidateCount,requested){
  // Keep a protected no-repeat tail, but always leave a few older items able
  // to re-enter the deck.  If every source becomes permanently 'recent', the
  // recent penalty stops differentiating anything and users see loops again.
  const ceiling=Math.max(0,candidateCount-2);
  return Math.max(0,Math.min(Number(requested)||24,ceiling));
}

function levelOrderedPool(candidates,bucket,level,recentWindow){
  const exact=candidates.filter(x=>Number(x.level||level)===Number(level));
  const near=candidates.filter(x=>Number(x.level||level)!==Number(level) && Math.abs(Number(x.level||level)-Number(level))===1);
  const far=candidates.filter(x=>Math.abs(Number(x.level||level)-Number(level))>1);
  return [
    ...rankCandidates(exact,bucket,level,recentWindow),
    ...rankCandidates(near,bucket,level,recentWindow),
    ...rankCandidates(far,bucket,level,recentWindow)
  ];
}

function mark(bucket,item,recentWindow){
  const fp=contentFingerprint(item.text);
  bucket.recentIds.push(item.id);
  bucket.recentIds=bucket.recentIds.slice(-Math.max(18,recentWindow));
  bucket.recentFingerprints.push(fp);
  bucket.recentFingerprints=bucket.recentFingerprints.slice(-Math.max(18,recentWindow));
  bucket.counts[item.id]=(bucket.counts[item.id]||0)+1;
  bucket.lastSeen[item.id]=Date.now();
}

export function pickFreshText(items,{language='en',level=null,recentWindow=24}={}){
  const candidates=items.filter(x=>x.language===language && (!level || Number(x.level)===Number(level)));
  if(!candidates.length) return null;
  const state=getSeenState();
  const {key,bucket}=bucketFor(state,language);
  const window=effectiveRecentWindow(candidates.length,recentWindow);
  const ranked=levelOrderedPool(candidates,bucket,level||3,window);
  const recentFp=new Set(bucket.recentFingerprints.slice(-window));
  const choice=(ranked.find(x=>!recentFp.has(contentFingerprint(x.item.text)))||ranked[0]).item;
  mark(bucket,choice,window);state[key]=bucket;saveSeenState(state);return choice;
}

export function pickFreshPassage(items,{language='en',level=3,recentWindow=24,lengthMode='long',targetChars=null,tag=null,excludeIds=[]}={}){
  const state=getSeenState();
  const {key,bucket}=bucketFor(state,language);
  let candidates=items.filter(x=>x.language===language && !excludeIds.includes(x.id));
  if(tag){
    const tagged=candidates.filter(x=>(x.tags||[]).some(t=>String(t).toLowerCase().includes(String(tag).toLowerCase())));
    if(tagged.length) candidates=tagged;
    else return null;
  }
  const target=Math.max(180,targetChars||targetCharacters(level,lengthMode));
  const window=effectiveRecentWindow(candidates.length,recentWindow);
  const recentFp=new Set(bucket.recentFingerprints.slice(-window));
  const selected=[];let length=0;
  // Exact-level material is consumed before adjacent/fallback material.  That
  // makes Level 1–5 an actual content progression instead of a cosmetic label.
  let pool=levelOrderedPool(candidates,bucket,level,window);
  while(pool.length && length<target){
    let idx=pool.findIndex(x=>!selected.some(s=>s.id===x.item.id) && !recentFp.has(contentFingerprint(x.item.text)));
    if(idx<0) idx=pool.findIndex(x=>!selected.some(s=>s.id===x.item.id));
    if(idx<0) break;
    const [entry]=pool.splice(idx,1); selected.push(entry.item); length+=String(entry.item.text||'').length+1;
    if(selected.length>=12) break;
  }
  if(!selected.length) return null;
  selected.forEach(item=>mark(bucket,item,window));state[key]=bucket;saveSeenState(state);
  const primary=selected[0];
  if(selected.length===1) return {...primary,shortfallChars:Math.max(0,target-String(primary.text||'').length)};
  const joiner=' ';
  return {
    id:`deck-${language}-${Date.now()}-${selected.map(x=>x.id).join('-')}`,
    language,
    level,
    title:language==='fa'?`مجموعه تمرین ${selected.length} بخشی`:`${selected.length}-passage practice deck`,
    source:'smart-deck',
    tags:['smart-deck','no-repeat',...(primary.tags||[]).slice(0,2)],
    sourceIds:selected.map(x=>x.id),
    shortfallChars:Math.max(0,target-selected.map(x=>String(x.text||'').trim()).join(joiner).length),
    text:selected.map(x=>String(x.text||'').trim()).join(joiner).trim()
  };
}

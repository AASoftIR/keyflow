import { graphemes } from './normalization.js';

const safeNumber=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const dateKey=ms=>{const d=new Date(ms);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};

/** Pace ghost measures a TARGET trajectory, not an invented competing player. */
export function paceGhost({index=0,total=0,elapsedMs=0,targetWpm=40}={}){
  const target=clamp(safeNumber(targetWpm,40),5,180);
  const count=Math.max(0,safeNumber(total));
  const typed=clamp(safeNumber(index),0,count);
  const elapsed=Math.max(0,safeNumber(elapsedMs));
  const ghostChars=clamp(target*5*elapsed/60000,0,count);
  const measuredWpm=elapsed>=2500&&typed>=12?typed/5/(elapsed/60000):0;
  const remaining=Math.max(0,count-typed);
  const secondsLeft=measuredWpm>=5?clamp(Math.round(remaining/(measuredWpm*5)*60),0,7200):null;
  return {ghostPct:count?ghostChars/count*100:0,actualPct:count?typed/count*100:0,behindChars:Math.max(0,Math.round(ghostChars-typed)),secondsLeft,measuredWpm};
}

/** Error clusters are extracted without altering the Persian glyph run. */
export function mistakeMicroscope(session,maxItems=8){
  const chars=graphemes(session?.text||'',session?.language||'en');
  const errors=(session?.events||[]).filter(e=>e.type==='key'&&!e.correct);
  const groups=new Map();
  for(const e of errors){
    const at=clamp(Math.trunc(safeNumber(e.index)),0,Math.max(0,chars.length-1));
    let a=at,b=at;
    while(a>0 && !/\s/u.test(chars[a-1]))a--;
    while(b<chars.length-1 && !/\s/u.test(chars[b+1]))b++;
    const word=chars.slice(a,b+1).join('').replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu,'');
    if(!word)continue;
    const key=word.toLocaleLowerCase(session.language==='fa'?'fa':'en');
    const old=groups.get(key)||{word,count:0,indices:[]};
    old.count++;old.indices.push(at);groups.set(key,old);
  }
  return [...groups.values()].sort((a,b)=>b.count-a.count||a.indices[0]-b.indices[0]).slice(0,maxItems);
}

export function errorTimeline(session,buckets=10){
  const count=clamp(Math.round(safeNumber(buckets,10)),2,30);
  const rows=Array.from({length:count},(_,i)=>({label:`${Math.round(i*100/count)}–${Math.round((i+1)*100/count)}%`,value:0,typed:0}));
  const events=(session?.events||[]).filter(e=>e.type==='key');
  const total=Math.max(1,safeNumber(session?.textLength,graphemes(session?.text||'',session?.language||'en').length));
  for(const e of events){const at=clamp(Math.floor(Math.max(0,safeNumber(e.index))/total*count),0,count-1);rows[at].typed++;if(!e.correct)rows[at].value++;}
  return rows;
}

export function compareSession(current,previous){
  if(!current?.summary?.reliable || !previous?.summary?.reliable)return null;
  return {wpmDelta:safeNumber(current.summary.wpm)-safeNumber(previous.summary.wpm),accuracyDelta:safeNumber(current.summary.accuracy)-safeNumber(previous.summary.accuracy),consistencyDelta:safeNumber(current.summary.consistency)-safeNumber(previous.summary.consistency),referenceId:previous.id};
}

/** Daily quests have no network, no wall-clock session padding and no daily XP farming. */
export function dailyQuests(sessions,{today=new Date(),dailyMinutes=15,language=null}={}){
  const key=dateKey(today);
  const todays=(sessions||[]).filter(s=>(!language||s.language===language)&&dateKey(s.startedAt)===key&&s.summary?.reliable);
  const minutes=todays.reduce((n,s)=>n+Math.max(0,s.summary.durationMs||0)/60000,0);
  const clean=todays.some(s=>s.summary.accuracy>=97 && s.summary.typed>=50);
  const variety=new Set(todays.map(s=>s.text?String(s.text).normalize('NFC').replace(/\s+/g,' ').trim():s.textId||s.title).filter(Boolean)).size;
  const goal=Math.max(1,safeNumber(dailyMinutes,15));
  return [
    {id:'duration',name:'Daily focus',description:`${Math.round(minutes)} of ${goal} active minutes`,progress:clamp(minutes/goal,0,1),complete:minutes>=goal},
    {id:'precision',name:'Precision run',description:'Finish one 50+ key passage at 97%+ accuracy',progress:clean?1:0,complete:clean},
    {id:'variety',name:'Variety explorer',description:`${Math.min(3,variety)} of 3 different passages today`,progress:clamp(variety/3,0,1),complete:variety>=3}
  ];
}

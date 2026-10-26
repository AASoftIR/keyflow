import {contentFingerprint} from './shuffle-bag.js';
const finite=n=>Number.isFinite(Number(n))?Number(n):0;
export function perPassageHistory(passages,sessions=[],seenState={}){
  const result=new Map(passages.map(p=>[p.id,{id:p.id,attempts:0,enteredCount:0,completions:0,bestWpm:0,averageWpm:0,averageAccuracy:0,minutes:0,lastAt:0,practicedChars:0,attemptedDates:new Set(),runs:[]} ]));
  const byFingerprint=new Map(passages.map(p=>[contentFingerprint(p.text),p.id]));
  for(const s of sessions){
    if(!s || !s.text || !['fa','en'].includes(s.language))continue;
    const ids=new Set(Array.isArray(s.sourceIds)?s.sourceIds:[]);
    if(s.textId)ids.add(s.textId);
    if(!ids.size && s.completionReason==='passage'){
      const match=byFingerprint.get(contentFingerprint(s.text));if(match)ids.add(match);
    }
    // Old composite decks did not store component IDs. Content matching is
    // restricted to full component inclusions, not loose substring matches.
    if(s.textId?.startsWith('deck-') && !s.sourceIds){
      for(const p of passages)if(p.language===s.language && String(p.text).length>=90 && s.text.includes(p.text))ids.add(p.id);
    }
    for(const id of ids){
      const r=result.get(id);if(!r)continue;
      const part=(s.sourceParts||[]).find(p=>p.id===id);
      const start=finite(part?.start),end=part?finite(part.end):finite(s.textLength||s.text.length);
      const covered=Math.max(0,Math.min(finite(s.completedChars),end)-start);
      if(part && !covered)continue;
      const full=part?covered>=end-start:s.completionReason==='passage';
      r.attempts++;if(full)r.completions++; // Section completion is valid even if the overall sprint stopped later.
      r.practicedChars+=covered;
      const duration=finite(s.activeDurationMs||s.summary?.durationMs);
      r.minutes+=duration/60000*(covered/Math.max(1,finite(s.completedChars)));
      const wpm=s.summary?.reliable!==false?finite(s.summary?.wpm):0;
      const acc=finite(s.summary?.accuracy);
      if(wpm>0){r.averageWpm+=wpm;r.bestWpm=Math.max(r.bestWpm,wpm);}
      r.averageAccuracy+=acc;
      const at=finite(s.endedAt||s.startedAt);r.lastAt=Math.max(r.lastAt,at);
      if(at)r.attemptedDates.add(new Date(at).toISOString().slice(0,10));
      r.runs.push({at,wpm,accuracy:acc,full,covered});
    }
  }
  // Committed exposure is written on the first actual keypress. It also
  // survives when someone closes an unfinished, untimed session (for which
  // there is not yet a timed summary in IndexedDB).
  for(const [bucketKey,bucket] of Object.entries(seenState||{})){
    const language=bucketKey.replace(/^deck:/,'');
    for(const entry of bucket?.history||[]){
      if(entry.committed!==true)continue; // Older preview-only records were unreliable.
      const r=result.get(entry.id);
      if(!r||passages.find(p=>p.id===entry.id)?.language!==language)continue;
      r.enteredCount++;
      r.lastAt=Math.max(r.lastAt,finite(entry.at));
    }
  }
  for(const r of result.values()){
    r.started=Math.max(r.attempts,r.enteredCount);
    if(r.attempts){r.averageWpm/=r.attempts;r.averageAccuracy/=r.attempts;}
    r.uniqueDays=r.attemptedDates.size;delete r.attemptedDates;
    r.runs.sort((a,b)=>b.at-a.at);r.runs=r.runs.slice(0,15);
  }
  return result;
}

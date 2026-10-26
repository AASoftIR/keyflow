import {graphemes} from '../core/normalization.js';
// Passage review is opt-in. Ordinary fresh-only selection remains untouched.
export const REVIEW_STEPS=[1,3,7,14,30,60];
export function reviewGrade(summary){
  if(!summary?.reliable || !(summary.typed>=20))return null;
  return Number(summary.accuracy)>=97 && Number(summary.consistency)>=55 ? 'strong' :
    Number(summary.accuracy)>=90 ? 'developing':'retry';
}
export function recordReview(state,id,summary,now=Date.now()){
  if(!id || typeof id!=='string')return state;
  const grade=reviewGrade(summary);if(!grade)return state;
  const next={...(state||{})};const prev=next[id]||{step:-1,attempts:0};
  const step=grade==='strong'?Math.min(REVIEW_STEPS.length-1,(prev.step??-1)+1):grade==='retry'?-1:Math.max(-1,(prev.step??-1)-1);
  const days=grade==='retry'?1:REVIEW_STEPS[Math.max(0,step)];
  next[id]={step,attempts:(prev.attempts||0)+1,lastGrade:grade,lastAt:now,dueAt:now+days*86400000};
  return next;
}
export function dueReviews(state,texts,{language=null,now=Date.now(),limit=10}={}){
  const rows=(texts||[]).filter(x=>x && x.id && (!language||x.language===language))
    .filter(x=>state?.[x.id] && (state[x.id].dueAt||0)<=now)
    .map(x=>({...x,review:state[x.id]}));
  return rows.sort((a,b)=>a.review.dueAt-b.review.dueAt).slice(0,limit);
}
export function completedSourceIds(session){
  if(session?.completionReason!=='passage'||!session.summary?.reliable)return [];
  if(Array.isArray(session.sourceParts)&&session.sourceParts.length){
    // sourceParts offsets are UTF-16; completedChars counts graphemes.
    const endGraphemes=(end)=>graphemes(String(session.text||'').slice(0,end),session.language||'en').length;
    return [...new Set(session.sourceParts.filter(x=>x.id && session.completedChars>=endGraphemes(x.end)).map(x=>x.id))];
  }
  return session.textId?[session.textId]:[];
}

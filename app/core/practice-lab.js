/** Pure training analytics: all calculations are DOM-independent and localized to a session. */
const finite=(n,fallback=0)=>Number.isFinite(Number(n))?Number(n):fallback;
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
export const SPRINT_OPTIONS=Object.freeze([0,60,180,300]);
export function normalizeSprintSeconds(value){const n=Number(value);return SPRINT_OPTIONS.includes(n)?n:0;}
export function timeRemaining(activeMs,sprintSeconds){const limit=normalizeSprintSeconds(sprintSeconds)*1000;return limit?Math.max(0,Math.ceil((limit-Math.max(0,finite(activeMs)))/1000)):null;}
export function milestoneBucket(index,total,buckets=8){const n=Math.max(1,Math.trunc(finite(buckets,8)));return clamp(Math.floor(Math.max(0,finite(index))/Math.max(1,finite(total))*n),0,n-1);}
export function milestoneSummary(attempts=[],mistakes=[],progress=0,total=1){
  return attempts.map((count,i)=>({index:i,attempts:count||0,errors:mistakes[i]||0,accuracy:count?Math.max(0,Math.round(100*(1-(mistakes[i]||0)/count))):null,completed:i<milestoneBucket(progress,total,attempts.length),active:i===milestoneBucket(progress,total,attempts.length)}));
}
export function wordBoundaries(chars){
  const entries=[];let start=-1;
  for(let i=0;i<=chars.length;i++){
    const value=chars[i]||'';
    if(i<chars.length&&!/\s/u.test(value)){if(start<0)start=i;}
    else if(start>=0){entries.push({start,end:i,word:chars.slice(start,i).join('')});start=-1;}
  }
  return entries;
}
export function wordHorizon(words,index){
  if(!words.length)return {current:'',next:'',remaining:0,total:0,position:0};
  let low=0,high=words.length;
  while(low<high){const mid=(low+high)>>1;if(words[mid].end<=index)low=mid+1;else high=mid;}
  return {current:words[low]?.word||'',next:words[low+1]?.word||'',remaining:Math.max(0,words.length-low),total:words.length,position:Math.min(words.length,low+1)};
}
export function recommendRecovery({attempts=[],mistakes=[],total=1,index=0}={}){
  const bucket=milestoneBucket(index,total,Math.max(1,attempts.length));
  const n=attempts[bucket]||0,e=mistakes[bucket]||0;
  if(n<8)return {level:'warmup',text:'Building a reliable rhythm sample'};
  if(e/n>=.25)return {level:'repair',text:'Precision alert: slow down and rebuild the current phrase'};
  if(e/n>=.1)return {level:'careful',text:'A few errors in this section—prioritize clean movement'};
  return {level:'flow',text:'Good control in this section—keep a steady cadence'};
}
export function bookmarkKey(text){
  const normalized=String(text||'').normalize('NFC').replace(/\s+/gu,' ').trim().toLocaleLowerCase();
  let hash=2166136261;
  for(let i=0;i<normalized.length;i++)hash=Math.imul(hash^normalized.charCodeAt(i),16777619);
  return (hash>>>0).toString(36);
}
export function boundedBookmarks(items,max=36){
  return Array.isArray(items)?items.filter(x=>x&&typeof x==='object'&&typeof x.text==='string'&&x.text.length>0&&x.text.length<=6000).slice(-max):[];
}

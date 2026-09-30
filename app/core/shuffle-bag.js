import { getSeenState, saveSeenState } from './storage.js';

export function pickFreshText(items,{language='en',level=null,recentWindow=12}={}){
  const candidates=items.filter(x=>x.language===language && (!level || Number(x.level)===Number(level)));
  if(!candidates.length) return null;
  const state=getSeenState();
  const key=`${language}:${level ?? 'all'}`;
  const bucket=state[key] || {recent:[],counts:{}};
  const recent=new Set(bucket.recent.slice(-recentWindow));
  let pool=candidates.filter(x=>!recent.has(x.id));
  if(!pool.length){ bucket.recent=[]; pool=[...candidates]; }
  const minimum=Math.min(...pool.map(x=>bucket.counts[x.id]||0));
  const least=pool.filter(x=>(bucket.counts[x.id]||0)===minimum);
  const choice=least[Math.floor(Math.random()*least.length)];
  bucket.recent.push(choice.id);
  bucket.recent=bucket.recent.slice(-Math.max(recentWindow,3));
  bucket.counts[choice.id]=(bucket.counts[choice.id]||0)+1;
  state[key]=bucket;
  saveSeenState(state);
  return choice;
}

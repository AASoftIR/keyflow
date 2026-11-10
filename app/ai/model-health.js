/** Privacy-preserving per-model health signals used ONLY for automatic routing.
 * No prompts, completions, API keys or provider error bodies are stored. */
import {loadJson,saveJson} from '../core/storage.js';
const STORAGE='keyflow.ai-model-health.v1';
const COOLDOWN_MS=30*60*1000;
const WINDOW_MS=60*60*1000;
const MAX_ENTRIES=100;
const key=(provider,model)=>`${provider}\n${model}`;
const load=()=>{const obj=loadJson(STORAGE,{});return obj && typeof obj==='object' && !Array.isArray(obj)?obj:{}};

export function getModelHealth(provider,model,now=Date.now()){
  const row=load()[key(provider,model)]||{};
  return {successes:Math.max(0,Number(row.successes)||0),failures:Math.max(0,Number(row.failures)||0),
    streak:Math.max(0,Number(row.streak)||0),blockedUntil:Math.max(0,Number(row.blockedUntil)||0),
    isCoolingDown:(Number(row.blockedUntil)||0)>now,lastKind:String(row.lastKind||''),lastAt:Number(row.lastAt)||0};
}
export function recordModelHealth(provider,model,{ok=false,kind='content',now=Date.now()}={}){
  if(!provider||!model)return null;
  if(kind==='account'||kind==='cancelled')return getModelHealth(provider,model,now);
  const state=load(),id=key(provider,model),prev=state[id]||{};
  const streak=ok?0:((now-(Number(prev.lastAt)||0)<=WINDOW_MS?Number(prev.streak)||0:0)+1);
  state[id]={successes:Math.min(9999,(Number(prev.successes)||0)+(ok?1:0)),failures:Math.min(9999,(Number(prev.failures)||0)+(ok?0:1)),
    streak,lastAt:now,lastKind:ok?'success':String(kind).slice(0,35),blockedUntil:!ok&&streak>=3?now+COOLDOWN_MS:ok?0:Number(prev.blockedUntil)||0};
  const recent=Object.entries(state).sort((a,b)=>(Number(b[1]?.lastAt)||0)-(Number(a[1]?.lastAt)||0)).slice(0,MAX_ENTRIES);
  saveJson(STORAGE,Object.fromEntries(recent));
  return getModelHealth(provider,model,now);
}
/** Never block the explicitly chosen primary. Avoid unhealthy fallbacks when
 * at least one healthy model exists; rank by observed success and recency. */
export function preferHealthyFallbacks(provider,ids=[],now=Date.now()){
  const unique=[...new Set(ids.filter(Boolean))];
  const rows=unique.map((id,index)=>({id,index,health:getModelHealth(provider,id,now)}));
  const available=rows.filter(row=>!row.health.isCoolingDown);
  const candidates=available.length?available:rows;
  return candidates.sort((a,b)=>{
    const outcome=x=>x.health.successes*2-x.health.failures;
    return outcome(b)-outcome(a)||a.index-b.index;
  }).map(row=>row.id);
}
export function resetModelHealth(provider=null){
  if(!provider){saveJson(STORAGE,{});return;}
  const state=load();for(const id of Object.keys(state))if(id.startsWith(provider+'\n'))delete state[id];saveJson(STORAGE,state);
}

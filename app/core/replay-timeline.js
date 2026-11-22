/** Compact, seekable replay model. No timers or DOM dependencies. */
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const MAX_REPLAY_EVENTS=15000;

export function buildReplayTimeline(session){
  const source=Array.isArray(session?.events)?session.events:[];
  const events=source.filter(e=>e&&(e.type==='key'||e.type==='backspace')&&Number.isInteger(e.index)&&e.index>=0).slice(0,MAX_REPLAY_EVENTS);
  if(!events.length)return {steps:[],durationMs:0,typed:0,mistakes:0,backspaces:0,truncated:false};
  const base=Number(events[0].at)||Number(session?.startedAt)||0;
  const strict=!!session?.strictAccuracy;
  let previous=0,typed=0,mistakes=0,backspaces=0;
  // Keep unresolved mistakes in an O(1)-editable linked index. Each replay
  // step snapshots only the eight most recent visible mistakes, so seeking
  // remains instant and a Backspace/repair removes the old red marker.
  const activeErrors=new Map();let errorTail=null;
  const removeError=index=>{
    const item=activeErrors.get(index);if(!item)return;
    if(item.prev)item.prev.next=item.next;
    if(item.next)item.next.prev=item.prev;
    if(errorTail===item)errorTail=item.prev;
    activeErrors.delete(index);
  };
  const markError=index=>{
    removeError(index);
    const item={index,prev:errorTail,next:null};
    if(errorTail)errorTail.next=item;
    errorTail=item;activeErrors.set(index,item);
  };
  const steps=events.map((event,i)=>{
    const raw=Number(event.at),offset=Number.isFinite(raw)&&raw>=base?raw-base:i*140;
    const atMs=i===0?16:clamp(Math.max(previous+16,offset),0,3600000);
    previous=atMs;
    if(event.type==='backspace'){backspaces++;removeError(event.index);}
    else {typed++;if(!event.correct){mistakes++;markError(event.index);}else removeError(event.index);}
    const visibleErrors=[];
    for(let item=errorTail;item&&visibleErrors.length<8;item=item.prev)visibleErrors.push(item.index);
    const nextIndex=event.type==='backspace'?event.index:(event.correct||!strict?event.index+1:event.index);
    return {atMs,index:event.index,nextIndex,actual:event.key||'',expected:event.expected||'',
      type:event.type,correct:event.correct===true,typed,mistakes,backspaces,visibleErrors};
  });
  return {steps,durationMs:Math.max(850,steps.at(-1).atMs+450),typed,mistakes,backspaces,
    truncated:source.length>MAX_REPLAY_EVENTS};
}

/** Binary search. Every scrub/animation frame is O(log N), not O(N) timers. */
export function replayAt(timeline,elapsedMs){
  const steps=timeline?.steps||[];
  const ms=clamp(Number(elapsedMs)||0,0,Number(timeline?.durationMs)||0);
  let low=0,high=steps.length;
  while(low<high){const mid=(low+high)>>1;if(steps[mid].atMs<=ms)low=mid+1;else high=mid;}
  const last=steps[low-1]||null;
  return {elapsedMs:ms,count:low,total:steps.length,step:last,
    cursor:last?.nextIndex||0,typed:last?.typed||0,mistakes:last?.mistakes||0,backspaces:last?.backspaces||0,
    visibleErrors:last?.visibleErrors||[],
    progress:steps.length?Math.round(low/steps.length*100):0,finished:ms>=Number(timeline?.durationMs)};
}

export function formatReplayTime(ms){
  const seconds=Math.floor(Math.max(0,Number(ms)||0)/1000);
  return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;
}

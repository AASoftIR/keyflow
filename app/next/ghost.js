/** A real previous run, not an invented opponent. Each interval is clamped so
 * pauses/idle gaps never grant an impossible or frozen ghost. */
export function buildPersonalGhost(session){
  if(!session?.summary?.reliable || !session?.text || session.completionReason!=='passage')return null;
  const keys=(session.events||[]).filter(e=>e.type==='key'&&Number.isFinite(e.index));
  if(keys.length<20)return null;
  let elapsed=0,lastAt=null,index=0;
  const points=[{ms:0,index:0}];
  for(const e of keys){
    const at=Number(e.at)||0;
    if(lastAt!==null)elapsed+=Math.max(20,Math.min(2000,at-lastAt));
    lastAt=at;
    index=Math.max(index,Math.min(session.textLength||Number.MAX_SAFE_INTEGER,Math.floor(e.index)+(e.correct||!session.strictAccuracy?1:0)));
    if(points.length===1 || index>points[points.length-1].index)points.push({ms:elapsed,index});
  }
  if(points.length<10)return null;
  const duration=Number(session.summary.durationMs)||elapsed;
  const scale=elapsed>0&&duration>0?duration/elapsed:1;
  for(const p of points)p.ms=Math.round(p.ms*scale);
  return {sessionId:session.id,wpm:Number(session.summary.wpm)||0,points,total:Math.max(1,session.textLength||index),durationMs:duration};
}
export function personalGhostAt(ghost,elapsedMs){
  if(!ghost?.points?.length)return 0;
  const arr=ghost.points,t=Math.max(0,Number(elapsedMs)||0);
  let lo=0,hi=arr.length-1;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(arr[mid].ms<=t)lo=mid;else hi=mid-1;}
  if(lo===arr.length-1)return arr[lo].index;
  const a=arr[lo],b=arr[lo+1];const fraction=Math.max(0,Math.min(1,(t-a.ms)/Math.max(1,b.ms-a.ms)));
  return a.index+(b.index-a.index)*fraction;
}
export function findPersonalBest(sessions,passage){
  const best=(sessions||[]).filter(s=>s.text===passage?.text&&s.language===passage?.language&&s.summary?.reliable&&s.completionReason==='passage')
    .sort((a,b)=>(Number(b.summary.wpm)||0)-(Number(a.summary.wpm)||0))[0];
  return buildPersonalGhost(best);
}

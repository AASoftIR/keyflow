/** On-demand visual frame profiler; never runs unless the user asks for it.
 * A single lightweight RAF loop records durations without altering the app's
 * own rendering, timing rules or keyboard-event handling. */
const bounded=(n,min,max)=>Math.max(min,Math.min(max,n));

export function summarizeFrames(intervals=[]){
  const valid=intervals.filter(x=>Number.isFinite(x)&&x>=1&&x<=2000).sort((a,b)=>a-b);
  if(!valid.length)return {frames:0,averageMs:0,p95Ms:0,worstMs:0,longFrames:0,fps:0,quality:'unavailable'};
  const total=valid.reduce((sum,n)=>sum+n,0);
  const mean=total/valid.length,p95=valid[Math.min(valid.length-1,Math.ceil(valid.length*.95)-1)];
  const longFrames=valid.filter(x=>x>50).length;
  return {frames:valid.length,averageMs:Number(mean.toFixed(1)),p95Ms:Number(p95.toFixed(1)),
    worstMs:Number(valid.at(-1).toFixed(1)),longFrames,fps:Math.round(bounded(1000/mean,0,300)),
    // 30 FPS with evenly spaced frames is still visibly sluggish: mean frame
    // time counts as well as isolated p95 spikes.
    quality:p95>50||mean>50?'severe':p95>33||mean>25||longFrames>=3?'janky':'stable'};
}

export function profileFrames({durationMs=8000,signal,requestFrame=globalThis.requestAnimationFrame,
  cancelFrame=globalThis.cancelAnimationFrame,clock=()=>performance.now(),isVisible=()=>true}={}){
  if(typeof requestFrame!=='function')return Promise.resolve({...summarizeFrames([]),reason:'unsupported'});
  const duration=bounded(Number(durationMs)||8000,1500,30000);
  return new Promise(resolve=>{
    const samples=[];let handle=0,previous=0,start=0,settled=false;
    const finish=reason=>{
      if(settled)return;settled=true;
      if(handle && typeof cancelFrame==='function')cancelFrame(handle);
      signal?.removeEventListener?.('abort',onAbort);
      resolve({...summarizeFrames(samples),reason});
    };
    const onAbort=()=>finish('cancelled');
    if(signal?.aborted){finish('cancelled');return;}
    signal?.addEventListener?.('abort',onAbort,{once:true});
    const tick=timestamp=>{
      handle=0;
      if(!isVisible()){finish('hidden');return;}
      const now=Number.isFinite(timestamp)?timestamp:clock();
      if(!start)start=now;
      if(previous){const interval=now-previous;if(interval>0&&interval<2000)samples.push(interval);}
      previous=now;
      if(now-start>=duration){finish('complete');return;}
      handle=requestFrame(tick);
    };
    handle=requestFrame(tick);
  });
}

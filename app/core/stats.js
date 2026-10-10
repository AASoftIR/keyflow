const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const mean = arr => arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : 0;
const median = arr => { if(!arr.length)return 0; const a=[...arr].sort((x,y)=>x-y); const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; };
const localDateKey = value => { const d=value instanceof Date?value:new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const MAX_PLAUSIBLE_WPM=350;

function eventSpanMs(typed){
  const timed=typed.filter(e=>Number.isFinite(e.t));
  if(timed.length<2) return 0;
  const span=Math.max(0,timed.at(-1).t-timed[0].t);
  const intervals=timed.map(e=>e.interval).filter(v=>Number.isFinite(v)&&v>0&&v<5000);
  return span + (median(intervals)||0);
}

function resolveDurationMs(session,typed){
  const explicit=Number(session.activeDurationMs);
  if(Number.isFinite(explicit)&&explicit>0) return explicit;
  const span=eventSpanMs(typed);
  if(span>0) return span;
  const wall=Number(session.endedAt)-Number(session.startedAt);
  const fallback=wall-(Number(session.pausedMs)||0);
  return Number.isFinite(fallback)&&fallback>0?fallback:0;
}

function fastestBurstWpm(typed,windowSize=20){
  const timed=typed.filter(e=>Number.isFinite(e.t));
  if(timed.length<Math.min(8,windowSize)) return 0;
  let best=0;
  const n=Math.min(windowSize,timed.length);
  for(let i=0;i+n-1<timed.length;i++){
    const first=timed[i],last=timed[i+n-1];
    const ms=last.t-first.t;
    if(ms<250) continue;
    const correct=timed.slice(i,i+n).filter(e=>e.correct).length;
    best=Math.max(best,(correct/5)/(ms/60000));
  }
  return Math.min(MAX_PLAUSIBLE_WPM,best);
}

function handStats(typed){
  const leftPrefixes=new Set(['KeyQ','KeyW','KeyE','KeyR','KeyT','KeyA','KeyS','KeyD','KeyF','KeyG','KeyZ','KeyX','KeyC','KeyV','KeyB','Digit1','Digit2','Digit3','Digit4','Digit5']);
  let left=0,right=0,unknown=0;
  for(const e of typed){
    if(leftPrefixes.has(e.code)) left++;
    else if(/^Key|^Digit|Bracket|Semicolon|Quote|Comma|Period|Slash|Minus|Equal|Backslash/.test(e.code||'')) right++;
    else unknown++;
  }
  const total=left+right;
  return {left,right,unknown,balance:total?100-Math.abs(left-right)/total*100:100};
}

export function calculateSessionSummary(session) {
  const typed = (session.events||[]).filter(e => e.type === 'key');
  const correct = typed.filter(e => e.correct).length;
  const errors = typed.length - correct;
  const durationMsRaw=resolveDurationMs(session,typed);
  const durationMs=Math.max(0,durationMsRaw);
  const minutes=durationMs/60000;
  const intervals = (session.intervals||[]).filter(v => Number.isFinite(v) && v > 0 && v < 5000);
  const avg = mean(intervals);
  const med=median(intervals);
  const variance = intervals.length ? mean(intervals.map(x => (x - avg) ** 2)) : 0;
  const cv = avg ? Math.sqrt(variance) / avg : 0;
  const consistency = clamp(100 - cv * 55, 0, 100);
  const grossWpm = minutes>0 ? (typed.length / 5) / minutes : 0;
  // Net WPM follows the conventional typing-test penalty: gross WPM minus
  // remaining uncorrected errors per minute. Raw mistakes stay in accuracy.
  // This avoids penalizing the same corrected mistake twice.
  // All keystroke attempts remain in the raw speed metric.
  const unresolvedErrors=Number.isFinite(session.unresolvedErrors)?Math.max(0,Math.min(errors,session.unresolvedErrors)):errors;
  const netWpm = minutes>0 ? Math.max(0,grossWpm-(unresolvedErrors/minutes)) : 0;
  const invalidChronology=typed.some((event,i)=> i>0 && Number.isFinite(event.t) && Number.isFinite(typed[i-1].t) && event.t < typed[i-1].t);
  const timingImpossible = invalidChronology || (typed.length>=10 && (durationMs<500 || grossWpm>MAX_PLAUSIBLE_WPM));
  const reliable = !!typed.length && durationMs>0 && !timingImpossible && Number.isFinite(netWpm);
  const wpm=reliable?netWpm:0;
  const rawWpm=reliable?grossWpm:0;
  const wallMs=Math.max(0,(Number(session.endedAt)||0)-(Number(session.startedAt)||0));
  const longPauses=intervals.filter(x=>x>=1000).length;
  const hand=handStats(typed);
  const accuracy=typed.length ? correct/typed.length*100 : 100;
  const correctionRate=typed.length ? (session.backspaces||0)/typed.length*100 : 0;
  const flowScore=clamp(accuracy*.58+consistency*.32+hand.balance*.10,0,100);
  return {
    durationMs,
    wallDurationMs:wallMs,
    typed:typed.length,
    correct,
    errors,
    unresolvedErrors,
    accuracy,
    wpm,
    rawWpm,
    cpm:minutes>0?correct/minutes:0,
    consistency,
    medianIntervalMs:med,
    averageIntervalMs:avg,
    burstWpm:reliable?fastestBurstWpm(typed):0,
    longPauses,
    pauseRatio:wallMs?clamp((session.pausedMs||0)/wallMs*100,0,100):0,
    backspaces:session.backspaces||0,
    correctionRate,
    handBalance:hand.balance,
    leftKeys:hand.left,
    rightKeys:hand.right,
    flowScore,
    reliable,
    timingAnomaly:timingImpossible,
    timingSource:Number.isFinite(Number(session.activeDurationMs))&&Number(session.activeDurationMs)>0?'active-clock':eventSpanMs(typed)>0?'event-span':'wall-clock'
  };
}

export function aggregateSessions(sessions, language=null) {
  const filtered = language ? sessions.filter(s => s.language === language) : sessions;
  if (!filtered.length) return emptyAggregate(language);
  let totalDuration=0,totalTyped=0,totalCorrect=0,totalErrors=0,totalBackspaces=0;
  const wpms=[],bursts=[],flows=[],medians=[],inputDelayP95s=[],consistencies=[],handBalances=[];
  let anomalies=0,longPauses=0;
  const keyStats=new Map(),pairStats=new Map(),daily=new Map();

  for(const s of filtered){
    const sum=s.summary?.reliable!==undefined?s.summary:calculateSessionSummary(s);
    totalDuration+=sum.durationMs||0; totalTyped+=sum.typed||0; totalCorrect+=sum.correct||0; totalErrors+=sum.errors||0; totalBackspaces+=sum.backspaces||0;
    if(sum.reliable){ if(Number.isFinite(sum.wpm))wpms.push(sum.wpm); if(Number.isFinite(sum.burstWpm))bursts.push(sum.burstWpm); }
    else anomalies++;
    if(Number.isFinite(sum.flowScore))flows.push(sum.flowScore);
    if(Number.isFinite(sum.medianIntervalMs)&&sum.medianIntervalMs>0)medians.push(sum.medianIntervalMs);
    if(Number.isFinite(sum.handBalance))handBalances.push(sum.handBalance);
    longPauses+=sum.longPauses||0;
    if(Number.isFinite(sum.consistency))consistencies.push(sum.consistency);
    if(Number.isFinite(s.inputDelay?.p95))inputDelayP95s.push(s.inputDelay.p95);
    const date=localDateKey(s.startedAt);
    const d=daily.get(date)||{date,minutes:0,chars:0,correct:0,sessions:0,wpmSum:0,wpmSessions:0};
    d.minutes+=(sum.durationMs||0)/60000; d.chars+=sum.typed||0; d.correct+=sum.correct||0; d.sessions+=1;
    if(sum.reliable){d.wpmSum+=sum.wpm||0;d.wpmSessions+=1;} daily.set(date,d);

    for(const [ch,stat] of Object.entries(s.keyStats||{})){
      const x=keyStats.get(ch)||{char:ch,hits:0,errors:0,latencyTotal:0,latencyCount:0};
      x.hits+=stat.hits||0;x.errors+=stat.errors||0;x.latencyTotal+=stat.latencyTotal||0;x.latencyCount+=stat.latencyCount||0;keyStats.set(ch,x);
    }
    for(const [pair,stat] of Object.entries(s.pairStats||{})){
      const x=pairStats.get(pair)||{pair,hits:0,errors:0,latencyTotal:0,latencyCount:0};
      x.hits+=stat.hits||0;x.errors+=stat.errors||0;x.latencyTotal+=stat.latencyTotal||0;x.latencyCount+=stat.latencyCount||0;pairStats.set(pair,x);
    }
  }

  const days=[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(d=>({...d,wpm:d.wpmSessions?d.wpmSum/d.wpmSessions:0}));
  const weakKeys=[...keyStats.values()].map(x=>({...x,errorRate:x.hits?x.errors/x.hits*100:0,avgLatency:x.latencyCount?x.latencyTotal/x.latencyCount:0,score:(x.hits?x.errors/x.hits*100:0)*1.6+(x.latencyCount?x.latencyTotal/x.latencyCount/20:0)})).sort((a,b)=>b.score-a.score);
  const weakPairs=[...pairStats.values()].map(x=>({...x,errorRate:x.hits?x.errors/x.hits*100:0,avgLatency:x.latencyCount?x.latencyTotal/x.latencyCount:0,score:(x.hits?x.errors/x.hits*120:0)+(x.latencyCount?x.latencyTotal/x.latencyCount:0)})).sort((a,b)=>b.score-a.score);
  const recent5=wpms.slice(-5),previous5=wpms.slice(-10,-5),recentAverageWpm=mean(recent5),previousAverageWpm=mean(previous5);
  return {
    language,sessions:filtered.length,reliableSessions:wpms.length,anomalousSessions:anomalies,totalDuration,totalTyped,
    accuracy:totalTyped?totalCorrect/totalTyped*100:100,errors:totalErrors,errorsPer1000:totalTyped?totalErrors/totalTyped*1000:0,
    backspaces:totalBackspaces,correctionRate:totalTyped?totalBackspaces/totalTyped*100:0,averageWpm:mean(wpms),medianWpm:median(wpms),recentAverageWpm,
    trendWpm:previous5.length?recentAverageWpm-previousAverageWpm:0,bestWpm:Math.max(0,...wpms),averageBurstWpm:mean(bursts),averageFlowScore:mean(flows),
    averageConsistency:mean(consistencies),medianIntervalMs:median(medians),handBalance:mean(handBalances)||100,longPauses,inputDelayP95:mean(inputDelayP95s),
    reliabilityRate:filtered.length?wpms.length/filtered.length*100:100,daily:days,weakKeys,weakPairs,streak:calculateStreak(days.map(d=>d.date))
  };
}

export function calculateStreak(dateStrings, now=new Date()) {
  const dates=new Set(dateStrings);let cursor=new Date(now.getFullYear(),now.getMonth(),now.getDate());const today=localDateKey(cursor);
  if(!dates.has(today)){cursor.setDate(cursor.getDate()-1);if(!dates.has(localDateKey(cursor)))return 0;}
  let streak=0;while(dates.has(localDateKey(cursor))){streak+=1;cursor.setDate(cursor.getDate()-1);}return streak;
}

export function fatigueCurve(session) {
  const ev=(session.events||[]).filter(e=>e.type==='key'&&Number.isFinite(e.interval)&&e.interval>0&&e.interval<5000);
  if(ev.length<9)return[];const third=Math.ceil(ev.length/3);
  return ['start','middle','end'].map((label,i)=>{const slice=ev.slice(i*third,(i+1)*third),avgMs=mean(slice.map(e=>e.interval));return{label,avgMs,wpm:avgMs?12000/avgMs:0};});
}

export function buildAdaptiveText(aggregate,language='en',length=520) {
  const weakChars=aggregate.weakKeys.slice(0,8).map(x=>x.char).filter(Boolean),weakPairs=aggregate.weakPairs.slice(0,8).map(x=>x.pair).filter(Boolean);
  if(language==='fa'){
    const seed=weakPairs.length?weakPairs.join('، '):weakChars.join('، ');
    const variants=[
      `این تمرین برای تقویت ریتم و دقت ساخته شده است. روی ${seed||'کلیدهای اصلی'} با آرامش تمرکز کن و سرعت را فقط وقتی بالا ببر که حرکت دست پایدار بماند.`,
      `هر واژه را کامل ببین، فشار کلید را سبک نگه دار و پس از هر حرکت انگشت را به جای طبیعی خودش برگردان. هدف این بخش تکرار کور نیست، بلکه ساختن حرکت قابل اعتماد است.`,
      `اگر خطایی رخ داد، ریتم را به هم نریز. همان الگوی دشوار را آگاهانه تکرار کن و اجازه بده دقت، سرعت بعدی را بسازد.`
    ];
    let out='';let i=0;while(out.length<length){out+=(out?' ':'')+variants[i++%variants.length];}return out.slice(0,length).trim();
  }
  const seed=weakPairs.length?weakPairs.join(', '):weakChars.join(', ');
  const variants=[
    `This adaptive drill targets ${seed||'your current weak keys'}. Keep the rhythm steady and increase speed only after the movement stays clean.`,
    `Read the whole word before chasing the next letter. Keep each press light, return each finger naturally, and treat a mistake as useful movement data rather than a reason to rush.`,
    `If one transition keeps failing, slow that pair down for a few repetitions and then place it back inside normal sentences. Reliable motion should come before peak speed.`
  ];
  let out='';let i=0;while(out.length<length){out+=(out?' ':'')+variants[i++%variants.length];}return out.slice(0,length).trim();
}

function emptyAggregate(language){return{language,sessions:0,reliableSessions:0,anomalousSessions:0,totalDuration:0,totalTyped:0,accuracy:100,errors:0,errorsPer1000:0,backspaces:0,correctionRate:0,averageWpm:0,medianWpm:0,recentAverageWpm:0,trendWpm:0,bestWpm:0,averageBurstWpm:0,averageFlowScore:0,averageConsistency:0,medianIntervalMs:0,handBalance:100,longPauses:0,inputDelayP95:0,reliabilityRate:100,daily:[],weakKeys:[],weakPairs:[],streak:0};}

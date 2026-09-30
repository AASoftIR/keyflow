const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const mean = arr => arr.length ? arr.reduce((a,b)=>a+b,0) / arr.length : 0;
const localDateKey = value => { const d=value instanceof Date?value:new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

export function calculateSessionSummary(session) {
  const durationMs = Math.max(1, session.endedAt - session.startedAt - (session.pausedMs || 0));
  const minutes = durationMs / 60000;
  const typed = session.events.filter(e => e.type === 'key');
  const correct = typed.filter(e => e.correct).length;
  const errors = typed.length - correct;
  const intervals = session.intervals.filter(v => Number.isFinite(v) && v > 0 && v < 5000);
  const avg = mean(intervals);
  const variance = intervals.length ? mean(intervals.map(x => (x - avg) ** 2)) : 0;
  const cv = avg ? Math.sqrt(variance) / avg : 0;
  const consistency = clamp(100 - cv * 55, 0, 100);
  const rawWpm = (typed.length / 5) / minutes;
  const wpm = Math.max(0, rawWpm - (errors / minutes));
  return {
    durationMs,
    typed: typed.length,
    correct,
    errors,
    accuracy: typed.length ? correct / typed.length * 100 : 100,
    wpm,
    rawWpm,
    cpm: correct / minutes,
    consistency,
    backspaces: session.backspaces || 0,
    correctionRate: typed.length ? (session.backspaces || 0) / typed.length * 100 : 0
  };
}

export function aggregateSessions(sessions, language=null) {
  const filtered = language ? sessions.filter(s => s.language === language) : sessions;
  if (!filtered.length) return emptyAggregate(language);
  let totalDuration = 0, totalTyped = 0, totalCorrect = 0, totalErrors = 0, totalBackspaces = 0;
  const wpms = [];
  const inputDelayP95s=[];
  const consistencies=[];
  const keyStats = new Map();
  const pairStats = new Map();
  const daily = new Map();

  for (const s of filtered) {
    const sum = s.summary || calculateSessionSummary(s);
    totalDuration += sum.durationMs;
    totalTyped += sum.typed;
    totalCorrect += sum.correct;
    totalErrors += sum.errors;
    totalBackspaces += sum.backspaces || 0;
    if (Number.isFinite(sum.wpm)) wpms.push(sum.wpm);
    if (Number.isFinite(sum.consistency)) consistencies.push(sum.consistency);
    if (Number.isFinite(s.inputDelay?.p95)) inputDelayP95s.push(s.inputDelay.p95);
    const date = localDateKey(s.startedAt);
    const d = daily.get(date) || {date, minutes:0, chars:0, correct:0, sessions:0, wpmSum:0};
    d.minutes += sum.durationMs / 60000;
    d.chars += sum.typed;
    d.correct += sum.correct;
    d.sessions += 1;
    d.wpmSum += sum.wpm;
    daily.set(date,d);

    for (const [ch, stat] of Object.entries(s.keyStats || {})) {
      const x = keyStats.get(ch) || {char:ch, hits:0, errors:0, latencyTotal:0, latencyCount:0};
      x.hits += stat.hits || 0; x.errors += stat.errors || 0;
      x.latencyTotal += stat.latencyTotal || 0; x.latencyCount += stat.latencyCount || 0;
      keyStats.set(ch,x);
    }
    for (const [pair, stat] of Object.entries(s.pairStats || {})) {
      const x = pairStats.get(pair) || {pair, hits:0, errors:0, latencyTotal:0, latencyCount:0};
      x.hits += stat.hits || 0; x.errors += stat.errors || 0;
      x.latencyTotal += stat.latencyTotal || 0; x.latencyCount += stat.latencyCount || 0;
      pairStats.set(pair,x);
    }
  }

  const days = [...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(d => ({...d,wpm:d.sessions ? d.wpmSum/d.sessions : 0}));
  const weakKeys = [...keyStats.values()].map(x => ({
    ...x,
    errorRate: x.hits ? x.errors / x.hits * 100 : 0,
    avgLatency: x.latencyCount ? x.latencyTotal / x.latencyCount : 0,
    score: (x.hits ? x.errors / x.hits * 100 : 0) * 1.6 + (x.latencyCount ? x.latencyTotal/x.latencyCount/20 : 0)
  })).sort((a,b)=>b.score-a.score);
  const weakPairs = [...pairStats.values()].map(x => ({
    ...x,
    errorRate:x.hits ? x.errors/x.hits*100 : 0,
    avgLatency:x.latencyCount ? x.latencyTotal/x.latencyCount : 0,
    score:(x.hits ? x.errors/x.hits*120 : 0) + (x.latencyCount ? x.latencyTotal/x.latencyCount : 0)
  })).sort((a,b)=>b.score-a.score);

  const recent5=wpms.slice(-5);
  const previous5=wpms.slice(-10,-5);
  const recentAverageWpm=mean(recent5);
  const previousAverageWpm=mean(previous5);
  return {
    language,
    sessions:filtered.length,
    totalDuration,
    totalTyped,
    accuracy:totalTyped ? totalCorrect/totalTyped*100 : 100,
    errors:totalErrors,
    errorsPer1000:totalTyped ? totalErrors/totalTyped*1000 : 0,
    backspaces:totalBackspaces,
    correctionRate:totalTyped ? totalBackspaces/totalTyped*100 : 0,
    averageWpm:mean(wpms),
    recentAverageWpm,
    trendWpm:previous5.length ? recentAverageWpm-previousAverageWpm : 0,
    bestWpm:Math.max(0,...wpms),
    averageConsistency:mean(consistencies),
    inputDelayP95:mean(inputDelayP95s),
    daily:days,
    weakKeys,
    weakPairs,
    streak:calculateStreak(days.map(d=>d.date))
  };
}

export function calculateStreak(dateStrings, now=new Date()) {
  const dates = new Set(dateStrings);
  let cursor = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const today = localDateKey(cursor);
  if (!dates.has(today)) {
    cursor.setDate(cursor.getDate()-1);
    if (!dates.has(localDateKey(cursor))) return 0;
  }
  let streak=0;
  while (dates.has(localDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate()-1);
  }
  return streak;
}

export function fatigueCurve(session) {
  const ev = (session.events || []).filter(e=>e.type==='key' && Number.isFinite(e.interval) && e.interval>0 && e.interval<5000);
  if (ev.length < 9) return [];
  const third = Math.ceil(ev.length/3);
  return ['start','middle','end'].map((label,i)=>{
    const slice=ev.slice(i*third,(i+1)*third);
    const avgMs=mean(slice.map(e=>e.interval));
    return {label,avgMs,wpm:avgMs ? 12000/avgMs : 0};
  });
}

export function buildAdaptiveText(aggregate, language='en', length=280) {
  const weakChars = aggregate.weakKeys.slice(0,8).map(x=>x.char).filter(Boolean);
  const weakPairs = aggregate.weakPairs.slice(0,8).map(x=>x.pair).filter(Boolean);
  if (language === 'fa') {
    const seed = weakPairs.length ? weakPairs.join('، ') : weakChars.join('، ');
    const base = `تمرین هدفمند برای ریتم و دقت ساخته شده است. روی ${seed || 'کلیدهای اصلی'} با آرامش تمرکز کن و سرعت را فقط وقتی بالا ببر که ضرباهنگ ثابت بماند. هر واژه را کامل ببین، سپس دست‌ها را سبک نگه دار و بدون عجله ادامه بده. `;
    return base.repeat(Math.ceil(length/base.length)).slice(0,length).trim();
  }
  const seed = weakPairs.length ? weakPairs.join(', ') : weakChars.join(', ');
  const base = `This adaptive drill targets ${seed || 'your current weak keys'}. Keep a steady rhythm, finish each word cleanly, and increase speed only after accuracy stays stable. Relax your hands and let each keystroke land deliberately. `;
  return base.repeat(Math.ceil(length/base.length)).slice(0,length).trim();
}

function emptyAggregate(language) {
  return {language,sessions:0,totalDuration:0,totalTyped:0,accuracy:100,errors:0,errorsPer1000:0,backspaces:0,correctionRate:0,averageWpm:0,recentAverageWpm:0,trendWpm:0,bestWpm:0,averageConsistency:0,inputDelayP95:0,daily:[],weakKeys:[],weakPairs:[],streak:0};
}

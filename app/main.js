import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { BUILTIN_TEXTS, TOPICS } from './data/builtin-texts.js';
import { loadSettings, saveSettings, getSessions, getRecentSessions, saveSession, getCustomTexts, saveText, deleteText, loadProviderConfig, saveProviderConfig, clearProviderKey } from './core/storage.js';
import { sanitizePracticeText, cleanImportedText, normalizeForComparison, graphemes } from './core/normalization.js';
import { KeyboardMapper, LAYOUTS, formatChord, fingerForCode } from './core/layouts.js';
import { TypingEngine } from './core/typing-engine.js';
import { aggregateSessions, buildAdaptiveText, fatigueCurve } from './core/stats.js';
import { pickFreshText } from './core/shuffle-bag.js';
import { validatePracticeContent } from './core/content-validator.js';
import { PROVIDERS, listProviderModels, pickRecommendedModel } from './ai/providers.js';
import { generatePracticeText } from './ai/generator.js';
import { warmAudioLater, applyAudioSettings, playFeedback, testAudio, getAudioStatus, primeAudioFromGesture } from './audio/audio.js';
import { KeyboardView } from './ui/keyboard.js';
import { drawLineChart, drawBars } from './ui/charts.js';

let settings=loadSettings();
let route='practice';
let cleanup=()=>{};
let practiceState={level:3,mode:'text',currentText:null};
let progressFilter=settings.language;
let generatedDraft=null;
let calibrationTimer=0;
let runtimeInfo={rendererMode:'browser',appliedEnv:[],distro:'',desktop:'',session:'',gpuVendors:[],startupLog:'',mediaFrameworkBundled:false,gstreamerReady:false,gstreamerPluginPath:'',gstreamerScanner:''};
const view=document.querySelector('#view');
const contextLabel=document.querySelector('#window-context');
const modalLayer=document.querySelector('#modal-layer');
const toastLayer=document.querySelector('#toast-layer');

const esc=value=>String(value??'').replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const fmt1=n=>Number.isFinite(Number(n))?Number(n).toFixed(1):'0.0';
const minutesLabel=ms=>{const m=Math.round((ms||0)/60000);return m>=60?`${Math.floor(m/60)}h ${m%60}m`:`${m}m`;};
const localDateKey=value=>{const d=value instanceof Date?value:new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
const langName=lang=>lang==='fa'?'فارسی':'English';
const currentLayoutId=lang=>lang==='fa'?settings.persianLayout:settings.englishLayout;
const currentCalibration=lang=>settings.calibration[currentLayoutId(lang)] ||= {};

function toast(message,type='normal',timeout=2800){
  const el=document.createElement('div');el.className=`toast ${type==='error'?'bad':type==='success'?'good':''}`;el.textContent=message;toastLayer.append(el);
  setTimeout(()=>el.remove(),timeout);
}
function closeModal(){modalLayer.replaceChildren();}
function openModal(html,onReady){
  modalLayer.innerHTML=`<div class="modal-backdrop"><div class="modal">${html}</div></div>`;
  modalLayer.querySelector('.modal-backdrop').addEventListener('mousedown',e=>{if(e.target===e.currentTarget)closeModal();});
  onReady?.(modalLayer.querySelector('.modal'));
}
function persistSettings(){saveSettings(settings);applyAppearance();}
function scheduleCalibrationSave(){clearTimeout(calibrationTimer);calibrationTimer=setTimeout(()=>saveSettings(settings),900);}
function applyAppearance(){
  document.body.classList.toggle('focus-mode',!!settings.focusMode);
  document.body.classList.toggle('perf-ultra',settings.performanceMode==='ultra');
  document.body.classList.toggle('renderer-safe',String(runtimeInfo.rendererMode||'').includes('safe'));
  document.documentElement.style.setProperty('--motion',settings.reduceMotion?'0':'1');
  document.querySelector('#language-quick').textContent=settings.language==='fa'?'فا':'EN';
}
function layoutMapper(lang){
  const profileId=currentLayoutId(lang);
  return new KeyboardMapper({profileId,calibration:currentCalibration(lang),onLearn:(ch,record)=>{
    if(ch&&record) settings.calibration[profileId][ch]=record;
    scheduleCalibrationSave();
  }});
}

async function loadRuntimeInfo(){
  if(!window.__TAURI_INTERNALS__) return;
  try{ runtimeInfo=await invoke('runtime_info'); }catch(error){ console.warn('Runtime diagnostics unavailable:',error); }
  applyAppearance();
}

async function setupWindowButtons(){
  if(!window.__TAURI_INTERNALS__) {
    document.querySelector('.window-actions').style.opacity='.35';
    document.querySelectorAll('[data-resize]').forEach(el=>el.style.display='none');
    return;
  }
  const win=getCurrentWindow();
  document.querySelector('#win-min').onclick=()=>win.minimize();
  document.querySelector('#win-max').onclick=()=>win.toggleMaximize();
  document.querySelector('#win-close').onclick=()=>win.close();

  // data-tauri-drag-region remains as the native fast path, but this explicit
  // fallback makes moving the undecorated window reliable across Linux WMs.
  const titlebar=document.querySelector('.titlebar');
  titlebar.addEventListener('mousedown',e=>{
    if(e.button!==0 || e.target.closest('button,input,select,textarea,a')) return;
    if(e.detail===2){ win.toggleMaximize().catch(()=>{}); return; }
    win.startDragging().catch(()=>{});
  });

  // Without OS decorations some Linux compositors expose no native border to
  // grab. Eight tiny hit-zones call Tauri's supported resize-drag API instead.
  document.querySelectorAll('[data-resize]').forEach(grip=>{
    grip.addEventListener('mousedown',e=>{
      if(e.button!==0) return;
      e.preventDefault();
      e.stopPropagation();
      win.startResizeDragging(grip.dataset.resize).catch(()=>{});
    });
  });
}

async function routeTo(next,opts={}){
  cleanup?.(); cleanup=()=>{};
  route=next;
  document.querySelectorAll('[data-route]').forEach(b=>b.classList.toggle('active',b.dataset.route===next));
  const labels={practice:'Practice',progress:'Progress',library:'Text library',ai:'AI studio',lab:'Training lab',settings:'Settings'};
  contextLabel.textContent=labels[next]||next;
  view.scrollTop=0;
  if(next==='practice') cleanup=await renderPractice(opts) || (()=>{});
  else if(next==='progress') cleanup=await renderProgress() || (()=>{});
  else if(next==='library') cleanup=await renderLibrary() || (()=>{});
  else if(next==='ai') cleanup=await renderAi() || (()=>{});
  else if(next==='lab') cleanup=await renderLab() || (()=>{});
  else cleanup=await renderSettings() || (()=>{});
  view.focus({preventScroll:true});
}

async function selectPracticeText({language=settings.language,level=practiceState.level,mode=practiceState.mode}={}){
  const custom=await getCustomTexts();
  const pool=[...BUILTIN_TEXTS,...custom];
  if(mode==='weak'){
    const aggregate=aggregateSessions(await getRecentSessions({language,limit:240}),language);
    return {id:`adaptive-${Date.now()}`,language,level,title:language==='fa'?'تمرین تطبیقی ضعف ها':'Adaptive weakness drill',source:'adaptive',tags:['adaptive'],text:buildAdaptiveText(aggregate,language,360)};
  }
  if(mode==='rhythm'){
    const aggregate=aggregateSessions(await getRecentSessions({language,limit:240}),language);
    return makeRhythmText(aggregate,language,level);
  }
  if(mode==='punctuation'){
    const matches=pool.filter(t=>t.language===language && t.tags?.some(tag=>String(tag).toLowerCase().includes(language==='fa'?'نشانه':'punctuation')));
    if(matches.length) return matches[Math.floor(Math.random()*matches.length)];
  }
  if(mode==='numbers'){
    const matches=pool.filter(t=>t.language===language && t.tags?.some(tag=>String(tag).toLowerCase().includes(language==='fa'?'اعداد':'numbers')));
    if(matches.length) return matches[Math.floor(Math.random()*matches.length)];
  }
  return pickFreshText(pool,{language,level,recentWindow:settings.recentWindow}) || pickFreshText(pool,{language,recentWindow:settings.recentWindow}) || pool.find(t=>t.language===language);
}

function makeRhythmText(aggregate,language,level){
  const weak=aggregate.weakPairs.slice(0,5).map(x=>x.pair).filter(Boolean);
  if(language==='fa'){
    const core=weak.length?weak.join('، '):'تا، را، من، که، در';
    return {id:`rhythm-${Date.now()}`,language,level,title:'ریتم و گذار',source:'adaptive',tags:['rhythm'],text:`${core}. ریتم را ثابت نگه دار و بین واژه ها مکث اضافه نکن. ${core}. هر حرکت را سبک و کوتاه انجام بده و پس از هر کلید انگشت را به جای طبیعی خود برگردان. ${core}.`};
  }
  const core=weak.length?weak.join(', '):'th, he, in, er, an';
  return {id:`rhythm-${Date.now()}`,language,level,title:'Rhythm transitions',source:'adaptive',tags:['rhythm'],text:`${core}. Keep the beat even and do not rush the spaces. ${core}. Make every movement light, short, and repeatable. Let each finger return naturally before the next transition. ${core}.`};
}

function recommendPracticeLevel(aggregate,current,target){
  if(!aggregate || aggregate.sessions<3) return current;
  if(aggregate.accuracy>=96 && aggregate.averageConsistency>=76 && aggregate.recentAverageWpm>=target*.72) return Math.min(5,current+1);
  if(aggregate.accuracy<89 || aggregate.averageConsistency<52) return Math.max(1,current-1);
  return current;
}

function makeRecoveryText(session){
  const aggregate=aggregateSessions([session],session.language);
  return {
    id:`recovery-${session.id}`,
    language:session.language,
    level:practiceState.level,
    title:session.language==='fa'?'مرور خطاهای همین تمرین':'Retry this session’s weak moves',
    source:'recovery',
    tags:['recovery','adaptive'],
    text:buildAdaptiveText(aggregate,session.language,300)
  };
}

function coachRecommendation(aggregate,target){
  if(!aggregate.sessions) return {title:'Build a baseline',text:'Complete two or three normal sessions first. Keyflow will then choose drills from your real errors and timing.',action:'Start baseline',mode:'text'};
  if(aggregate.inputDelayP95>35) return {title:'Fix responsiveness first',text:`Your recent UI input p95 is about ${Math.round(aggregate.inputDelayP95)} ms. Use Ultra latency mode and the renderer diagnostics before judging finger speed.`,action:'Open settings',route:'settings'};
  if(aggregate.accuracy<92) return {title:'Accuracy block',text:'Speed is currently less important than clean keystrokes. Use strict mode or an adaptive weakness drill for one short session.',action:'Train weak keys',mode:'weak'};
  if(aggregate.averageConsistency<70) return {title:'Rhythm block',text:'Your accuracy is usable, but timing varies. A rhythm session should improve movement transitions more than another random story.',action:'Start rhythm',mode:'rhythm'};
  if(aggregate.weakPairs[0]?.errorRate>8) return {title:'Transition block',text:`The pair “${aggregate.weakPairs[0].pair}” is a stronger signal than a single weak letter. Train transitions next.`,action:'Train transitions',mode:'weak'};
  if(aggregate.recentAverageWpm<target*.85) return {title:'Controlled speed block',text:'Accuracy and rhythm are stable enough to push pace. Stay near your target without sacrificing clean input.',action:'Practice pace',mode:'text'};
  return {title:'Raise difficulty',text:'Recent speed, accuracy, and consistency are healthy. Move up one content level or choose punctuation/numbers for a harder motor pattern.',action:'New harder text',mode:'text',harder:true};
}

async function renderPractice(opts={}){
  if(opts.text){practiceState.currentText=opts.text;settings.language=opts.text.language||settings.language;persistSettings();}
  if(opts.mode) practiceState.mode=opts.mode;
  if(!practiceState.currentText || practiceState.currentText.language!==settings.language || opts.fresh){practiceState.currentText=await selectPracticeText();}
  const original=practiceState.currentText;
  const text={...original,text:sanitizePracticeText(original.text,{language:settings.language,allowDiacritics:settings.allowPersianDiacritics})};
  const mapper=layoutMapper(settings.language);
  const validation=validatePracticeContent(text.text,{language:settings.language,layoutId:currentLayoutId(settings.language),calibration:currentCalibration(settings.language),allowDiacritics:settings.allowPersianDiacritics,minLength:20});
  const dir=settings.language==='fa'?'rtl':'ltr';
  const targetWpm=settings.language==='fa'?settings.persianTargetWpm:settings.englishTargetWpm;
  const recentPracticeSessions=settings.showWeakKeyHeatmap!==false ? await getRecentSessions({language:settings.language,limit:180}) : [];
  const practiceAggregate=aggregateSessions(recentPracticeSessions,settings.language);
  view.innerHTML=`<div class="practice-wrap">
    <div class="practice-toolbar panel">
      <div class="segmented"><button data-lang="en" class="${settings.language==='en'?'active':''}">EN</button><button data-lang="fa" class="${settings.language==='fa'?'active':''}">فا</button></div>
      <span class="toolbar-sep"></span>
      <label class="tiny dim">MODE</label><select id="practice-mode" class="select"><option value="text">Text</option><option value="weak">Weak-key drill</option><option value="rhythm">Rhythm lab</option><option value="punctuation">Punctuation</option><option value="numbers">Numbers & symbols</option></select>
      <label class="tiny dim">LEVEL</label><select id="practice-level" class="select">${[1,2,3,4,5].map(x=>`<option value="${x}">${x}</option>`).join('')}</select>
      <div class="spacer"></div>
      <button id="accuracy-lock" class="btn ghost small-btn" title="Do not advance after a wrong key">Accuracy lock ${settings.strictAccuracy?'ON':'OFF'}</button>
      <button id="focus-toggle" class="btn ghost small-btn">${settings.focusMode?'Exit focus':'Focus'}</button>
      <button id="retry-text" class="btn ghost small-btn">Retry</button>
      <button id="new-text" class="btn primary">New text</button>
    </div>
    <section class="metrics">
      <div class="metric"><strong id="m-wpm">0</strong><span>WPM</span></div>
      <div class="metric"><strong id="m-acc">100%</strong><span>Accuracy</span></div>
      <div class="metric"><strong id="m-cons">100%</strong><span>Consistency</span></div>
      <div class="metric"><strong id="m-errors">0</strong><span>Errors</span></div>
      <div class="metric"><strong id="m-latency">0 ms</strong><span>input p95</span></div>
      <div class="metric"><strong id="m-target">warm-up</strong><span>vs target ${targetWpm}</span></div>
      <div class="metric"><strong id="m-time">00:00</strong><span>elapsed</span></div>
    </section>
    <section class="typing-card panel" id="typing-card">
      <div class="typing-meta"><span>${esc(text.title)} · ${esc(text.source||'builtin')} · level ${esc(text.level||practiceState.level)}</span><span>${langName(settings.language)} · ${esc(LAYOUTS[currentLayoutId(settings.language)]?.label||'layout')}</span></div>
      ${!validation.ok?`<div class="inline-error" style="margin-bottom:14px">Content health ${validation.health}/100 — ${esc(validation.issues.join(' '))}</div>`:''}
      <div class="practice-coach-row">
        <span class="coach-chip">Finger <strong id="next-finger">—</strong></span>
        <span class="coach-chip">Clean streak <strong id="clean-streak">0</strong></span>
        <span class="coach-chip ${settings.language==='fa'?'good':''}">Renderer <strong>${settings.language==='fa'?'Persian safe':'standard'}</strong></span>
        <span id="audio-runtime" class="coach-chip audio-runtime">Cuelume <strong>${getAudioStatus().state}</strong></span>
      </div>
      <div id="typing-text" class="typing-text ${settings.language==='fa'?'rtl':''}" dir="${dir}"></div>
      <div class="typing-progress-track ${settings.language==='fa'?'rtl':''}" aria-hidden="true"><i id="typing-progress-fill"></i></div>
      <div class="typing-bottom">
        <div class="legend"><span><i style="background:var(--good)"></i>correct</span><span><i style="background:var(--accent)"></i>current</span><span><i style="background:var(--bad)"></i>mistake</span><button id="audio-coach" class="audio-coach ${settings.soundEnabled?'on':''}" title="Click to hear the coaching cues"><span class="dot"></span><strong>Audio coach ${settings.soundEnabled?'ON':'OFF'}</strong><span>${settings.soundEnabled?(settings.keySounds?'key · word · error':'word · error'):'click to enable'}</span></button></div>
        <div class="typing-hint"><span class="tiny dim">NEXT</span><span id="next-char" class="next-char">—</span><strong id="next-chord">—</strong><span id="hint-source" class="hint-source"></span></div>
      </div>
    </section>
    <section class="keyboard-panel panel">
      <div class="key-summary"><span>Physical key hint uses <strong>KeyboardEvent.code</strong></span><span id="mapping-status">Profile + self-learning</span><span>${settings.showWeakKeyHeatmap!==false?'weak-key heatmap on · ':''}special marks: ${settings.allowPersianDiacritics?'enabled':'filtered'}</span></div>
      <div id="keyboard" class="keyboard"></div>
    </section>
  </div>`;
  document.querySelector('#practice-mode').value=practiceState.mode;
  document.querySelector('#practice-level').value=String(practiceState.level);
  const keyboard=new KeyboardView(document.querySelector('#keyboard'),mapper);
  if(settings.showWeakKeyHeatmap!==false) keyboard.setHeatmap(practiceAggregate.weakKeys);
  const engine=new TypingEngine({language:settings.language,strictAccuracy:settings.strictAccuracy,mapper,onFeedback:playFeedback});
  const textEl=document.querySelector('#typing-text');
  engine.mount(textEl);
  engine.setText(text.text,text);
  const ui={
    nextChar:document.querySelector('#next-char'),nextChord:document.querySelector('#next-chord'),hintSource:document.querySelector('#hint-source'),
    wpm:document.querySelector('#m-wpm'),acc:document.querySelector('#m-acc'),cons:document.querySelector('#m-cons'),errors:document.querySelector('#m-errors'),
    latency:document.querySelector('#m-latency'),time:document.querySelector('#m-time'),target:document.querySelector('#m-target'),
    finger:document.querySelector('#next-finger'),streak:document.querySelector('#clean-streak'),audioRuntime:document.querySelector('#audio-runtime'),
    progressFill:document.querySelector('#typing-progress-fill')
  };
  const updateHint=(char,hint)=>{
    ui.nextChar.textContent=char===' '?'␠':char||'✓';
    ui.nextChord.textContent=hint?formatChord(hint):char?'Learn / calibrate':'Complete';
    ui.hintSource.textContent=hint?.confidence==='learned'?'learned from this keyboard':hint?'layout profile':'no mapping';
    ui.finger.textContent=hint?.code?fingerForCode(hint.code):'—';
    keyboard.highlight(hint);
  };
  updateHint(engine.chars[0],mapper.hintFor(engine.chars[0],settings.language));
  let hintRaf=0,lastHint=null;
  const onNext=e=>{lastHint=e.detail;if(hintRaf)return;hintRaf=requestAnimationFrame(()=>{hintRaf=0;if(lastHint)updateHint(lastHint.character,lastHint.hint);});};
  const onProgress=e=>{
    const d=e.detail;ui.wpm.textContent=Math.round(d.wpm);ui.acc.textContent=`${Math.round(d.accuracy)}%`;ui.errors.textContent=d.errors;ui.cons.textContent=`${Math.round(d.consistency)}%`;ui.streak.textContent=String(d.currentStreak||0);
    if(ui.progressFill) ui.progressFill.style.transform=`scaleX(${d.total?Math.min(1,d.index/d.total):0})`;
    ui.latency.textContent=`${d.inputDelayP95<1?d.inputDelayP95.toFixed(1):Math.round(d.inputDelayP95)} ms`;
    const sec=Math.floor(d.elapsed/1000);ui.time.textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
    const delta=d.wpm-targetWpm;ui.target.textContent=d.index<8?'warm-up':`${delta>=0?'+':''}${Math.round(delta)} WPM`;ui.target.className=delta>=0?'positive':'negative';
  };
  const updateAudioRuntime=()=>{
    const status=getAudioStatus();
    if(!ui.audioRuntime) return;
    ui.audioRuntime.classList.toggle('running',status.state==='running');
    ui.audioRuntime.classList.toggle('failed',!!status.lastError);
    ui.audioRuntime.innerHTML=`Cuelume <strong>${esc(status.lastError?'failed':status.state)}</strong> · ${esc(status.theme)} · media ${runtimeInfo.gstreamerReady?'ready':(runtimeInfo.mediaFrameworkBundled?'incomplete':'unbundled')}`;
  };
  const onAudioStatus=()=>updateAudioRuntime();
  window.addEventListener('keyflow-audio-status',onAudioStatus);
  updateAudioRuntime();
  const onFinish=async e=>{
    const s=e.detail;await saveSession(s);practiceState.currentText=null;
    const recentLang=await getRecentSessions({language:s.language,limit:5000});
    const previousBest=Math.max(0,...recentLang.filter(x=>x.id!==s.id).map(x=>Number(x.summary?.wpm)||0));
    const isPersonalBest=s.summary.wpm>previousBest+.49;
    let levelNote='';
    if(settings.autoLevel!==false){
      const recentAgg=aggregateSessions(recentLang.slice(-5),s.language);
      const before=practiceState.level;
      const next=recommendPracticeLevel(recentAgg,before,targetWpm);
      practiceState.level=next;
      if(next!==before) levelNote=next>before?`Adaptive difficulty raised the next session to level ${next}.`:`Adaptive difficulty lowered the next session to level ${next} to rebuild accuracy.`;
    }
    openModal(`<div class="eyebrow">Session complete ${isPersonalBest?'· personal best':''}</div><h2>${Math.round(s.summary.wpm)} WPM · ${fmt1(s.summary.accuracy)}% ${isPersonalBest?'<span class="pill good">NEW PB</span>':''}</h2>${levelNote?`<div class="inline-good" style="margin-bottom:12px">${esc(levelNote)}</div>`:''}<div class="stat-grid"><div class="panel stat-card"><span class="label">Raw speed</span><strong>${Math.round(s.summary.rawWpm)}</strong><small>WPM</small></div><div class="panel stat-card"><span class="label">Consistency</span><strong>${Math.round(s.summary.consistency)}%</strong></div><div class="panel stat-card"><span class="label">Errors</span><strong>${s.summary.errors}</strong></div><div class="panel stat-card"><span class="label">Input p95</span><strong>${Math.round(s.inputDelay?.p95||0)} ms</strong></div><div class="panel stat-card"><span class="label">Best clean streak</span><strong>${s.bestCleanStreak||0}</strong><small>keys</small></div></div><div class="head-actions" style="margin-top:18px;flex-wrap:wrap"><button id="finish-new" class="btn primary">New text</button><button id="finish-recovery" class="btn">Retry mistakes</button><button id="finish-progress" class="btn">Open progress</button><button id="finish-replay" class="btn">Replay keystrokes</button></div>`,modal=>{
      modal.querySelector('#finish-new').onclick=()=>{closeModal();routeTo('practice',{fresh:true});};
      modal.querySelector('#finish-recovery').onclick=()=>{closeModal();routeTo('practice',{text:makeRecoveryText(s),mode:'weak'});};
      modal.querySelector('#finish-progress').onclick=()=>{closeModal();routeTo('progress');};
      modal.querySelector('#finish-replay').onclick=()=>showReplay(s);
    });
  };
  engine.addEventListener('next',onNext);engine.addEventListener('progress',onProgress);engine.addEventListener('finish',onFinish);
  const onBlur=()=>{if(settings.pauseWhenUnfocused && !engine.finished){engine.pause('window');showPause();}};
  window.addEventListener('blur',onBlur);
  function showPause(){
    if(document.querySelector('.pause-cover'))return;
    const cover=document.createElement('div');cover.className='pause-cover';cover.innerHTML='<div class="pause-box"><h3>Paused</h3><p>Timing is stopped while Keyflow is unfocused.</p><button class="btn primary">Resume typing</button></div>';
    document.querySelector('#typing-card').append(cover);cover.querySelector('button').onclick=()=>{cover.remove();engine.resume();};
  }
  document.querySelectorAll('[data-lang]').forEach(b=>b.onclick=async()=>{settings.language=b.dataset.lang;progressFilter=settings.language;practiceState.currentText=null;persistSettings();await routeTo('practice',{fresh:true});});
  document.querySelector('#practice-mode').onchange=e=>{practiceState.mode=e.target.value;practiceState.currentText=null;routeTo('practice',{fresh:true});};
  document.querySelector('#practice-level').onchange=e=>{practiceState.level=Number(e.target.value);practiceState.currentText=null;routeTo('practice',{fresh:true});};
  document.querySelector('#new-text').onclick=()=>{practiceState.currentText=null;routeTo('practice',{fresh:true});};
  document.querySelector('#retry-text').onclick=()=>routeTo('practice',{text:practiceState.currentText});
  document.querySelector('#accuracy-lock').onclick=()=>{settings.strictAccuracy=!settings.strictAccuracy;persistSettings();routeTo('practice',{text:practiceState.currentText});};
  document.querySelector('#focus-toggle').onclick=()=>{settings.focusMode=!settings.focusMode;persistSettings();document.querySelector('#focus-toggle').textContent=settings.focusMode?'Exit focus':'Focus';};
  document.querySelector('#audio-coach').onclick=async()=>{if(!settings.soundEnabled){settings.soundEnabled=true;settings.keySounds=true;if(settings.soundVolume<0.35)settings.soundVolume=0.82;persistSettings();applyAudioSettings({soundEnabled:true,soundVolume:settings.soundVolume,keyClickSounds:true,soundProfile:settings.soundProfile});}const status=await testAudio();const b=document.querySelector('#audio-coach');if(b){b.classList.add('on');b.innerHTML=`<span class="dot"></span><strong>Audio coach ${status.state==='running'?'RUNNING':'ON'}</strong><span>key · word · error</span>`;}updateAudioRuntime();};
  return ()=>{cancelAnimationFrame(hintRaf);engine.destroy();window.removeEventListener('blur',onBlur);window.removeEventListener('keyflow-audio-status',onAudioStatus);};
}

async function renderProgress(){
  const sessions=await getSessions();
  const agg=aggregateSessions(sessions,progressFilter==='all'?null:progressFilter);
  const en=aggregateSessions(sessions,'en'),fa=aggregateSessions(sessions,'fa');
  const recent=sessions.slice().reverse().slice(0,8);
  const today=agg.daily.find(d=>d.date===localDateKey(new Date()))||{minutes:0};
  const goalPct=Math.min(100,(today.minutes/Math.max(1,settings.dailyMinutes))*100);
  const target=progressFilter==='fa'?settings.persianTargetWpm:progressFilter==='en'?settings.englishTargetWpm:Math.max(settings.persianTargetWpm,settings.englishTargetWpm);
  const coach=coachRecommendation(agg,target);
  view.innerHTML=`<div class="view-inner wide">
    <div class="page-head"><div><div class="eyebrow">Local analytics · no fake precision</div><h1>Progress with signal.</h1><p>Separate English and Persian metrics, transitions, corrections, rhythm, and fatigue.</p></div><div class="segmented"><button data-filter="en" class="${progressFilter==='en'?'active':''}">English</button><button data-filter="fa" class="${progressFilter==='fa'?'active':''}">فارسی</button><button data-filter="all" class="${progressFilter==='all'?'active':''}">Combined</button></div></div>
    <div class="stat-grid stat-grid-six">
      <div class="panel stat-card"><span class="label">Average speed</span><strong>${Math.round(agg.averageWpm)} WPM</strong><small>last 5 ${Math.round(agg.recentAverageWpm)} · ${agg.trendWpm>=0?'+':''}${fmt1(agg.trendWpm)} trend</small></div>
      <div class="panel stat-card"><span class="label">Accuracy</span><strong>${fmt1(agg.accuracy)}%</strong><small>${fmt1(agg.errorsPer1000)} errors / 1k chars</small></div>
      <div class="panel stat-card"><span class="label">Consistency</span><strong>${Math.round(agg.averageConsistency)}%</strong><small>${fmt1(agg.correctionRate)}% correction rate</small></div>
      <div class="panel stat-card"><span class="label">Input latency p95</span><strong>${agg.inputDelayP95<1?fmt1(agg.inputDelayP95):Math.round(agg.inputDelayP95)} ms</strong><small>UI/event queue, not finger speed</small></div>
      <div class="panel stat-card"><span class="label">Today's goal</span><strong>${Math.round(today.minutes)} / ${settings.dailyMinutes}m</strong><div class="bar"><i style="width:${goalPct}%"></i></div></div>
      <div class="panel stat-card"><span class="label">Current streak</span><strong>${agg.streak} days</strong><small>best ${Math.round(agg.bestWpm)} WPM · ${agg.sessions} sessions</small></div>
    </div>
    <section class="panel coach-strip"><div><div class="eyebrow">Next useful session</div><strong>${esc(coach.title)}</strong><p>${esc(coach.text)}</p></div><button id="coach-action" class="btn primary">${esc(coach.action)}</button></section>
    <div class="dashboard-grid">
      <section class="panel chart-card"><div class="chart-title"><div><div class="eyebrow">Daily average</div><h3>Speed trend</h3></div><span class="pill">${progressFilter==='all'?'all languages':langName(progressFilter)}</span></div><canvas id="speed-chart" class="chart"></canvas></section>
      <section class="panel list-card"><div class="chart-title"><div><div class="eyebrow">Error fingerprint</div><h3>Weak characters</h3></div></div><div class="data-list">${agg.weakKeys.slice(0,8).map(k=>`<div class="data-row"><strong>${esc(k.char===' '?'␠':k.char)}</strong><span>${fmt1(k.errorRate)}% error</span><span>${Math.round(k.avgLatency)} ms</span></div>`).join('')||'<div class="empty">More sessions are needed.</div>'}</div></section>
      <section class="panel list-card"><div class="chart-title"><div><div class="eyebrow">Movement, not just letters</div><h3>Slow / error transitions</h3></div><button id="train-pairs" class="btn small-btn">Train them</button></div><div class="data-list">${agg.weakPairs.slice(0,8).map(k=>`<div class="data-row"><strong>${esc(k.pair)}</strong><span>${fmt1(k.errorRate)}% error</span><span>${Math.round(k.avgLatency)} ms</span></div>`).join('')||'<div class="empty">Transition data appears after longer sessions.</div>'}</div></section>
      <section class="panel list-card"><div class="chart-title"><div><div class="eyebrow">Recent</div><h3>Sessions</h3></div></div><div class="data-list">${recent.map(s=>`<div class="data-row"><div><strong>${esc(s.title||langName(s.language))}</strong><span style="display:block">${new Date(s.startedAt).toLocaleString()}</span></div><span>${Math.round(s.summary?.wpm||0)} WPM · ${Math.round(s.summary?.accuracy||0)}%</span><button class="btn small-btn" data-replay="${esc(s.id)}">Replay</button></div>`).join('')||'<div class="empty">No sessions yet.</div>'}</div></section>
      <section class="panel progress-heatmap"><div class="chart-title"><div><div class="eyebrow">Physical error map</div><h3>Keyboard heatmap</h3></div><span class="pill">error + latency</span></div><div id="progress-keyboard" class="keyboard compact-keyboard"></div></section>
    </div>
    <div class="language-compare">
      <section class="panel language-card"><div class="eyebrow">English · independent target</div><div class="big">${Math.round(en.averageWpm)} <span class="tiny">/ ${settings.englishTargetWpm} WPM</span></div><div class="bar"><i style="width:${Math.min(100,en.averageWpm/settings.englishTargetWpm*100)}%"></i></div><p class="muted small">${fmt1(en.accuracy)}% accuracy · ${en.sessions} sessions · ${en.streak} day streak</p></section>
      <section class="panel language-card rtl"><div class="eyebrow">فارسی · هدف مستقل</div><div class="big">${Math.round(fa.averageWpm)} <span class="tiny">/ ${settings.persianTargetWpm} WPM</span></div><div class="bar"><i style="width:${Math.min(100,fa.averageWpm/settings.persianTargetWpm*100)}%"></i></div><p class="muted small">دقت ${fmt1(fa.accuracy)}٪ · ${fa.sessions} تمرین · زنجیره ${fa.streak} روز</p></section>
    </div>
  </div>`;
  requestAnimationFrame(()=>drawLineChart(document.querySelector('#speed-chart'),agg.daily.slice(-30)));
  const heatLanguage=progressFilter==='all'?settings.language:progressFilter;const heatKeyboard=new KeyboardView(document.querySelector('#progress-keyboard'),layoutMapper(heatLanguage));
  heatKeyboard.setHeatmap(agg.weakKeys);
  document.querySelector('#coach-action').onclick=()=>{
    if(coach.route){ routeTo(coach.route); return; }
    if(coach.harder) practiceState.level=Math.min(5,practiceState.level+1);
    practiceState.mode=coach.mode||'text';practiceState.currentText=null;routeTo('practice',{mode:practiceState.mode,fresh:true});
  };
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{progressFilter=b.dataset.filter;renderProgress();});
  document.querySelector('#train-pairs').onclick=()=>{practiceState.mode='weak';practiceState.currentText=null;routeTo('practice',{mode:'weak',fresh:true});};
  document.querySelectorAll('[data-replay]').forEach(b=>b.onclick=()=>{const s=sessions.find(x=>x.id===b.dataset.replay);if(s)showReplay(s);});
}

async function showReplay(session){
  if(!session?.text){toast('This older session has no replay text stored.','error');return;}
  const keyEvents=(session.events||[]).filter(e=>e.type==='key');
  openModal(`<div class="eyebrow">Keystroke replay</div><h2>${esc(session.title||'Session')}</h2><div id="replay-text" class="typing-text ${session.language==='fa'?'rtl':''}" dir="${session.language==='fa'?'rtl':'ltr'}" style="height:260px"></div><div class="head-actions"><button id="replay-start" class="btn primary">Replay</button><button id="replay-practice" class="btn">Practice this text</button><span id="replay-state" class="muted small"></span></div>`,modal=>{
    const host=modal.querySelector('#replay-text');
    host.lang=session.language==='fa'?'fa':'en';
    const replayChars=graphemes(session.text,session.language);
    const offsets=new Array(replayChars.length+1);let off=0;for(let i=0;i<replayChars.length;i++){offsets[i]=off;off+=replayChars[i].length;}offsets[replayChars.length]=off;
    const node=document.createTextNode(session.text);const runEl=document.createElement('div');runEl.className='typing-glyph-layer';runEl.append(node);host.append(runEl);
    const canHighlight=session.language!=='fa'&&typeof CSS!=='undefined'&&CSS.highlights&&typeof Highlight!=='undefined';
    const good=canHighlight?new Highlight():null,bad=canHighlight?new Highlight():null;if(canHighlight){CSS.highlights.set('replay-correct',good);CSS.highlights.set('replay-wrong',bad);}
    const rangeAt=index=>{if(index<0||index>=replayChars.length)return null;const r=document.createRange();r.setStart(node,offsets[index]);r.setEnd(node,offsets[index+1]);return r;};
    let timers=[];const run=()=>{timers.forEach(clearTimeout);timers=[];good?.clear();bad?.clear();if(!keyEvents.length)return;const base=keyEvents[0].at||session.startedAt;keyEvents.forEach((e,i)=>{const delay=Math.min(20000,Math.max(0,(e.at||base)-base));timers.push(setTimeout(()=>{const r=rangeAt(e.index);if(r)(e.correct?good:bad)?.add(r);modal.querySelector('#replay-state').textContent=`${i+1}/${keyEvents.length}`;},delay));});};
    modal.querySelector('#replay-start').onclick=run;modal.querySelector('#replay-practice').onclick=()=>{timers.forEach(clearTimeout);if(canHighlight){CSS.highlights.delete('replay-correct');CSS.highlights.delete('replay-wrong');}closeModal();routeTo('practice',{text:{id:`replay-${session.id}`,title:session.title||'Replay text',text:session.text,language:session.language,level:3,source:'replay'}});};
  });
}

async function renderLibrary(){
  const custom=await getCustomTexts();const all=[...custom,...BUILTIN_TEXTS];
  const currentLang=settings.language;let q='';let level='all';let source='all';
  view.innerHTML=`<div class="view-inner wide"><div class="page-head"><div><div class="eyebrow">Meaningful + no-repeat pool</div><h1>Text library.</h1><p>Original practical passages, public-domain classics, your imports, and validated AI drafts.</p></div><button id="add-custom" class="btn primary">Add / import text</button></div>
  <div class="segmented" style="margin-bottom:12px;width:max-content"><button data-lib-lang="en" class="${currentLang==='en'?'active':''}">English</button><button data-lib-lang="fa" class="${currentLang==='fa'?'active':''}">فارسی</button></div>
  <div class="library-toolbar panel"><input id="lib-search" class="input" placeholder="Search title, content, or tag..."><select id="lib-level" class="select"><option value="all">All levels</option>${[1,2,3,4,5].map(x=>`<option value="${x}">Level ${x}</option>`).join('')}</select><select id="lib-source" class="select"><option value="all">All sources</option><option value="original">Original</option><option value="public-domain">Public domain</option><option value="ai">AI generated</option><option value="custom">My texts</option></select></div><div id="text-grid" class="text-grid"></div></div>`;
  const grid=document.querySelector('#text-grid');
  const draw=()=>{
    const list=all.filter(t=>t.language===settings.language).filter(t=>level==='all'||String(t.level)===level).filter(t=>source==='all'||(source==='custom'?String(t.id).startsWith('custom-'):t.source===source)).filter(t=>!q||`${t.title} ${t.text} ${(t.tags||[]).join(' ')}`.toLowerCase().includes(q));
    grid.innerHTML=list.map(t=>`<article class="panel text-card ${t.language==='fa'?'rtl':''}"><div><span class="pill">${t.language==='fa'?'فا':'EN'} · L${esc(t.level||3)}</span> ${t.source==='public-domain'?'<span class="pill good">public domain</span>':''}${t.source==='ai'?`<span class="pill warn">AI · health ${esc(t.health??'?')}</span>`:''}</div><h3>${esc(t.title)}</h3><p>${esc(t.text)}</p><div class="tag-row">${(t.tags||[]).slice(0,4).map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div><footer><button class="btn primary small-btn" data-practice="${esc(t.id)}">Practice</button>${String(t.id).startsWith('custom-')||t.source==='ai'?`<button class="btn ghost small-btn danger" data-delete="${esc(t.id)}">Delete</button>`:`<span class="tiny dim">${esc(t.author||t.source||'builtin')}</span>`}</footer></article>`).join('')||'<div class="empty panel" style="grid-column:1/-1">No texts match these filters.</div>';
    grid.querySelectorAll('[data-practice]').forEach(b=>b.onclick=()=>{const t=all.find(x=>x.id===b.dataset.practice);if(t){settings.language=t.language;persistSettings();practiceState.currentText=t;routeTo('practice',{text:t});}});
    grid.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{await deleteText(b.dataset.delete);toast('Text deleted.','success');renderLibrary();});
  };
  draw();
  document.querySelectorAll('[data-lib-lang]').forEach(b=>b.onclick=()=>{settings.language=b.dataset.libLang;persistSettings();renderLibrary();});
  document.querySelector('#lib-search').oninput=e=>{q=e.target.value.toLowerCase().trim();draw();};
  document.querySelector('#lib-level').onchange=e=>{level=e.target.value;draw();};
  document.querySelector('#lib-source').onchange=e=>{source=e.target.value;draw();};
  document.querySelector('#add-custom').onclick=()=>openAddTextModal();
}

function openAddTextModal(prefill={}){
  openModal(`<div class="eyebrow">Local content</div><h2>Add or clean a text</h2><div class="field-row two"><label class="field">Language<select id="add-lang" class="select"><option value="en">English</option><option value="fa">فارسی</option></select></label><label class="field">Title<input id="add-title" class="input" value="${esc(prefill.title||'')}"></label></div><label class="field" style="margin-top:12px">Paste text<textarea id="add-text" class="textarea" dir="auto">${esc(prefill.text||'')}</textarea></label><div id="add-health" class="status-line"></div><div class="head-actions" style="margin-top:12px"><button id="add-clean" class="btn">Clean for keyboard</button><button id="add-save" class="btn primary">Save text</button></div>`,modal=>{
    const lang=modal.querySelector('#add-lang');lang.value=prefill.language||settings.language;const area=modal.querySelector('#add-text');
    const evaluate=()=>{const layout=lang.value==='fa'?settings.persianLayout:settings.englishLayout;const v=validatePracticeContent(area.value,{language:lang.value,layoutId:layout,calibration:settings.calibration[layout]||{},allowDiacritics:settings.allowPersianDiacritics,minLength:20});modal.querySelector('#add-health').textContent=`Content health ${v.health}/100${v.issues.length?' · '+v.issues.join(' '):' · ready'}`;return v;};
    area.oninput=evaluate;lang.onchange=evaluate;evaluate();
    modal.querySelector('#add-clean').onclick=()=>{area.value=cleanImportedText(area.value,lang.value,{allowDiacritics:settings.allowPersianDiacritics});evaluate();};
    modal.querySelector('#add-save').onclick=async()=>{const v=evaluate();if(!v.text.trim()){toast('Text is empty.','error');return;}const t={id:`custom-${crypto.randomUUID()}`,language:lang.value,title:modal.querySelector('#add-title').value.trim()||'My text',text:v.text,level:3,tags:['custom'],source:'custom',createdAt:Date.now(),health:v.health};await saveText(t);closeModal();toast('Text saved locally.','success');settings.language=t.language;persistSettings();routeTo('library');};
  });
}

async function renderAi(){
  const sessions=await getSessions();const aggregate=aggregateSessions(sessions,settings.language);const weak=aggregate.weakKeys.slice(0,8).map(x=>x.char).join(' ');
  view.innerHTML=`<div class="view-inner wide"><div class="page-head"><div><div class="eyebrow">Live model discovery · provider neutral</div><h1>AI practice studio.</h1><p>No deprecated model IDs in UI. Discover models from each provider, validate language, then keyboard-check every draft.</p></div><span class="pill good">API keys stay in session memory</span></div>
  <div class="ai-grid"><section class="panel ai-config"><div class="eyebrow">Connection</div><h3>Provider</h3><div class="stack"><label class="field">Provider<select id="ai-provider" class="select">${Object.values(PROVIDERS).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><div id="provider-note" class="provider-note"></div><label class="field">API key<input id="ai-key" class="input" type="password" autocomplete="off" placeholder="key is never written to localStorage"></label><div id="provider-extra" class="stack"></div><div class="model-row"><label class="field">Live model ID<input id="ai-model" class="input" list="model-list" placeholder="Refresh models or type an ID"><datalist id="model-list"></datalist></label><div class="head-actions" style="align-self:end"><button id="smart-model" class="btn">Smart pick</button><button id="refresh-models" class="btn">Refresh</button></div></div><div id="model-status" class="status-line"></div><div class="head-actions"><button id="save-provider" class="btn primary">Save config</button><button id="test-provider" class="btn">Test discovery</button><button id="remove-key" class="btn ghost danger">Clear key</button></div></div></section>
  <section class="panel ai-compose"><div class="eyebrow">Adaptive content</div><h3>Generate a validated practice text</h3><div class="field-row"><label class="field">Language<select id="gen-lang" class="select"><option value="en">English</option><option value="fa">فارسی</option></select></label><label class="field">Level<select id="gen-level" class="select">${[1,2,3,4,5].map(x=>`<option value="${x}">${x}</option>`).join('')}</select></label><label class="field">Length<select id="gen-length" class="select"><option value="short">Short</option><option value="medium" selected>Medium</option><option value="long">Long</option></select></label></div><label class="field" style="margin-top:12px">Topic<input id="gen-topic" class="input" value="${settings.language==='fa'?'فناوری و زندگی روزمره':'technology and daily life'}"></label><label class="field" style="margin-top:12px">Weak characters / transitions<input id="gen-weak" class="input" value="${esc(weak)}" placeholder="optional"></label><div class="tag-row" id="topic-chips" style="margin:10px 0"></div><div class="setting-row"><div><strong>Keyboard-safe output</strong><small>Reject unsupported characters and unwanted Persian marks before saving.</small></div><span class="pill good">mandatory</span></div>${toggleRow('gen-review','Deep language review','A second AI pass fixes grammar, verb agreement, tense, meaning, and story causality before the text is accepted.',settings.aiDeepReview!==false)}<button id="generate" class="btn primary" style="width:100%;margin-top:14px">Generate, validate, review, and repair</button><div id="gen-status" class="status-line"></div></section></div><section id="ai-result" class="panel ai-result" style="display:none"></section></div>`;
  const providerSelect=document.querySelector('#ai-provider'),keyInput=document.querySelector('#ai-key'),modelInput=document.querySelector('#ai-model'),extra=document.querySelector('#provider-extra'),note=document.querySelector('#provider-note'),status=document.querySelector('#model-status');
  providerSelect.value=settings.provider in PROVIDERS?settings.provider:'openrouter';document.querySelector('#gen-lang').value=settings.language;document.querySelector('#gen-level').value=String(practiceState.level);
  const drawTopics=()=>{const lang=document.querySelector('#gen-lang').value;document.querySelector('#topic-chips').innerHTML=TOPICS[lang].map(t=>`<button class="tag" data-topic="${esc(t)}">${esc(t)}</button>`).join('');document.querySelectorAll('[data-topic]').forEach(b=>b.onclick=()=>document.querySelector('#gen-topic').value=b.dataset.topic);};drawTopics();document.querySelector('#gen-lang').onchange=()=>drawTopics();
  const loadConfig=()=>{
    const id=providerSelect.value,p=PROVIDERS[id],cfg=loadProviderConfig(id);keyInput.value=cfg.apiKey||'';note.innerHTML=`<strong>${esc(p.freeLabel)}</strong><br>${esc(p.description)}`;extra.innerHTML=(p.fields||[]).map(f=>`<label class="field">${esc(f.label)}<input class="input" data-config="${esc(f.key)}" placeholder="${esc(f.placeholder||'')}" value="${esc(cfg[f.key]||'')}"></label>`).join('');modelInput.value=settings.modelByProvider?.[id]||cfg.model||'';status.textContent='Model list is fetched live; nothing is assumed from an old release.';
  };
  const collect=()=>{const cfg=loadProviderConfig(providerSelect.value);cfg.apiKey=keyInput.value.trim();extra.querySelectorAll('[data-config]').forEach(i=>cfg[i.dataset.config]=i.value.trim());return cfg;};
  const refresh=async(force=true)=>{const id=providerSelect.value,cfg=collect();status.textContent='Discovering live models…';try{const models=await listProviderModels(id,cfg,{force});document.querySelector('#model-list').innerHTML=models.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');const current=models.find(m=>m.id===modelInput.value);if(!current){const recommended=pickRecommendedModel(models);if(recommended)modelInput.value=recommended.id;}const recommended=pickRecommendedModel(models);status.textContent=`${models.length} live model${models.length===1?'':'s'} returned by ${PROVIDERS[id].name}.${recommended?` Smart pick: ${recommended.id}`:''}`;return models;}catch(e){status.textContent=`Discovery failed: ${e.message}`;toast(e.message,'error');return[];}};
  providerSelect.onchange=()=>{settings.provider=providerSelect.value;persistSettings();loadConfig();};loadConfig();
  document.querySelector('#refresh-models').onclick=()=>refresh(true);document.querySelector('#smart-model').onclick=async()=>{const models=await refresh(false);const pick=pickRecommendedModel(models);if(pick){modelInput.value=pick.id;toast(`Selected ${pick.id}`,'success');}};document.querySelector('#test-provider').onclick=()=>refresh(true);
  document.querySelector('#gen-review').onclick=e=>{const on=!e.currentTarget.classList.contains('on');e.currentTarget.classList.toggle('on',on);e.currentTarget.setAttribute('aria-checked',String(on));settings.aiDeepReview=on;persistSettings();};
  document.querySelector('#save-provider').onclick=()=>{const id=providerSelect.value,cfg=collect();saveProviderConfig(id,cfg);settings.provider=id;settings.modelByProvider ||= {};settings.modelByProvider[id]=modelInput.value.trim();persistSettings();toast('Provider configuration saved. API key is session-only.','success');};
  document.querySelector('#remove-key').onclick=()=>{clearProviderKey(providerSelect.value);keyInput.value='';toast('Session API key cleared.','success');};
  document.querySelector('#generate').onclick=async()=>{
    const id=providerSelect.value,cfg=collect(),model=modelInput.value.trim();if(!model){toast('Select or type a model ID.','error');return;}if(PROVIDERS[id].requiresKey!==false&&!cfg.apiKey){toast('Enter an API key for this provider.','error');return;}
    const lang=document.querySelector('#gen-lang').value;const layout=lang==='fa'?settings.persianLayout:settings.englishLayout;const options={language:lang,level:Number(document.querySelector('#gen-level').value),length:document.querySelector('#gen-length').value,topic:document.querySelector('#gen-topic').value.trim(),weakCharacters:Array.from(document.querySelector('#gen-weak').value.trim()),allowDiacritics:lang==='fa'&&settings.allowPersianDiacritics,layoutId:layout,deepReview:settings.aiDeepReview!==false};
    const genStatus=document.querySelector('#gen-status');genStatus.textContent='Generating → language checking → keyboard checking → automatic repair if needed…';document.querySelector('#generate').disabled=true;
    try{generatedDraft=await generatePracticeText({providerId:id,config:cfg,model,options,calibration:settings.calibration[layout]||{}});settings.modelByProvider[id]=model;saveProviderConfig(id,cfg);persistSettings();const box=document.querySelector('#ai-result');box.style.display='block';box.innerHTML=`<div class="chart-title"><div><div class="eyebrow">Validated draft · health ${generatedDraft.health}/100</div><h3>${esc(generatedDraft.title)}</h3></div><span class="pill good">${esc(id)} · ${esc(model)}</span></div><div class="ai-preview ${lang==='fa'?'rtl':''}" dir="${lang==='fa'?'rtl':'ltr'}">${esc(generatedDraft.text)}</div><div class="head-actions" style="margin-top:16px"><button id="draft-practice" class="btn primary">Practice now</button><button id="draft-save" class="btn">Save to library</button><span class="small muted">${generatedDraft.validation.unsupported.length?`Unmapped: ${esc(generatedDraft.validation.unsupported.join(' '))}`:'Keyboard-safe for selected profile'}</span></div>`;box.querySelector('#draft-practice').onclick=()=>{settings.language=generatedDraft.language;persistSettings();routeTo('practice',{text:generatedDraft});};box.querySelector('#draft-save').onclick=async()=>{await saveText(generatedDraft);toast('AI text saved to library.','success');};genStatus.textContent=`Passed language purity, keyboard safety, and ${generatedDraft.deepReviewed?'deep semantic review':'structural quality'} checks.`;playFeedback('ready');}
    catch(e){genStatus.textContent=e.message;toast(e.message,'error',4500);}finally{document.querySelector('#generate').disabled=false;}
  };
}

async function renderSettings(){
  const rendererLabel=runtimeInfo.rendererMode||'browser';
  const envLabel=(runtimeInfo.appliedEnv||[]).join(', ')||'none';
  const gpuLabel=(runtimeInfo.gpuVendors||[]).join(', ')||'unknown';
  view.innerHTML=`<div class="view-inner wide"><div class="page-head"><div><div class="eyebrow">EndeavourOS-first local preferences</div><h1>Settings.</h1><p>The default profile is tuned for Arch/EndeavourOS + KDE and keeps the typing hot path isolated from expensive work.</p></div><span class="pill ${String(rendererLabel).includes('safe')?'warn':'good'}">${esc(rendererLabel)}</span></div><div class="settings-grid">
  <section class="panel settings-card"><div class="eyebrow">Goals</div><h3>Targets and language separation</h3><div class="field-row"><label class="field">Daily minutes<input id="s-daily" class="input" type="number" min="1" max="240" value="${settings.dailyMinutes}"></label><label class="field">English target WPM<input id="s-en-wpm" class="input" type="number" min="5" max="250" value="${settings.englishTargetWpm}"></label><label class="field">Persian target WPM<input id="s-fa-wpm" class="input" type="number" min="5" max="250" value="${settings.persianTargetWpm}"></label></div><div class="hairline"></div><div class="setting-row"><div><strong>Current practice language</strong><small>Library, AI defaults, drills, and targets stay independent per language.</small></div><div class="segmented"><button data-setting-lang="en" class="${settings.language==='en'?'active':''}">EN</button><button data-setting-lang="fa" class="${settings.language==='fa'?'active':''}">فا</button></div></div></section>
  <section class="panel settings-card"><div class="eyebrow">Practice engine</div><h3>Latency and behavior</h3><label class="field">Performance profile<select id="s-performance" class="select"><option value="ultra">Ultra latency — recommended on EndeavourOS</option><option value="balanced">Balanced visuals</option></select></label><div class="hairline"></div>${toggleRow('s-strict','Strict accuracy mode','Wrong keys do not advance the cursor.',settings.strictAccuracy)}${toggleRow('s-pause','Pause when unfocused','Prevents background time from corrupting WPM.',settings.pauseWhenUnfocused)}${toggleRow('s-auto-level','Adaptive difficulty','Raises or lowers the next level only after recent accuracy, consistency, and pace justify it.',settings.autoLevel!==false)}${toggleRow('s-heatmap','Weak-key heatmap','Tint the physical keyboard using your recent error/latency fingerprint.',settings.showWeakKeyHeatmap!==false)}${toggleRow('s-diacritics','Persian diacritics / marks','Off by default; enable only after calibrating advanced marks.',settings.allowPersianDiacritics)}${toggleRow('s-reduce','Reduce motion','Disable nonessential movement.',settings.reduceMotion)}</section>
  <section class="panel settings-card"><div class="eyebrow">Physical layouts</div><h3>Real EndeavourOS/XKB mapping</h3><div class="field-row two"><label class="field">English layout<select id="s-en-layout" class="select"><option value="en-us">English · US</option></select></label><label class="field">Persian layout<select id="s-fa-layout" class="select">${Object.values(LAYOUTS).filter(x=>x.language==='fa').map(x=>`<option value="${x.id}">${esc(x.label)}</option>`).join('')}</select></label></div><p class="muted small">The standard profile now mirrors <code>/usr/share/X11/xkb/symbols/ir</code> instead of guessing from a Windows table. Keyflow still learns <code>KeyboardEvent.key + code + Shift + AltGr</code> from your real keyboard and learned mappings override the profile.</p><div class="hairline"></div><div class="eyebrow">Live layout probe</div><div id="probe" class="probe" tabindex="0"><div id="probe-key" class="probe-key">Press a key</div><div id="probe-meta" class="probe-meta">Focus this box and press Persian keys. Mapping is learned locally.</div></div><div class="head-actions" style="margin-top:10px"><button id="probe-focus" class="btn small-btn">Focus probe</button><button id="guided-map" class="btn small-btn">Guided calibration</button><button id="reset-map" class="btn ghost small-btn danger">Reset learned map</button></div><div id="mapping-table" class="mapping-table"></div></section>
  <section class="panel settings-card"><div class="eyebrow">Sound coach</div><h3>Auditory typing guidance</h3>${toggleRow('s-sound','Sound feedback','Cuelume is the primary sound engine. The AppImage now bundles the GStreamer audio dependencies required by WebKitGTK on EndeavourOS.',settings.soundEnabled)}${toggleRow('s-keysound','Per-key tick','Every accepted key uses the context-aware Cuelume typing cue; spaces, delete and Enter get their own key character, mistakes use error, completion uses success.',settings.keySounds)}<label class="field" style="margin-top:14px">Sound profile<select id="s-sound-profile"><option value="mechanical">Mechanical</option><option value="soft">Soft</option><option value="minimal">Minimal</option><option value="playful">Playful</option></select></label><label class="field" style="margin-top:14px">Volume<input id="s-volume" type="range" min="0" max="1" step="0.05" value="${settings.soundVolume}"></label><div class="head-actions" style="margin-top:12px"><button id="test-sound" class="btn primary">Test actual typing sounds</button><span id="sound-status" class="pill">Cuelume · ${esc(getAudioStatus().state)} · GStreamer ${runtimeInfo.gstreamerReady?'ready':'check'}</span></div><p class="muted small">Key sounds come directly from Cuelume. The Linux AppImage bundles GStreamer Base + Good audio plugins so WebKitGTK can actually create its Web Audio output pipeline.</p><div class="mapping-table"><div><strong>Media framework</strong><span>${runtimeInfo.gstreamerReady?'bundled + ready':runtimeInfo.mediaFrameworkBundled?'bundled but incomplete':'not detected (normal in browser/dev)'}</span></div><div><strong>Plugin path</strong><span>${esc(runtimeInfo.gstreamerPluginPath||'AppImage runtime only')}</span></div></div></section>
  <section class="panel settings-card"><div class="eyebrow">Linux graphics</div><h3>AppImage renderer diagnostics</h3><div class="data-list"><div class="data-row"><strong>Distro</strong><span>${esc(runtimeInfo.distro||'browser')}</span><span>${esc(runtimeInfo.distroLike||'')}</span></div><div class="data-row"><strong>Desktop / session</strong><span>${esc(runtimeInfo.desktop||'unknown')}</span><span>${esc(runtimeInfo.displayServer||runtimeInfo.session||'unknown')}</span></div><div class="data-row"><strong>GPU vendor</strong><span>${esc(gpuLabel)}</span><span></span></div><div class="data-row"><strong>Renderer</strong><span>${esc(rendererLabel)}</span><span></span></div><div class="data-row"><strong>Compatibility env</strong><span>${esc(envLabel)}</span><span></span></div></div><p class="muted small" style="margin-top:12px">Startup diagnostics: <code>${esc(runtimeInfo.startupLog||'~/.local/state/keyflow/startup.log')}</code>. Override only for troubleshooting: <code>KEYFLOW_RENDERER=normal</code>, <code>software</code>, or <code>x11-safe</code>.</p></section>
  <section class="panel settings-card"><div class="eyebrow">Responsiveness</div><h3>Live performance tools</h3><p class="muted small">Practice now measures browser event-queue delay (p95) separately from typing rhythm, so a slow UI is visible instead of being mistaken for slow fingers.</p><div class="head-actions"><button id="run-benchmark" class="btn">Run UI benchmark</button><span id="benchmark-result" class="pill">not run</span></div><div class="hairline"></div><p class="muted small">Ultra mode removes blur/backdrop filters, expensive shadows, glyph transitions, and unnecessary paint work while preserving the actual typing feedback.</p></section>
  </div><div class="head-actions" style="margin-top:14px"><button id="save-settings" class="btn primary">Save settings</button><button id="open-lab" class="btn">Open training lab</button></div></div>`;
  document.querySelector('#s-fa-layout').value=settings.persianLayout;document.querySelector('#s-en-layout').value=settings.englishLayout;document.querySelector('#s-performance').value=settings.performanceMode||'ultra';
  document.querySelectorAll('[data-setting-lang]').forEach(b=>b.onclick=()=>{settings.language=b.dataset.settingLang;persistSettings();renderSettings();});
  const toggles=[['#s-strict','strictAccuracy'],['#s-pause','pauseWhenUnfocused'],['#s-auto-level','autoLevel'],['#s-heatmap','showWeakKeyHeatmap'],['#s-diacritics','allowPersianDiacritics'],['#s-reduce','reduceMotion'],['#s-sound','soundEnabled'],['#s-keysound','keySounds']];
  toggles.forEach(([sel,key])=>document.querySelector(sel).onclick=e=>{
    settings[key]=!settings[key];
    e.currentTarget.classList.toggle('on',settings[key]);
    if(key==='soundEnabled'||key==='keySounds') applyAudioSettings({soundEnabled:settings.soundEnabled,soundVolume:settings.soundVolume,keyClickSounds:settings.keySounds,soundProfile:settings.soundProfile});
    persistSettings();
  });
  document.querySelector('#s-sound-profile').value=settings.soundProfile||'mechanical';
  document.querySelector('#s-sound-profile').onchange=e=>{settings.soundProfile=e.target.value;persistSettings();applyAudioSettings({soundEnabled:settings.soundEnabled,soundVolume:settings.soundVolume,keyClickSounds:settings.keySounds,soundProfile:settings.soundProfile});};
  document.querySelector('#s-volume').oninput=e=>{
    settings.soundVolume=Number(e.currentTarget.value);
    applyAudioSettings({soundEnabled:settings.soundEnabled,soundVolume:settings.soundVolume,keyClickSounds:settings.keySounds,soundProfile:settings.soundProfile});
  };
  document.querySelector('#test-sound').onclick=async()=>{
    if(!settings.soundEnabled){
      settings.soundEnabled=true;
      document.querySelector('#s-sound').classList.add('on');
    }
    if(settings.soundVolume<0.25){ settings.soundVolume=0.82; document.querySelector('#s-volume').value='0.82'; }
    persistSettings();
    applyAudioSettings({soundEnabled:true,soundVolume:settings.soundVolume,keyClickSounds:settings.keySounds,soundProfile:settings.soundProfile});
    const status=await testAudio();
    const media=runtimeInfo.gstreamerReady?'GStreamer ready':(runtimeInfo.mediaFrameworkBundled?'GStreamer incomplete':'GStreamer not detected');const label=status.lastError?`Cuelume · failed · ${status.lastError} · ${media}`:`Cuelume · ${status.state} · ${status.theme} · ${media}`;
    document.querySelector('#sound-status').textContent=label;
  };
  const probe=document.querySelector('#probe');const drawMappings=()=>{const map=settings.calibration[settings.persianLayout]||{};document.querySelector('#mapping-table').innerHTML=Object.entries(map).sort((a,b)=>b[1].seenAt-a[1].seenAt).slice(0,30).map(([ch,r])=>`<div class="mapping-row"><strong>${esc(ch===' '?'␠':ch==='‌'?'ZWNJ':ch)}</strong><span>${esc(formatChord(r))}</span><span class="dim">learned</span></div>`).join('')||'<div class="empty">No learned keys yet. The map also learns automatically during practice.</div>';};drawMappings();
  const onProbe=e=>{if(document.activeElement!==probe)return;if(e.metaKey)return;e.preventDefault();const actual=e.key==='Enter'?'\n':e.key;if(!actual||actual.length>3)return;const normalized=normalizeForComparison(actual,'fa');const record={code:e.code,shift:!!e.shiftKey,altGraph:e.getModifierState?.('AltGraph')||false,seenAt:Date.now(),source:'learned'};settings.calibration[settings.persianLayout] ||= {};settings.calibration[settings.persianLayout][normalized]=record;scheduleCalibrationSave();document.querySelector('#probe-key').textContent=normalized===' '?'␠':normalized==='‌'?'ZWNJ':normalized;document.querySelector('#probe-meta').textContent=`${e.code} · ${formatChord(record)} · event.key=${JSON.stringify(e.key)}`;drawMappings();};
  probe.addEventListener('keydown',onProbe);document.querySelector('#probe-focus').onclick=()=>probe.focus();document.querySelector('#guided-map').onclick=()=>startPersianCalibration();document.querySelector('#reset-map').onclick=()=>{settings.calibration[settings.persianLayout]={};persistSettings();drawMappings();toast('Learned Persian mapping reset.','success');};
  document.querySelector('#run-benchmark').onclick=()=>runUiBenchmark(document.querySelector('#benchmark-result'));
  document.querySelector('#save-settings').onclick=()=>{settings.dailyMinutes=Number(document.querySelector('#s-daily').value)||15;settings.englishTargetWpm=Number(document.querySelector('#s-en-wpm').value)||55;settings.persianTargetWpm=Number(document.querySelector('#s-fa-wpm').value)||40;settings.englishLayout=document.querySelector('#s-en-layout').value;settings.persianLayout=document.querySelector('#s-fa-layout').value;settings.performanceMode=document.querySelector('#s-performance').value;settings.soundVolume=Number(document.querySelector('#s-volume').value);persistSettings();applyAudioSettings({soundEnabled:settings.soundEnabled,soundVolume:settings.soundVolume,keyClickSounds:settings.keySounds,soundProfile:settings.soundProfile});toast('Settings saved.','success');renderSettings();};
  document.querySelector('#open-lab').onclick=()=>routeTo('lab');
  return ()=>probe.removeEventListener('keydown',onProbe);
}

function startPersianCalibration(){
  const base='ضصثقفغعهخحجچشسیبلاتنمکگظطزرذدپوه';
  const punctuation='،؛:؟.\/‌';
  const marks=settings.allowPersianDiacritics?'َُِّ':'';
  const targets=Array.from(base+punctuation+marks);
  const mapper=layoutMapper('fa');
  let index=0;
  openModal(`<div class="eyebrow">Persian keyboard calibration</div><h2>Teach Keyflow your exact XKB output.</h2><p class="muted small">Press the character shown below. The suggested physical chord comes from the selected profile; your real event wins if it differs.</p><div id="cal-zone" class="cal-zone" tabindex="0"><div id="cal-count" class="eyebrow"></div><div id="cal-target" class="cal-target"></div><div id="cal-hint" class="muted"></div><div id="cal-last" class="small muted"></div></div><div class="head-actions" style="margin-top:14px"><button id="cal-skip" class="btn">Skip</button><button id="cal-close" class="btn ghost">Close</button></div>`,modal=>{
    const zone=modal.querySelector('#cal-zone'),target=modal.querySelector('#cal-target'),hint=modal.querySelector('#cal-hint'),count=modal.querySelector('#cal-count'),last=modal.querySelector('#cal-last');
    const draw=()=>{if(index>=targets.length){count.textContent='complete';target.textContent='✓';hint.textContent=`Learned ${Object.keys(settings.calibration[settings.persianLayout]||{}).length} mappings.`;last.textContent='You can close this wizard.';return;}const ch=targets[index];const h=mapper.hintFor(ch,'fa');count.textContent=`${index+1} / ${targets.length}`;target.textContent=ch==='‌'?'ZWNJ':ch;hint.textContent=h?`Profile suggestion: ${formatChord(h)}`:'No profile hint — press the key that produces it.';last.textContent='';};
    zone.onkeydown=e=>{if(index>=targets.length||e.metaKey)return;e.preventDefault();const actual=normalizeForComparison(e.key==='Enter'?'\n':e.key,'fa');const expected=targets[index];if(actual!==expected){last.textContent=`That produced ${JSON.stringify(actual)}. Expected ${expected==='‌'?'ZWNJ':expected}; try again or skip.`;return;}const record={code:e.code,shift:!!e.shiftKey,altGraph:e.getModifierState?.('AltGraph')||false,seenAt:Date.now(),source:'guided'};settings.calibration[settings.persianLayout] ||= {};settings.calibration[settings.persianLayout][expected]=record;mapper.calibration[expected]=record;index+=1;scheduleCalibrationSave();draw();};
    modal.querySelector('#cal-skip').onclick=()=>{index=Math.min(targets.length,index+1);draw();zone.focus();};modal.querySelector('#cal-close').onclick=()=>{saveSettings(settings);closeModal();renderSettings();};draw();setTimeout(()=>zone.focus(),0);
  });
}

function runUiBenchmark(output){
  output.textContent='running…';
  requestAnimationFrame(()=>{const host=document.createElement('div');host.style.cssText='position:fixed;left:-9999px;top:-9999px;contain:strict';const nodes=[];for(let i=0;i<600;i++){const s=document.createElement('span');s.className='glyph';s.textContent='ا';host.append(s);nodes.push(s);}document.body.append(host);const start=performance.now();for(let round=0;round<20;round++){const a=nodes[round%nodes.length],b=nodes[(round+1)%nodes.length];a.classList.toggle('current');b.classList.toggle('correct');}requestAnimationFrame(()=>{const elapsed=performance.now()-start;host.remove();output.textContent=`${elapsed.toFixed(1)} ms / 20 paint swaps`;output.className=`pill ${elapsed<35?'good':elapsed<80?'warn':'bad'}`;});});
}

function toggleRow(id,title,desc,on){return `<div class="setting-row"><div><strong>${esc(title)}</strong><small>${esc(desc)}</small></div><button id="${id}" class="switch ${on?'on':''}" role="switch" aria-checked="${on}"></button></div>`;}

async function renderLab(){
  const sessions=await getSessions(),agg=aggregateSessions(sessions,settings.language),last=sessions.filter(s=>s.language===settings.language).at(-1);
  view.innerHTML=`<div class="view-inner wide"><div class="page-head"><div><div class="eyebrow">Useful experiments, not decoration</div><h1>Training lab.</h1><p>Tools that turn your real error and timing data into practice.</p></div><span class="pill">${langName(settings.language)}</span></div><div class="feature-grid">
  ${feature('⌁','Adaptive n-gram drill','Builds a passage around slow/error transitions instead of repeating random letters.','lab-adaptive','Start drill')}
  ${feature('◉','Rhythm lab','Targets uneven inter-key timing and transition control.','lab-rhythm','Start rhythm')}
  ${feature('⌨','Layout self-learning','Open the live probe and teach Keyflow your exact Linux XKB or Windows mapping.','lab-map','Open mapper')}
  ${feature('◌','Focus mode','Hide navigation and reduce peripheral UI while keeping metrics and keyboard hints available.','lab-focus',settings.focusMode?'Disable focus':'Enable focus')}
  ${feature('↻','Keystroke replay','Replay the latest session with original timing to see where flow broke.','lab-replay',last?'Replay last':'No session')}
  ${feature('▥','Content cleaner','Paste any article and normalize Persian letters, whitespace, and keyboard-risky marks.','lab-clean','Clean text')}
  ${feature('⌁','Fatigue check','Compare start, middle, and end rhythm in your last session instead of guessing when speed decays.','lab-fatigue','Inspect fatigue')}
  ${feature('⇩','Export local data','Export session analytics as JSON. API keys are never included.','lab-export','Export JSON')}
  ${feature('✦','AI content health','AI passages are checked for script purity, unsupported keys, repetition, and length before they enter the library.','lab-ai','Open AI studio')}
  ${feature('≋','Error fingerprint','Uses per-key and per-transition latency plus error rate to create a personal weakness profile.','lab-progress','View fingerprint')}
  ${feature('△','Ghost target pace','Practice shows live WPM delta against a separate target for each language.','lab-practice','Try pace view')}
  ${feature('∞','No-repeat scheduler','Uses a shuffle bag and seen-count balancing so daily practice stops cycling through five passages.','lab-new','Get fresh text')}
  ${feature('▦','Physical weak-key heatmap','Projects your recent error and latency score back onto the actual physical keyboard.','lab-heatmap','Open heatmap')}
  ${feature('123','Numbers and symbols','Dedicated number and punctuation passages instead of waiting for symbols to appear randomly.','lab-numbers','Start symbols')}
  ${feature('↩','Session recovery drill','Build a short follow-up drill from the exact characters and transitions you just struggled with.','lab-recovery',last?'Retry last':'No session')}
  ${feature('↕','Adaptive difficulty','Automatically changes one level at a time only when recent accuracy, consistency, and pace support it.','lab-level',settings.autoLevel!==false?'Disable':'Enable')}
  ${feature('⚡','Responsiveness audit','Measure event-queue p95 during real typing and run an isolated UI paint benchmark.','lab-perf','Open performance')}
  ${feature('☝','Finger coach','Shows the exact hand/finger for the next physical key, independent of Persian or English legends.','lab-finger','Open practice')}
  ${feature('♪','Audio engine monitor','Tests the same Cuelume cue path used by real keystrokes and exposes native AppImage/GStreamer media diagnostics.','lab-audio','Open sound settings')}
  ${feature('✓','Accuracy lock','Wrong keys do not advance the cursor, useful for rebuilding precise Persian punctuation and weak transitions.','lab-strict',settings.strictAccuracy?'Disable':'Enable')}
  </div></div>`;
  document.querySelector('#lab-adaptive').onclick=()=>routeTo('practice',{mode:'weak',fresh:true});document.querySelector('#lab-rhythm').onclick=()=>routeTo('practice',{mode:'rhythm',fresh:true});document.querySelector('#lab-map').onclick=()=>routeTo('settings');document.querySelector('#lab-focus').onclick=()=>{settings.focusMode=!settings.focusMode;persistSettings();renderLab();};document.querySelector('#lab-replay').onclick=()=>last&&showReplay(last);document.querySelector('#lab-clean').onclick=()=>openAddTextModal({language:settings.language});document.querySelector('#lab-ai').onclick=()=>routeTo('ai');document.querySelector('#lab-progress').onclick=()=>routeTo('progress');document.querySelector('#lab-practice').onclick=()=>routeTo('practice');document.querySelector('#lab-new').onclick=()=>{practiceState.currentText=null;routeTo('practice',{fresh:true});};
  document.querySelector('#lab-fatigue').onclick=()=>{if(!last){toast('Complete a session first.','error');return;}const curve=fatigueCurve(last);openModal(`<div class="eyebrow">Last session</div><h2>Fatigue curve</h2>${curve.length?`<canvas id="fatigue-chart" class="chart" style="height:220px"></canvas><p class="muted small">This compares actual inter-key timing across thirds of the session; it does not diagnose fatigue medically.</p>`:'<div class="empty">This session is too short for a stable three-part curve.</div>'}`,modal=>{if(curve.length)requestAnimationFrame(()=>drawBars(modal.querySelector('#fatigue-chart'),curve.map(x=>({label:x.label,value:x.wpm}))));});};
  document.querySelector('#lab-export').onclick=()=>exportSessions(sessions);
  document.querySelector('#lab-heatmap').onclick=()=>routeTo('progress');
  document.querySelector('#lab-numbers').onclick=()=>routeTo('practice',{mode:'numbers',fresh:true});
  document.querySelector('#lab-recovery').onclick=()=>{if(!last){toast('Complete a session first.','error');return;}routeTo('practice',{text:makeRecoveryText(last),mode:'weak'});};
  document.querySelector('#lab-level').onclick=()=>{settings.autoLevel=settings.autoLevel===false;persistSettings();renderLab();};
  document.querySelector('#lab-perf').onclick=()=>routeTo('settings');
  document.querySelector('#lab-finger').onclick=()=>routeTo('practice');
  document.querySelector('#lab-audio').onclick=()=>routeTo('settings');
  document.querySelector('#lab-strict').onclick=()=>{settings.strictAccuracy=!settings.strictAccuracy;persistSettings();renderLab();};
}
function feature(icon,title,text,id,action){return `<section class="panel feature-card"><div class="icon">${icon}</div><h3>${esc(title)}</h3><p>${esc(text)}</p><button id="${id}" class="btn small-btn">${esc(action)}</button></section>`;}
function exportSessions(sessions){const payload={schema:1,exportedAt:new Date().toISOString(),settings:{dailyMinutes:settings.dailyMinutes,englishTargetWpm:settings.englishTargetWpm,persianTargetWpm:settings.persianTargetWpm,englishLayout:settings.englishLayout,persianLayout:settings.persianLayout},sessions};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`keyflow-export-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Export prepared.','success');}

function openCommandPalette(){
  const commands=[
    {name:'Start a new smart practice text',keys:'Ctrl Enter',run:()=>{practiceState.currentText=null;routeTo('practice',{fresh:true});}},
    {name:'Practice weak characters and transitions',keys:'adaptive',run:()=>routeTo('practice',{mode:'weak',fresh:true})},
    {name:'Start rhythm drill',keys:'rhythm',run:()=>routeTo('practice',{mode:'rhythm',fresh:true})},
    {name:'Switch to English',keys:'Ctrl 1',run:()=>switchLanguage('en')},{name:'Switch to Persian',keys:'Ctrl 2',run:()=>switchLanguage('fa')},
    {name:'Open progress',keys:'Ctrl D',run:()=>routeTo('progress')},{name:'Open text library',keys:'Ctrl L',run:()=>routeTo('library')},{name:'Open AI practice studio',keys:'Ctrl G',run:()=>routeTo('ai')},{name:'Open keyboard calibration',keys:'settings',run:()=>routeTo('settings')},{name:'Toggle focus mode',keys:'F',run:()=>{settings.focusMode=!settings.focusMode;persistSettings();}}
  ];
  openModal(`<div class="command"><input id="cmd-input" class="command-input" placeholder="Type a command…" autofocus><div id="cmd-list" class="command-list"></div></div>`,modal=>{
    const input=modal.querySelector('#cmd-input'),list=modal.querySelector('#cmd-list');let filtered=commands,active=0;
    const draw=()=>{list.innerHTML=filtered.map((c,i)=>`<button class="command-item ${i===active?'active':''}" data-cmd="${i}"><span>${esc(c.name)}</span><kbd>${esc(c.keys)}</kbd></button>`).join('');list.querySelectorAll('[data-cmd]').forEach(b=>b.onclick=()=>run(Number(b.dataset.cmd)));};
    const run=i=>{const c=filtered[i];if(!c)return;closeModal();c.run();};
    input.oninput=()=>{const q=input.value.toLowerCase();filtered=commands.filter(c=>c.name.toLowerCase().includes(q)||c.keys.toLowerCase().includes(q));active=0;draw();};input.onkeydown=e=>{if(e.key==='ArrowDown'){e.preventDefault();active=Math.min(filtered.length-1,active+1);draw();}else if(e.key==='ArrowUp'){e.preventDefault();active=Math.max(0,active-1);draw();}else if(e.key==='Enter'){e.preventDefault();run(active);}else if(e.key==='Escape')closeModal();};draw();setTimeout(()=>input.focus(),0);
  });
}
async function switchLanguage(lang){settings.language=lang;progressFilter=lang;practiceState.currentText=null;persistSettings();closeModal();routeTo('practice',{fresh:true});}

function globalShortcuts(e){
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCommandPalette();return;}
  if((e.ctrlKey||e.metaKey)&&e.key==='1'){e.preventDefault();switchLanguage('en');return;}
  if((e.ctrlKey||e.metaKey)&&e.key==='2'){e.preventDefault();switchLanguage('fa');return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='d'){e.preventDefault();routeTo('progress');return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='l'){e.preventDefault();routeTo('library');return;}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='g'){e.preventDefault();routeTo('ai');return;}
}

for(const b of document.querySelectorAll('[data-route]'))b.onclick=()=>routeTo(b.dataset.route);
document.querySelector('#language-quick').onclick=()=>switchLanguage(settings.language==='en'?'fa':'en');
document.addEventListener('keydown',primeAudioFromGesture,{capture:true});
document.addEventListener('pointerdown',primeAudioFromGesture,{capture:true});
document.addEventListener('keydown',globalShortcuts);
await loadRuntimeInfo();
applyAppearance();
await setupWindowButtons();
await routeTo('practice');
warmAudioLater({soundEnabled:settings.soundEnabled,soundVolume:settings.soundVolume,keyClickSounds:settings.keySounds,soundProfile:settings.soundProfile});

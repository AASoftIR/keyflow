import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { BUILTIN_TEXTS, TOPICS } from './data/builtin-texts.js';
import { loadSettings, saveSettings, getSessions, getRecentSessions, saveSession, getCustomTexts, saveText, deleteText, loadProviderConfig, saveProviderConfig, clearProviderKey, loadProgression, saveProgression } from './core/storage.js';
import { sanitizePracticeText, cleanImportedText, normalizeForComparison, graphemes } from './core/normalization.js';
import { KeyboardMapper, LAYOUTS, formatChord, fingerForCode } from './core/layouts.js';
import { printablePracticeKey, TypingEngine } from './core/typing-engine.js';
import { aggregateSessions, buildAdaptiveText, fatigueCurve } from './core/stats.js';
import { pickFreshText, pickFreshPassage, targetCharacters, deckAvailability, commitPassageExposure, reconcileLegacyExposures } from './core/shuffle-bag.js';
import { validatePracticeContent } from './core/content-validator.js';
import { PROVIDERS, listProviderModels, pickRecommendedModel, testAiTransport, fallbackModels, providerChat } from './ai/providers.js';
import { generatePracticeText, buildPortablePrompt } from './ai/generator.js';
import { parseGeneratedJson } from './core/content-validator.js';
import { getCredential, setCredential, removeCredential, credentialStorageMode } from './core/credentials.js';
import { perPassageHistory } from './core/library-analytics.js';
import { stageEvidence, nextEarnedStage } from './core/mastery.js';
import { warmAudioLater, applyAudioSettings, playFeedback, testAudio, getAudioStatus, primeAudioFromGesture } from './audio/audio.js';
import { KeyboardView } from './ui/keyboard.js';
import { drawLineChart, drawBars } from './ui/charts.js';
import { profileForLanguage, rankForXp, rankProgress, updateProgression, recommendedDifficulty, curriculumFor } from './core/progression.js';
import { paceGhost, mistakeMicroscope, errorTimeline, compareSession, dailyQuests } from './core/insights.js';
import { segmentForCursor, typingFontScale } from './core/viewport.js';
import { normalizeSprintSeconds,timeRemaining,milestoneSummary,wordBoundaries,wordHorizon,recommendRecovery,bookmarkKey,boundedBookmarks } from './core/practice-lab.js';
import { getSeenState,saveJson,loadJson,mergeBackupRecords } from './core/storage.js';
import {recordReview,dueReviews,completedSourceIds} from './next/review.js';
import {buildPersonalGhost,personalGhostAt,findPersonalBest} from './next/ghost.js';
import {errorDNA,repairDrill} from './next/forensics.js';
import {FatigueRadar} from './next/fatigue.js';
import {CODE_WORKOUTS,codeWorkout} from './next/code-fluency.js';
import {beginCircuit,advanceCircuit,circuitNextPassage} from './next/circuit.js';
import {createBackup,validateBackup,VAULT_STORAGE_KEYS} from './next/vault.js';
import {makeCheckpoint,validCheckpoint,CHECKPOINT_KEY} from './next/checkpoint.js';

let settings=loadSettings();
let progression=loadProgression();
let route='practice';
let routeSerial=0;
let cleanup=()=>{};
let practiceState={level:Math.max(1,Math.min(5,Number(settings.stageByLanguage?.[settings.language])||3)),mode:'text',currentText:null};
let progressFilter=settings.language;
let generatedDraft=null;
let circuitState=loadJson('keyflow.circuit',null);
let calibrationTimer=0;
let customTextCache=null;
let lastProviderModels=[];
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
const getCustomTextsCached=async()=>{if(customTextCache)return customTextCache;customTextCache=getCustomTexts().then(rows=>{customTextCache=rows;return rows;}).catch(error=>{customTextCache=null;console.warn('Local text library temporarily unavailable:',error);return [];});return customTextCache;};
const invalidateCustomTextCache=()=>{customTextCache=null;};

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
  document.body.classList.toggle('zen-practice',!!settings.zenPractice && route==='practice');
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
  // Dismiss completion/loading modals before switching routes, including slow DB saves.
  closeModal();
  const serial=++routeSerial;
  cleanup?.(); cleanup=()=>{};
  route=next;
  document.querySelectorAll('[data-route]').forEach(b=>b.classList.toggle('active',b.dataset.route===next));
  const labels={practice:'Practice',progress:'Progress',library:'Text library',ai:'AI studio',lab:'Training lab',settings:'Settings'};
  contextLabel.textContent=labels[next]||next;
  view.scrollTop=0;
  // Render a visible, responsive shell BEFORE awaiting local history/database.
  // KDE/WebKitGTK can need time to open IndexedDB after app launch; leaving
  // the previous practice screen in place made this look like a UI freeze.
  if(next==='practice' && (opts.fresh || !opts.text)){
    view.innerHTML='<div class="practice-loading" role="status" aria-live="polite"><strong>Preparing practice…</strong><span>Loading your passage without blocking input.</span></div>';
  }
  let dispose;
  if(next==='practice') dispose=await renderPractice(opts,serial);
  else if(next==='progress') dispose=await renderProgress(serial);
  else if(next==='library') dispose=await renderLibrary(serial);
  else if(next==='ai') dispose=await renderAi(serial);
  else if(next==='lab') dispose=await renderLab(serial);
  else dispose=await renderSettings();
  if(serial!==routeSerial){dispose?.();return;}
  cleanup=dispose||(()=>{});
  view.focus({preventScroll:true});
}

async function selectPracticeText({language=settings.language,level=practiceState.level,mode=practiceState.mode,fastStart=false,allowRepeats=false}={}){
  // Cold launch must not wait for an IndexedDB open/upgrade. Built-in material
  // is already available synchronously; user texts join the deck later.
  const custom=fastStart?[]:await getCustomTextsCached();
  const pool=[...BUILTIN_TEXTS,...custom];
  const target=targetCharacters(level,settings.sessionLength);
  if(mode==='weak'){
    const aggregate=aggregateSessions(await getRecentSessions({language,limit:140}),language);
    return {id:`adaptive-${Date.now()}`,language,level,title:language==='fa'?'تمرین تطبیقی ضعف‌ها':'Adaptive weakness drill',source:'adaptive',tags:['adaptive'],text:buildAdaptiveText(aggregate,language,target)};
  }
  if(mode==='rhythm'){
    const aggregate=aggregateSessions(await getRecentSessions({language,limit:140}),language);
    return makeRhythmText(aggregate,language,level,target);
  }
  const tag=mode==='punctuation'?(language==='fa'?'نشانه':'punctuation'):mode==='numbers'?(language==='fa'?'اعداد':'numbers'):null;
  if(tag){
    const focused=pickFreshPassage(pool,{language,level,recentWindow:settings.recentWindow,cooldownDays:settings.freshnessDays,lengthMode:settings.sessionLength,targetChars:Math.min(target,520),tag,allowRepeats,record:false});
    const rest=pickFreshPassage(pool,{language,level,recentWindow:settings.recentWindow,cooldownDays:settings.freshnessDays,lengthMode:settings.sessionLength,targetChars:Math.max(220,target-(focused?.text?.length||0)),excludeIds:focused?.sourceIds||[focused?.id].filter(Boolean),allowRepeats,record:false});
    if(focused&&rest&&focused.id!==rest.id){
      const separator='\n\n',shift=focused.text.length+separator.length;
      return {...focused,id:`${focused.id}+${rest.id}`,title:`${focused.title} + ${rest.title}`,source:'smart-deck',text:`${focused.text}${separator}${rest.text}`,
        sourceIds:[...new Set([...(focused.sourceIds||[]),...(rest.sourceIds||[])])],
        sourceParts:[...(focused.sourceParts||[]),...(rest.sourceParts||[]).map(p=>({...p,start:p.start+shift,end:p.end+shift}))]};
    }
    if(focused) return focused;
  }
  let picked=pickFreshPassage(pool,{language,level,recentWindow:settings.recentWindow,cooldownDays:settings.freshnessDays,lengthMode:settings.sessionLength,targetChars:target,allowRepeats,record:false});
  // The fast-start deck uses bundled texts to avoid IndexedDB startup delays.
  // When its fresh pool is empty, expand to personal/AI texts instead of
  // silently returning to an older bundled paragraph.
  if(!picked && fastStart){
    const extra=await getCustomTextsCached();
    if(extra.length)picked=pickFreshPassage([...BUILTIN_TEXTS,...extra],{language,level,recentWindow:settings.recentWindow,cooldownDays:settings.freshnessDays,lengthMode:settings.sessionLength,targetChars:target,allowRepeats,record:false});
  }
  if(!picked && !allowRepeats){
    try{
      const sessions=await getRecentSessions({language,limit:2500});
      const repaired=reconcileLegacyExposures(sessions,[...pool,...(fastStart?await getCustomTextsCached():[])],language);
      if(repaired.changed){
        const expanded=fastStart?[...BUILTIN_TEXTS,...await getCustomTextsCached()]:pool;
        picked=pickFreshPassage(expanded,{language,level,cooldownDays:settings.freshnessDays,lengthMode:settings.sessionLength,targetChars:target,record:false});
        if(repaired.restored>0)toast(`Recovered ${repaired.restored} texts that were shown but not practiced.`, 'success',6000);
      }
    }catch(error){console.warn('Legacy text usage reconciliation unavailable:',error);}
  }
  return picked;
}

function makeRhythmText(aggregate,language,level,length=650){
  const weak=aggregate.weakPairs.slice(0,7).map(x=>x.pair).filter(Boolean);
  if(language==='fa'){
    const core=weak.length?weak.join('، '):'تا، را، من، که، در';
    const parts=[`${core}. ریتم را ثابت نگه دار و بین واژه‌ها مکث اضافه نکن.`,`هر حرکت را سبک و کوتاه انجام بده و پس از هر کلید انگشت را به جای طبیعی خود برگردان.`,`اگر یک گذار دشوار شد، سرعت را کمی کم کن اما ضرباهنگ را نشکن. ${core}.`,`هدف این بخش سرعت لحظه‌ای نیست؛ هدف ساختن حرکت یکنواختی است که در متن طولانی هم باقی بماند.`];
    let text='';let i=0;while(text.length<length){text+=(text?' ':'')+parts[i++%parts.length];}
    return {id:`rhythm-${Date.now()}`,language,level,title:'ریتم و گذار',source:'adaptive',tags:['rhythm'],text:text.slice(0,length).trim()};
  }
  const core=weak.length?weak.join(', '):'th, he, in, er, an';
  const parts=[`${core}. Keep the beat even and do not rush the spaces.`,`Make every movement light, short, and repeatable. Let each finger return naturally before the next transition.`,`When a pair feels awkward, slow it down without breaking the beat, then place it back into normal words: ${core}.`,`The goal is not one fast burst; it is a rhythm that survives a longer passage.`];
  let text='';let i=0;while(text.length<length){text+=(text?' ':'')+parts[i++%parts.length];}
  return {id:`rhythm-${Date.now()}`,language,level,title:'Rhythm transitions',source:'adaptive',tags:['rhythm'],text:text.slice(0,length).trim()};
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

function saveCircuit(value){circuitState=value;saveJson('keyflow.circuit',value);}
async function launchCircuit(){
  let passage=await selectPracticeText({allowRepeats:true,mode:'text'});
  if(!passage){toast('Add a practice passage first.','error');return;}
  saveCircuit(beginCircuit(passage));
  routeTo('practice',{text:circuitNextPassage(circuitState),mode:'text'});
}
function openDNA(sessions,language=settings.language){
  const dna=errorDNA(sessions,{language});
  openModal(`<div class="eyebrow">Error DNA · actual keystrokes</div><h2>Your confusion fingerprint</h2><p class="muted">Wrong key pairs are tracked separately from slow-but-correct keys. Repeated problems are more useful than a single mistake.</p><h3>Wrong key → expected key</h3><div class="data-list">${dna.confusions.map(x=>`<div class="data-row"><strong dir="auto">${esc(x.actual===' '?'␠':x.actual||'—')} → ${esc(x.expected===' '?'␠':x.expected)}</strong><span>${x.count} mistakes</span></div>`).join('')||'<p class="muted">No incorrect keystrokes recorded.</p>'}</div><h3>Slow keys (3+ observations)</h3><div class="data-list">${dna.slowKeys.slice(0,8).map(x=>`<div class="data-row"><strong dir="auto">${esc(x.key)}</strong><span>${x.averageMs} ms average</span><span>${x.count} samples</span></div>`).join('')||'<p class="muted">Type more sessions for reliable timings.</p>'}</div><div class="head-actions"><button class="btn primary" id="dna-train" ${repairDrill(dna,language)?'':'disabled'}>Train real trouble words</button></div>`,modal=>{
    modal.querySelector('#dna-train').onclick=()=>{const text=repairDrill(dna,language);if(text){closeModal();routeTo('practice',{text:{id:`dna-${Date.now()}`,title:'Error DNA · repair',language,level:3,text,source:'dna'}});}};
  });
}
async function openVault(){
  openModal(`<div class="eyebrow">Data Vault · offline</div><h2>Own your progress</h2><p>Export practice history, custom passages, bookmarks, progression and review schedule. Native wallet API keys and proxy credentials are deliberately excluded.</p><div class="head-actions"><button id="vault-export" class="btn primary">Export full backup</button><button id="vault-import" class="btn">Import + merge backup</button><input id="vault-file" type="file" accept=".json,application/json" hidden></div><div id="vault-state" class="status-line" role="status"></div><p class="muted small">Import merges by record ID without deleting current data. Settings and local progress are only replaced with your confirmation.</p>`,modal=>{
    const status=modal.querySelector('#vault-state');
    modal.querySelector('#vault-export').onclick=async()=>{
      status.textContent='Preparing local backup…';
      try{
        const [sessions,texts]=await Promise.all([getSessions(),getCustomTextsCached()]);
        const local=Object.fromEntries(VAULT_STORAGE_KEYS.map(k=>[k,loadJson(k,null)]));
        const backup=createBackup({settings,sessions,texts,local});
        const blob=new Blob([JSON.stringify(backup)],{type:'application/json'});
        const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`keyflow-vault-${localDateKey(Date.now())}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),15000);
        status.textContent=`Exported ${sessions.length} sessions and ${texts.length} personal passages (no API keys).`;
      }catch(error){status.textContent=`Export error: ${error.message}`;}
    };
    modal.querySelector('#vault-import').onclick=()=>modal.querySelector('#vault-file').click();
    modal.querySelector('#vault-file').onchange=async e=>{
      const file=e.target.files?.[0];if(!file)return;
      if(file.size>30*1024*1024){status.textContent='Backup is larger than the 30 MB safety limit.';return;}
      try{
        const data=validateBackup(JSON.parse(await file.text()));
        status.textContent=`Validated ${data.sessions.length} runs and ${data.texts.length} passages. Importing…`;
        const counts=await mergeBackupRecords(data.sessions,data.texts);
        invalidateCustomTextCache();
        if(confirm('Also restore the backed-up app preferences, spaced reviews, bookmarks and circuit? Existing data will be preserved where absent. API keys will stay unchanged.')){
          settings=loadSettings();Object.assign(settings,data.settings);persistSettings();
          for(const key of VAULT_STORAGE_KEYS)if(Object.hasOwn(data.preferences,key)&&data.preferences[key]!==null)saveJson(key,data.preferences[key]);
          progression=loadProgression();circuitState=loadJson('keyflow.circuit',null);
        }
        status.textContent=`Imported ${counts.sessions} new sessions and ${counts.texts} new passages. Existing records retained.`;
      }catch(error){status.textContent=`Import error: ${error.message}`;}
    };
  });
}

async function renderPractice(opts={},serial=routeSerial){
  if(opts.text){practiceState.currentText=opts.text;settings.language=opts.text.language||settings.language;persistSettings();}
  if(opts.mode)practiceState.mode=opts.mode;
  if(!practiceState.currentText||practiceState.currentText.language!==settings.language||opts.fresh){
    const picked=await selectPracticeText({fastStart:!!opts.fastStart,allowRepeats:!!opts.allowRepeats});
    if(serial!==routeSerial)return;
    practiceState.currentText=picked;
  }
  const original=practiceState.currentText;
  if(!original){
    const custom=await getCustomTextsCached();if(serial!==routeSerial)return;
    const available=deckAvailability([...BUILTIN_TEXTS,...custom],{language:settings.language,level:practiceState.level,cooldownDays:settings.freshnessDays});
    view.innerHTML=`<section class="panel fresh-empty" role="status"><div class="eyebrow">Fresh-only mode · ${settings.freshnessDays}-day protection</div><h2>You've practiced all available fresh material.</h2><p>${available.used} of ${available.total} unique passages have already been shown recently. Keyflow will not secretly recycle yesterday's text. Add a new passage, generate one with AI, or explicitly choose a replay.</p><div class="head-actions"><button class="btn primary" id="new-ai-content">Generate new AI text</button><button class="btn" id="new-library-content">Import text</button><button class="btn ghost" id="allow-old-text">Replay an older passage</button></div></section>`;
    document.querySelector('#new-ai-content').onclick=()=>routeTo('ai');
    document.querySelector('#new-library-content').onclick=()=>routeTo('library');
    document.querySelector('#allow-old-text').onclick=()=>routeTo('practice',{fresh:true,allowRepeats:true});
    return;
  }
  const text={...original,text:sanitizePracticeText(original.text,{language:settings.language,allowDiacritics:settings.allowPersianDiacritics})};
  if(text.freshHistorySaved===false)toast('Local storage is unavailable: anti-repeat history may not survive a restart.','error',7000);
  const mapper=layoutMapper(settings.language);
  const validation=validatePracticeContent(text.text,{language:settings.language,layoutId:currentLayoutId(settings.language),calibration:currentCalibration(settings.language),allowDiacritics:settings.allowPersianDiacritics,minLength:20});
  const dir=settings.language==='fa'?'rtl':'ltr';
  const targetWpm=settings.language==='fa'?settings.persianTargetWpm:settings.englishTargetWpm;
  const profile=profileForLanguage(progression,settings.language);const rankInfo=rankProgress(profile);
  view.innerHTML=`<div class="practice-wrap">
    <div class="practice-toolbar panel">
      <div class="segmented"><button data-lang="en" class="${settings.language==='en'?'active':''}">EN</button><button data-lang="fa" class="${settings.language==='fa'?'active':''}">فا</button></div>
      <span class="toolbar-sep"></span>
      <label class="tiny dim">MODE</label><select id="practice-mode" class="select"><option value="text">Text</option><option value="weak">Weak-key drill</option><option value="rhythm">Rhythm lab</option><option value="punctuation">Punctuation</option><option value="numbers">Numbers & symbols</option></select>
      <label class="tiny dim">LEVEL</label><select id="practice-level" class="select">${[1,2,3,4,5].map(x=>`<option value="${x}">${x}</option>`).join('')}</select>
      <label class="tiny dim">LENGTH</label><select id="practice-length" class="select"><option value="standard">Standard</option><option value="long">Long</option><option value="endurance">Endurance</option></select>
      <label class="tiny dim">SPRINT</label><select id="practice-sprint" class="select"><option value="0">Untimed</option><option value="60">1 min</option><option value="180">3 min</option><option value="300">5 min</option></select>
      <span class="pill rank-pill" title="XP rank measures participation; the 1–5 skill tier is earned by consistent performance.">XP rank ${rankInfo.rank.rank} · ${esc(rankInfo.rank.name)}</span>
      <div class="spacer"></div>
      <button id="zen-practice" class="btn ghost small-btn" title="Hide distracting metrics while typing">${settings.zenPractice?'Exit Zen':'Zen'}</button>
      <button id="accuracy-lock" class="btn ghost small-btn" title="Do not advance after a wrong key">Accuracy lock ${settings.strictAccuracy?'ON':'OFF'}</button>
      <button id="pause-toggle" class="btn ghost small-btn" title="Pause and resume without changing the score clock">Take a break</button><button id="focus-toggle" class="btn ghost small-btn">${settings.focusMode?'Exit focus':'Focus'}</button>
      <button id="retry-text" class="btn ghost small-btn">Retry</button>
      <button id="new-text" class="btn primary">New text</button>
    </div>
    ${validCheckpoint(loadJson(CHECKPOINT_KEY,null))&&!opts.checkpoint?'<div class="resumable-banner panel"><span>◷ An interrupted practice is saved locally.</span><div><button class="btn primary small-btn" id="resume-saved">Resume exactly where I stopped</button><button class="btn ghost small-btn" id="discard-saved">Discard</button></div></div>':''}
    <section class="metrics metrics-eight">
      <div class="metric"><strong id="m-wpm">0</strong><span>WPM</span></div>
      <div class="metric"><strong id="m-burst">0</strong><span>burst</span></div>
      <div class="metric"><strong id="m-acc">100%</strong><span>Accuracy</span></div>
      <div class="metric"><strong id="m-cons">100%</strong><span>Consistency</span></div>
      <div class="metric"><strong id="m-errors">0</strong><span>Errors</span></div>
      <div class="metric"><strong id="m-latency">0 ms</strong><span>input p95</span></div>
      <div class="metric"><strong id="m-target">warm-up</strong><span>vs target ${targetWpm}</span></div>
      <div class="metric"><strong id="m-time">00:00</strong><span>active time</span></div>
    </section>
    <section class="typing-card panel" id="typing-card">
      <div class="typing-meta"><span>${esc(text.title)} · ${esc(text.source||'builtin')} · level ${esc(text.level||practiceState.level)} · ${text.text.length} chars</span><span>${langName(settings.language)} · ${esc(LAYOUTS[currentLayoutId(settings.language)]?.label||'layout')}</span></div>
      ${text.freshSelection===false?'<div class="inline-good">You chose a deliberate replay; this passage may be familiar.</div>':''}
      ${text.shortfallChars>0?`<div class="fresh-notice">Fresh-only deck: ${text.shortfallChars} characters below the requested length. Keyflow prefers a shorter new passage over recycling an old one.</div>`:''}
      ${!validation.ok?`<div class="inline-error" style="margin-bottom:14px">Content health ${validation.health}/100 — ${esc(validation.issues.join(' '))}</div>`:''}
      <div class="practice-coach-row">
        <span class="coach-chip">Finger <strong id="next-finger">—</strong></span>
        <span class="coach-chip">Clean streak <strong id="clean-streak">0</strong></span><span class="coach-chip">Fatigue radar <strong id="fatigue-radar">Building baseline</strong></span><span class="coach-chip">Estimated finish <strong id="finish-eta">—</strong></span><span class="coach-chip">Target pace <strong id="pace-status">ready</strong></span>
        <span class="coach-chip">XP <strong>${profile.xp||0}</strong> · ${Math.round(rankInfo.progress*100)}%</span>
        <span class="coach-chip ${settings.language==='fa'?'good':''}">Renderer <strong>${settings.language==='fa'?'Persian safe':'standard'}</strong></span>
        <span id="audio-runtime" class="coach-chip audio-runtime">Cuelume <strong>${getAudioStatus().state}</strong></span>
      </div>
      <nav class="reading-tools" aria-label="Practice passage navigation">
        <div class="reading-group">
          <button id="read-follow" aria-pressed="${settings.followCursor!==false}" title="Keep the active character in view">${settings.followCursor!==false?'● Auto-follow':'○ Auto-follow'}</button>
          <button id="read-home" title="Jump back to the current typing position">↳ Current key</button>
          <button id="read-up" title="Browse the previous page">↑ Previous</button>
          <button id="read-down" title="Browse the next page">↓ Next</button>
        </div>
        <div class="reading-group">
          <span id="segment-status" class="reading-status">Part <strong>1</strong> / 1 · 0%</span>
          <button id="read-zoom-out" aria-label="Smaller passage text">A−</button>
          <button id="read-zoom-in" aria-label="Larger passage text">A+</button>
        </div>
      </nav>
      <div class="practice-insights" aria-live="off"><button id="ghost-toggle" title="Compare yourself with a previous completed run on this exact text">PB ghost: looking up…</button><span id="word-horizon">Words remaining: —</span><span id="sprint-status">Untimed practice</span><span id="fresh-pool-status" class="fresh-count" title="New material not shown during the last 21 days">Fresh pool · —</span><span id="precision-coach">Building rhythm</span><button id="bookmark-text" title="Save this passage for later">☆ Save passage</button></div>
      <div id="typing-text" class="typing-text ${settings.language==='fa'?'rtl':''}" dir="${dir}" tabindex="0" role="region" aria-label="Practice passage; scroll to browse"></div>
      <div class="milestone-track" id="milestone-track" aria-label="Live eight-part precision map">${Array.from({length:8},()=>'<span class="milestone"></span>').join('')}</div><div class="milestone-label" id="milestone-label">Eight-part precision map · sections update as you type</div>
      <div class="typing-progress-track ${settings.language==='fa'?'rtl':''}" aria-hidden="true"><i id="typing-progress-fill"></i><b id="typing-ghost" title="Position at target WPM"></b></div>
      <div class="live-keys" dir="auto"><span>INPUT RECEIVED</span><strong id="live-key-trace" aria-live="off">Start typing to see your keystrokes…</strong></div>
      <div id="mistake-feedback" class="mistake-feedback" role="status" aria-live="polite" aria-atomic="true" hidden><span class="mistake-feedback-label">Incorrect key</span><span class="mistake-values"><span>Pressed <strong id="mistake-typed" dir="auto">—</strong></span><span class="mistake-arrow">≠</span><span>Expected <strong id="mistake-expected" dir="auto">—</strong></span></span><button type="button" id="mistake-dismiss" title="Dismiss mistake alert" aria-label="Dismiss mistake alert">×</button></div>
      <div class="typing-bottom">
        <div class="legend"><span><i style="background:var(--good)"></i>correct</span><span><i style="background:var(--accent)"></i>current</span><span><i style="background:var(--bad)"></i>mistake</span><button id="audio-coach" class="audio-coach ${settings.soundEnabled?'on':''}" title="Click to hear the coaching cues"><span class="dot"></span><strong>Audio coach ${settings.soundEnabled?'ON':'OFF'}</strong><span>${settings.soundEnabled?(settings.keySounds?'soft key · word · error':'word · error'):'click to enable'}</span></button></div>
        <div class="typing-hint"><span class="tiny dim">NEXT</span><span id="next-char" class="next-char">—</span><strong id="next-chord">—</strong><span id="hint-source" class="hint-source"></span></div>
      </div>
    </section>
    <section class="keyboard-panel panel">
      <div class="key-summary"><span>Physical key hint uses <strong>KeyboardEvent.code</strong></span><span id="mapping-status">Profile + self-learning</span><span>${settings.showWeakKeyHeatmap!==false?'heatmap loads after first paint · ':''}special marks: ${settings.allowPersianDiacritics?'enabled':'filtered'}</span></div>
      <div id="keyboard" class="keyboard"></div>
    </section>
  </div>`;
  document.querySelector('#practice-mode').value=practiceState.mode;document.querySelector('#practice-level').value=String(practiceState.level);document.querySelector('#practice-length').value=settings.sessionLength||'long';document.querySelector('#practice-sprint').value=String(settings.sprintSeconds||0);
  const keyboard=new KeyboardView(document.querySelector('#keyboard'),mapper);
  const engine=new TypingEngine({language:settings.language,strictAccuracy:settings.strictAccuracy,mapper,onFeedback:playFeedback});
  const textViewport=document.querySelector('#typing-text');
  if(text.source==='code')textViewport.classList.add('code-fluency');
  textViewport.style.setProperty('--typing-font-size',`${Math.round((settings.language==='fa'?29:28)*typingFontScale(settings.textScale))}px`);
  engine.setText(text.text,{...text,mode:practiceState.mode});engine.mount(textViewport);
  if(opts.checkpoint){
    if(engine.restore(opts.checkpoint.engine))toast('Previous cursor, mistakes, and active time restored.','success',5000);
    else toast('Saved checkpoint could not be restored; starting normally.','error');
  }
  const resumeBtn=document.querySelector('#resume-saved');
  if(resumeBtn)resumeBtn.onclick=()=>{const saved=loadJson(CHECKPOINT_KEY,null);if(validCheckpoint(saved)){routeTo('practice',{text:saved.passage,checkpoint:saved});}};
  const discardBtn=document.querySelector('#discard-saved');
  if(discardBtn)discardBtn.onclick=()=>{localStorage.removeItem(CHECKPOINT_KEY);discardBtn.closest('.resumable-banner')?.remove();toast('Saved interruption discarded.');};
  // A long/mixed deck spends ONLY the source section actually reached by
  // typing. Unvisited chapters remain fresh even if the user exits early.
  let nextUnvisitedPart=0;
  const parts=text.sourceParts?.length?text.sourceParts:[{id:text.id,text:text.text,start:0,end:text.text.length}];
  engine.addEventListener('attempt',e=>{
    while(nextUnvisitedPart<parts.length && e.detail.index>=parts[nextUnvisitedPart].start){
      const part=parts[nextUnvisitedPart++];
      if(e.detail.index>=part.end)continue;
      setTimeout(()=>{
        if(!commitPassageExposure({...text,sourceParts:[part]}))toast('Could not save passage usage history.','error',5000);
      },0);
    }
  });
  engine.setFollowCursor(settings.followCursor!==false);
  const firstSegment=segmentForCursor(0,engine.chars.length);
  document.querySelector('#segment-status').innerHTML=`Part <strong>1</strong> / ${firstSegment.count} · 0%`;
  const horizonWords=wordBoundaries(engine.chars);
  const sectionAttempts=new Uint32Array(8),sectionErrors=new Uint32Array(8);
  let lastSectionPaint=0,lastSprintPaint=0;
  const milestones=[...document.querySelectorAll('#milestone-track .milestone')];
  const wordStatus=document.querySelector('#word-horizon'),sprintStatus=document.querySelector('#sprint-status'),precisionStatus=document.querySelector('#precision-coach');
  const refreshFreshStatus=()=>{const pool=[...BUILTIN_TEXTS,...(Array.isArray(customTextCache)?customTextCache:[])];const fresh=deckAvailability(pool,{language:settings.language,level:practiceState.level,cooldownDays:settings.freshnessDays});const target=document.querySelector('#fresh-pool-status');if(target)target.textContent=`Fresh texts · ${fresh.fresh}/${fresh.total} · ${fresh.days}d protected`;};
  // A catalogue scan with near-duplicate checks is deferred until after
  // the keyboard has become interactive. It never runs mid-keypress.
  const initialFreshTimer=setTimeout(()=>{if(!engine.startedAt && !disposed)refreshFreshStatus();},900);
  const updateMilestones=(index,total)=>{const rows=milestoneSummary(sectionAttempts,sectionErrors,index,total);rows.forEach((x,i)=>{milestones[i].className='milestone'+(x.completed?' done':'')+(x.active?' active':'')+(x.attempts>=8&&x.accuracy<80?' weak':'');milestones[i].title=`Section ${i+1}: ${x.attempts} keys, ${x.errors} errors${x.accuracy===null?'':`, ${x.accuracy}% accuracy`}`;});};
  const updateWordStatus=index=>{const h=wordHorizon(horizonWords,index);wordStatus.textContent=`Word ${h.position}/${h.total} · ${h.remaining} left${h.next?' · Next: '+h.next:''}`;wordStatus.dir=settings.language==='fa'?'rtl':'ltr';};
  const ui={segment:document.querySelector('#segment-status'),follow:document.querySelector('#read-follow'),nextChar:document.querySelector('#next-char'),nextChord:document.querySelector('#next-chord'),hintSource:document.querySelector('#hint-source'),wpm:document.querySelector('#m-wpm'),burst:document.querySelector('#m-burst'),acc:document.querySelector('#m-acc'),cons:document.querySelector('#m-cons'),errors:document.querySelector('#m-errors'),latency:document.querySelector('#m-latency'),time:document.querySelector('#m-time'),target:document.querySelector('#m-target'),finger:document.querySelector('#next-finger'),streak:document.querySelector('#clean-streak'),audioRuntime:document.querySelector('#audio-runtime'),progressFill:document.querySelector('#typing-progress-fill'),ghost:document.querySelector('#typing-ghost'),eta:document.querySelector('#finish-eta'),pace:document.querySelector('#pace-status')};
  const updateHint=(char,hint)=>{ui.nextChar.textContent=char===' '?'␠':char||'✓';ui.nextChord.textContent=hint?formatChord(hint):char?'Learn / calibrate':'Complete';ui.hintSource.textContent=hint?.confidence==='learned'?'learned from this keyboard':hint?'layout profile':'no mapping';ui.finger.textContent=hint?.code?fingerForCode(hint.code):'—';keyboard.highlight(hint);};
  updateHint(engine.chars[engine.index],mapper.hintFor(engine.chars[engine.index],settings.language));
  if(opts.checkpoint){
    for(const e of engine.events){
      if(e.type!=='key')continue;
      const bucket=Math.min(7,Math.floor(e.index/Math.max(1,engine.chars.length)*8));
      sectionAttempts[bucket]++;if(!e.correct)sectionErrors[bucket]++;
    }
  }
  updateWordStatus(engine.index);updateMilestones(engine.index,engine.chars.length);
  let disposed=false,hintRaf=0,lastHint=null,lastPracticeInput=0;
  const onNext=e=>{lastPracticeInput=performance.now();lastHint=e.detail;updateWordStatus(e.detail.index);if(hintRaf)return;hintRaf=requestAnimationFrame(()=>{hintRaf=0;if(lastHint)updateHint(lastHint.character,lastHint.hint);});};
  let bestGhost=null,ghostActive=loadJson('keyflow.ghost-enabled',true)!==false;
  const ghostToggle=document.querySelector('#ghost-toggle');
  const refreshGhostLabel=()=>{ghostToggle.textContent=!bestGhost?'PB ghost · no record yet':`PB ghost ${ghostActive?'ON':'OFF'} · ${Math.round(bestGhost.wpm)} WPM`;ghostToggle.disabled=!bestGhost;};
  refreshGhostLabel();
  ghostToggle.onclick=()=>{ghostActive=!ghostActive;saveJson('keyflow.ghost-enabled',ghostActive);refreshGhostLabel();};
  setTimeout(async()=>{
    try{const historical=await getRecentSessions({language:settings.language,limit:300});if(disposed)return;bestGhost=findPersonalBest(historical,text);refreshGhostLabel();}
    catch(error){console.warn('Personal best lookup skipped:',error);}
  },150);
  const onProgress=e=>{const d=e.detail;ui.wpm.textContent=Math.round(d.wpm);ui.burst.textContent=Math.round(d.burstWpm||0);ui.acc.textContent=`${Math.round(d.accuracy)}%`;ui.errors.textContent=d.errors;ui.cons.textContent=`${Math.round(d.consistency)}%`;ui.streak.textContent=String(d.currentStreak||0);if(ui.progressFill)ui.progressFill.style.transform=`scaleX(${d.total?Math.min(1,d.index/d.total):0})`;ui.latency.textContent=`${d.inputDelayP95<1?d.inputDelayP95.toFixed(1):Math.round(d.inputDelayP95)} ms`;const sec=Math.floor(d.elapsed/1000);ui.time.textContent=`${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;const ghost=paceGhost({index:d.index,total:d.total,elapsedMs:d.elapsed,targetWpm});
    const rivalIndex=bestGhost&&ghostActive?personalGhostAt(bestGhost,d.elapsed):null;
    const targetPosition=rivalIndex===null?ghost.ghostPct:(d.total?Math.min(100,rivalIndex/d.total*100):0);
    if(settings.language==='fa'){ui.ghost.style.right=`${targetPosition}%`;ui.ghost.style.left='auto';}else{ui.ghost.style.left=`${targetPosition}%`;ui.ghost.style.right='auto';}
    ui.ghost.title=rivalIndex===null?'Position at target WPM':`Your previous best · ${Math.round(bestGhost.wpm)} WPM`;
    if(rivalIndex!==null)ui.pace.textContent=`${Math.abs(Math.round(d.index-rivalIndex))} chars ${d.index>=rivalIndex?'ahead of PB':'behind PB'}`;
    const segment=segmentForCursor(d.index,d.total);
    ui.segment.innerHTML=`Part <strong>${segment.section}</strong> / ${segment.count} · ${segment.progress}%`;
    ui.eta.textContent=ghost.secondsLeft==null?'after warm-up':`${Math.floor(ghost.secondsLeft/60)}m ${String(ghost.secondsLeft%60).padStart(2,'0')}s`;
    if(rivalIndex===null)ui.pace.textContent=ghost.behindChars>0?`${ghost.behindChars} chars behind`:'on target';
    const delta=d.wpm-targetWpm;ui.target.textContent=d.index<12?'warm-up':`${delta>=0?'+':''}${Math.round(delta)} WPM`;ui.target.className=delta>=0?'positive':'negative';};
  const updateAudioRuntime=()=>{const status=getAudioStatus();if(!ui.audioRuntime)return;ui.audioRuntime.classList.toggle('running',status.state==='active');ui.audioRuntime.classList.toggle('failed',!!status.lastError);ui.audioRuntime.innerHTML=`Cuelume <strong>${esc(status.lastError?'failed':status.state==='sent'?'cue requested (unverified)':status.state)}</strong> · ${esc(status.theme)} · ${Math.round(status.volume*100)}%`;};
  const onAudioStatus=()=>updateAudioRuntime();window.addEventListener('keyflow-audio-status',onAudioStatus);updateAudioRuntime();

  // Startup performance: render the practice UI and attach the key handler first.
  // Historical analytics and heatmap work happen after the first paint.
  let heatmapIdle=0;
  if(settings.showWeakKeyHeatmap!==false){
    const loadHeatmap=async()=>{try{const sessions=await getRecentSessions({language:settings.language,limit:140});if(disposed)return;keyboard.setHeatmap(aggregateSessions(sessions,settings.language).weakKeys);}catch{}};
    // Never force an expensive history/heatmap calculation while a user is
    // typing (old requestIdleCallback(timeout:1200) could interrupt input).
    const scheduleHeatmap=()=>{heatmapIdle=window.setTimeout(async()=>{
      if(disposed)return;
      if(engine.startedAt && !engine.paused && !engine.finished && performance.now()-lastPracticeInput<1700){scheduleHeatmap();return;}
      await loadHeatmap();
    },1800);};
    scheduleHeatmap();
  }

  const onFinish=async e=>{
    const s=e.detail;
    clearInterval(idleGuardian);clearInterval(sprintGuardian);
    // Feedback immediately; IndexedDB transactions can be slow on first launch.
    if(serial===routeSerial && !disposed){
      openModal(`<div class="eyebrow">${s.completionReason==='sprint'?'Sprint finished':'Session finished'}</div><h2>Preparing your session review…</h2><p class="muted">Calculating progress and saving your results locally.</p>`);
    }
    let saved=true;
    try{await saveSession(s);}catch(error){saved=false;console.error('Session storage failed:',error);toast('Session could not be saved: '+error.message,'error',6500);}
    if(saved)localStorage.removeItem(CHECKPOINT_KEY);
    let circuitAdvanced=false;
    if(saved){
      const usedIds=completedSourceIds(s);
      if(usedIds.length){let review=loadJson('keyflow.review',{});for(const id of usedIds)review=recordReview(review,id,s.summary);saveJson('keyflow.review',review);}
      if(circuitState?.step && circuitState.step!=='complete' && text.language===circuitState.language &&
         ((circuitState.step==='repair'&&text.source==='circuit')||(circuitState.step!=='repair'&&text.text===circuitState.passage?.text))){
        const next=advanceCircuit(circuitState,s,repairDrill(errorDNA([s],{language:s.language}),s.language));
        circuitAdvanced=next.step!==circuitState.step;saveCircuit(next);
      }
    }
    practiceState.currentText=null;
    if(saved && s.completionReason==='passage'){progression=updateProgression(progression,s.language,s.summary,targetWpm);saveProgression(progression);}
    const updatedProfile=profileForLanguage(progression,s.language),updatedRank=rankProgress(updatedProfile);
    const recentLang=await getRecentSessions({language:s.language,limit:120}).catch(()=>[]);
    if(serial!==routeSerial || disposed)return; // navigation while saving cannot reopen a stale completion modal
    const previous=recentLang.filter(x=>x.id!==s.id&&x.summary?.reliable).at(-1)||null;
    const comparison=compareSession(s,previous);
    const comparisonLabel=comparison?`<div class="session-delta"><strong>Compared with last valid run:</strong> ${comparison.wpmDelta>=0?'+':''}${fmt1(comparison.wpmDelta)} WPM · ${comparison.accuracyDelta>=0?'+':''}${fmt1(comparison.accuracyDelta)}% accuracy · ${comparison.consistencyDelta>=0?'+':''}${fmt1(comparison.consistencyDelta)}% consistency</div>`:'';
    const microscope=mistakeMicroscope(s);
    const previousBest=Math.max(0,...recentLang.filter(x=>x.id!==s.id&&x.summary?.reliable!==false).map(x=>Number(x.summary?.wpm)||0));
    const isPersonalBest=saved&&s.completionReason==='passage'&&!!s.summary.reliable&&s.summary.wpm>previousBest+.49;
    let levelNote='';
    if(settings.autoLevel!==false && s.completionReason==='passage'){
      const before=practiceState.level;
      const next=nextEarnedStage(recentLang,s.language,before,targetWpm);
      practiceState.level=next;
      settings.stageByLanguage||={};settings.stageByLanguage[s.language]=next;persistSettings();
      const evidence=stageEvidence(recentLang,s.language,before,targetWpm);
      levelNote=next!==before?`Skill tier ${next} unlocked with three qualifying sessions.`:`Tier ${before}: ${evidence.successes}/3 qualifying sessions (≥96% accuracy, ≥65% consistency, ≥${evidence.required} WPM).`;
    }
    const reliability=s.summary.reliable?'<span class="pill good">TIMING VALID</span>':'<span class="pill bad">TIMING ANOMALY · SPEED IGNORED</span>';
    const headline=s.summary.reliable?`${Math.round(s.summary.wpm)} WPM`:'Speed not scored';
    openModal(`<div class="eyebrow">${s.completionReason==='sprint'?'Timed sprint finished':'Session complete'} ${isPersonalBest?'· personal best':''}</div><h2>${headline} · ${fmt1(s.summary.accuracy)}% ${isPersonalBest?'<span class="pill good">NEW PB</span>':''} ${reliability}</h2>${!s.summary.reliable?'<div class="inline-error" style="margin-bottom:12px">The active-session clock detected impossible timing, so this run cannot corrupt personal bests, rank pace, or trend charts.</div>':''}${levelNote?`<div class="inline-good" style="margin-bottom:12px">${esc(levelNote)}</div>`:''}<div class="rank-complete"><strong>Rank ${updatedRank.rank.rank} · ${esc(updatedRank.rank.name)}</strong><span>+${updatedProfile.lastGain||0} XP · ${Math.round(updatedRank.progress*100)}% to ${esc(updatedRank.next.name)}</span></div>${comparisonLabel}<div class="stat-grid completion-stats"><div class="panel stat-card"><span class="label">Raw speed</span><strong>${s.summary.reliable?Math.round(s.summary.rawWpm):'—'}</strong><small>WPM</small></div><div class="panel stat-card"><span class="label">Best burst</span><strong>${s.summary.reliable?Math.round(s.summary.burstWpm):'—'}</strong><small>WPM</small></div><div class="panel stat-card"><span class="label">Flow score</span><strong>${Math.round(s.summary.flowScore)}</strong><small>/ 100</small></div><div class="panel stat-card"><span class="label">Consistency</span><strong>${Math.round(s.summary.consistency)}%</strong></div><div class="panel stat-card"><span class="label">Errors</span><strong>${s.summary.errors}</strong></div><div class="panel stat-card"><span class="label">Corrections</span><strong>${fmt1(s.summary.correctionRate)}%</strong></div><div class="panel stat-card"><span class="label">Hand balance</span><strong>${Math.round(s.summary.handBalance)}%</strong></div><div class="panel stat-card"><span class="label">Long pauses</span><strong>${s.summary.longPauses}</strong></div><div class="panel stat-card"><span class="label">Input p95</span><strong>${Math.round(s.inputDelay?.p95||0)} ms</strong></div><div class="panel stat-card"><span class="label">Active time</span><strong>${(s.summary.durationMs/1000).toFixed(1)}s</strong></div></div><div class="head-actions" style="margin-top:18px;flex-wrap:wrap"><button id="finish-new" class="btn primary">New text</button>${circuitAdvanced?`<button id="finish-circuit" class="btn primary">${circuitState.step==='complete'?'View circuit results':'Continue circuit →'}</button>`:''}<button id="finish-recovery" class="btn">Retry mistakes</button><button id="finish-progress" class="btn">Open progress</button><button id="finish-replay" class="btn">Replay keystrokes</button><button id="finish-microscope" class="btn">Mistake microscope</button></div>`,modal=>{modal.querySelector('#finish-new').onclick=()=>{closeModal();routeTo('practice',{fresh:true});};if(circuitAdvanced)modal.querySelector('#finish-circuit').onclick=()=>{closeModal();if(circuitState.step==='complete')routeTo('lab');else routeTo('practice',{text:circuitNextPassage(circuitState)});};modal.querySelector('#finish-recovery').onclick=()=>{closeModal();routeTo('practice',{text:makeRecoveryText(s),mode:'weak'});};modal.querySelector('#finish-progress').onclick=()=>{closeModal();routeTo('progress');};modal.querySelector('#finish-replay').onclick=()=>showReplay(s);
      modal.querySelector('#finish-microscope').onclick=()=>{
        openModal(`<div class="eyebrow">Session analysis</div><h2>Mistake microscope</h2><p class="muted">Real words containing wrong keystrokes, not guessed weak characters.</p><div class="data-list">${microscope.map(x=>`<div class="data-row"><strong dir="auto">${esc(x.word)}</strong><span>${x.count} mistake${x.count===1?'':'s'}</span><span>position ${x.indices[0]+1}</span></div>`).join('')||'<div class="empty">No mistakes. Excellent control.</div>'}</div><div class="head-actions"><button class="btn primary" id="micro-drill">Train these words</button></div>`,m=>m.querySelector('#micro-drill').onclick=()=>{
          const words=microscope.map(x=>x.word);
          if(!words.length){closeModal();return;}
          const passage=Array.from({length:6},()=>words.join(' ')).join('. ')+'.';
          closeModal();routeTo('practice',{text:{id:`micro-${s.id}`,language:s.language,level:practiceState.level,title:'Mistake microscope drill',source:'microscope',text:passage}});
        });
      };});
  };
  let typedTrace='';
  const traceNode=document.querySelector('#live-key-trace');
  const mistakeBox=document.querySelector('#mistake-feedback');
  const mistyped=document.querySelector('#mistake-typed'),mistakeExpected=document.querySelector('#mistake-expected');
  document.querySelector('#mistake-dismiss').onclick=()=>{mistakeBox.hidden=true;};
  const fatigue=new FatigueRadar();
  const fatigueNode=document.querySelector('#fatigue-radar');
  let checkpointTimer=0;
  const commitCheckpoint=()=>{
    if(engine.finished||!engine.startedAt||!engine.index)return;
    const data=makeCheckpoint(text,engine);
    if(data.engine)saveJson(CHECKPOINT_KEY,data);
  };
  const scheduleCheckpoint=()=>{clearTimeout(checkpointTimer);checkpointTimer=setTimeout(()=>{if(performance.now()-lastPracticeInput<1100){scheduleCheckpoint();return;}commitCheckpoint();},1800);};
  const saveOnHidden=()=>{if(document.visibilityState==='hidden')commitCheckpoint();};
  document.addEventListener('visibilitychange',saveOnHidden);
  const onAttempt=e=>{
    scheduleCheckpoint();
    const radar=fatigue.observe(e.detail);
    if(radar){fatigueNode.textContent=radar.message;fatigueNode.dataset.level=radar.level;}
    // Always show the actual wrong input, not only a red underline on the
    // target text. This uses textContent, so arbitrary keyboard input is safe.
    if(!e.detail.correct){
      mistyped.textContent=printablePracticeKey(e.detail.key);
      mistakeExpected.textContent=printablePracticeKey(e.detail.expected);
      mistakeBox.hidden=false;
      mistakeBox.classList.toggle('mistake-flash',false);
      // CSS state is rendered on next paint without a synchronous layout read.
      requestAnimationFrame(()=>{if(mistakeBox.isConnected)mistakeBox.classList.add('mistake-flash');});
    }
    typedTrace=(typedTrace+e.detail.key).slice(-100);traceNode.textContent=typedTrace;traceNode.classList.toggle('trace-error',!e.detail.correct);const bucket=Math.min(7,Math.floor(e.detail.index/Math.max(1,e.detail.total)*8));sectionAttempts[bucket]++;if(!e.detail.correct)sectionErrors[bucket]++;const now=performance.now();if(now-lastSectionPaint>170){lastSectionPaint=now;updateMilestones(engine.index,engine.chars.length);const r=recommendRecovery({attempts:sectionAttempts,mistakes:sectionErrors,total:engine.chars.length,index:engine.index});precisionStatus.textContent=r.text;precisionStatus.dataset.level=r.level;}};
  engine.addEventListener('attempt',onAttempt);
  engine.addEventListener('next',onNext);engine.addEventListener('progress',onProgress);engine.addEventListener('finish',onFinish);
  const refocus=()=>view.focus({preventScroll:true});
  const setFollowLabel=enabled=>{ui.follow.setAttribute('aria-pressed',String(enabled));ui.follow.textContent=enabled?'● Auto-follow':'○ Auto-follow';};
  const onFollowChange=e=>setFollowLabel(e.detail.enabled);
  engine.addEventListener('followchange',onFollowChange);
  ui.follow.onclick=()=>{engine.setFollowCursor(!engine.followCursor);settings.followCursor=engine.followCursor;persistSettings();refocus();};
  document.querySelector('#read-home').onclick=()=>{engine.setFollowCursor(true);settings.followCursor=true;persistSettings();refocus();};
  document.querySelector('#read-up').onclick=()=>{engine.browsePage(-1);refocus();};
  document.querySelector('#read-down').onclick=()=>{engine.browsePage(1);refocus();};
  const resizeText=delta=>{
    settings.textScale=typingFontScale((settings.textScale||1)+delta);
    textViewport.style.setProperty('--typing-font-size',`${Math.round((settings.language==='fa'?29:28)*settings.textScale)}px`);
    persistSettings();engine.scrollToCurrent(true);refocus();
  };
  document.querySelector('#read-zoom-out').onclick=()=>resizeText(-.1);
  document.querySelector('#read-zoom-in').onclick=()=>resizeText(.1);

  // Idle guardian: long thinking/away time should not count as physical typing.
  // It cannot fire before the first character and does no synchronous work in
  // the keydown path. The status/control is always visible and opt-out exists.
  let lastActivity=performance.now();
  const onActivity=()=>{lastActivity=performance.now();};
  engine.addEventListener('next',onActivity);
  const sprintGuardian=setInterval(()=>{
    if(disposed || !engine.startedAt || engine.finished || engine.paused)return;
    const seconds=settings.sprintSeconds||0;if(!seconds)return;
    const left=timeRemaining(engine._activeDuration(),seconds);
    if(left!==lastSprintPaint){lastSprintPaint=left;sprintStatus.textContent=`Sprint · ${Math.floor(left/60)}:${String(left%60).padStart(2,'0')} left`;}
    if(left===0)engine.finishSprint();
  },250);
  sprintStatus.textContent=settings.sprintSeconds?`Sprint · ${settings.sprintSeconds/60} min after first key`:'Untimed practice';
  const idleGuardian=setInterval(()=>{
    if(!engine.startedAt || engine.paused || engine.finished || !settings.idlePauseSeconds)return;
    if(performance.now()-lastActivity >= settings.idlePauseSeconds*1000){engine.pause('idle');showPause('Idle pause');}
  },2000);
  // Do not pause an untouched session on the transient focus changes that
  // WebKitGTK/KDE can emit while a frameless AppImage is appearing.  Pausing
  // before the first key was the source of the occasional 'frozen at start'
  // experience.
  const onBlur=()=>{if(settings.pauseWhenUnfocused&&!engine.finished&&engine.startedAt){engine.pause('window');showPause();}};window.addEventListener('blur',onBlur);
  function showPause(label='Paused'){
    if(document.querySelector('.pause-cover'))return;
    const cover=document.createElement('div');cover.className='pause-cover';
    cover.innerHTML=`<div class="pause-box"><h3>${esc(label)}</h3><p>Only active typing time is scored. Resume when ready; your position is preserved.</p><button class="btn primary">Resume typing</button></div>`;
    document.querySelector('#typing-card')?.append(cover);
    cover.querySelector('button').onclick=()=>{cover.remove();engine.resume();lastActivity=performance.now();refocus();engine.scrollToCurrent(true);};
  }
  document.querySelectorAll('[data-lang]').forEach(b=>b.onclick=async()=>{settings.language=b.dataset.lang;progressFilter=settings.language;practiceState.currentText=null;persistSettings();await routeTo('practice',{fresh:true});});
  document.querySelector('#practice-mode').onchange=e=>{practiceState.mode=e.target.value;practiceState.currentText=null;routeTo('practice',{fresh:true});};
  document.querySelector('#practice-level').onchange=e=>{practiceState.level=Number(e.target.value);settings.stageByLanguage||={};settings.stageByLanguage[settings.language]=practiceState.level;persistSettings();practiceState.currentText=null;routeTo('practice',{fresh:true});};
  document.querySelector('#practice-length').onchange=e=>{settings.sessionLength=e.target.value;persistSettings();practiceState.currentText=null;routeTo('practice',{fresh:true});};
  document.querySelector('#practice-sprint').onchange=e=>{settings.sprintSeconds=normalizeSprintSeconds(e.target.value);persistSettings();routeTo('practice',{text:practiceState.currentText});};
  document.querySelector('#zen-practice').onclick=()=>{settings.zenPractice=!settings.zenPractice;persistSettings();document.querySelector('#zen-practice').textContent=settings.zenPractice?'Exit Zen':'Zen';};
  const bookmarksKey='keyflow.saved-passages';
  const updateBookmarkLabel=()=>{const stored=boundedBookmarks(loadJson(bookmarksKey,[]));const saved=stored.some(x=>x.key===bookmarkKey(text.text));document.querySelector('#bookmark-text').textContent=saved?'★ Saved passage':'☆ Save passage';};
  updateBookmarkLabel();
  document.querySelector('#bookmark-text').onclick=()=>{const stored=boundedBookmarks(loadJson(bookmarksKey,[]));const key=bookmarkKey(text.text);const idx=stored.findIndex(x=>x.key===key);if(idx>=0){stored.splice(idx,1);toast('Passage removed from saved collection.');}else{stored.push({key,text:text.text,language:settings.language,title:text.title,level:text.level||practiceState.level,savedAt:Date.now()});toast('Passage saved for future practice.','success');}saveJson(bookmarksKey,boundedBookmarks(stored));updateBookmarkLabel();};
  document.querySelector('#new-text').onclick=()=>{practiceState.currentText=null;routeTo('practice',{fresh:true});};
  document.querySelector('#retry-text').onclick=()=>routeTo('practice',{text:practiceState.currentText});
  document.querySelector('#accuracy-lock').onclick=()=>{settings.strictAccuracy=!settings.strictAccuracy;persistSettings();routeTo('practice',{text:practiceState.currentText});};
  document.querySelector('#pause-toggle').onclick=()=>{if(engine.finished)return;engine.pause('manual');showPause();};
  document.querySelector('#focus-toggle').onclick=()=>{settings.focusMode=!settings.focusMode;persistSettings();document.querySelector('#focus-toggle').textContent=settings.focusMode?'Exit focus':'Focus';};
  document.querySelector('#audio-coach').onclick=async()=>{if(!settings.soundEnabled){settings.soundEnabled=true;settings.keySounds=true;if(settings.soundVolume<.2)settings.soundVolume=.46;persistSettings();applyAudioSettings({soundEnabled:true,soundVolume:settings.soundVolume,keyClickSounds:true,soundProfile:settings.soundProfile});}const status=await testAudio();const b=document.querySelector('#audio-coach');if(b){b.classList.add('on');b.innerHTML=`<span class="dot"></span><strong>Audio coach ${status.state==='active'?'ACTIVE':'ON'}</strong><span>comfort mix</span>`;}updateAudioRuntime();};
  return()=>{disposed=true;clearTimeout(checkpointTimer);if(!engine.finished)commitCheckpoint();document.removeEventListener('visibilitychange',saveOnHidden);clearInterval(idleGuardian);clearInterval(sprintGuardian);clearTimeout(initialFreshTimer);cancelAnimationFrame(hintRaf);if(heatmapIdle)clearTimeout(heatmapIdle);engine.destroy();window.removeEventListener('blur',onBlur);window.removeEventListener('keyflow-audio-status',onAudioStatus);};
}

async function renderProgress(serial=routeSerial){
  const sessions=await getRecentSessions({limit:1200}).catch(error=>{console.warn('Progress history unavailable:',error);return[];});
  if(serial!==routeSerial)return;
  const agg=aggregateSessions(sessions,progressFilter==='all'?null:progressFilter);
  const en=aggregateSessions(sessions,'en'),fa=aggregateSessions(sessions,'fa');
  const recent=sessions.slice().reverse().slice(0,10);
  const today=agg.daily.find(d=>d.date===localDateKey(new Date()))||{minutes:0};
  const goalPct=Math.min(100,(today.minutes/Math.max(1,settings.dailyMinutes))*100);
  const quests=dailyQuests(sessions,{dailyMinutes:settings.dailyMinutes,language:progressFilter==='all'?null:progressFilter});
  const target=progressFilter==='fa'?settings.persianTargetWpm:progressFilter==='en'?settings.englishTargetWpm:Math.max(settings.persianTargetWpm,settings.englishTargetWpm);
  const coach=coachRecommendation(agg,target);
  const rankLang=progressFilter==='all'?settings.language:progressFilter;const profile=profileForLanguage(progression,rankLang);const rankInfo=rankProgress(profile);const curriculum=curriculumFor(agg,target,profile);
  view.innerHTML=`<div class="view-inner wide">
    <div class="page-head"><div><div class="eyebrow">Reliable local analytics · anomalous timing excluded</div><h1>Progress with signal.</h1><p>Speed, flow, transitions, hand balance, corrections, input latency, reliability, and progression stay separate.</p></div><div class="segmented"><button data-filter="en" class="${progressFilter==='en'?'active':''}">English</button><button data-filter="fa" class="${progressFilter==='fa'?'active':''}">فارسی</button><button data-filter="all" class="${progressFilter==='all'?'active':''}">Combined</button></div></div>
    <div class="rank-banner panel"><div><div class="eyebrow">Skill rank · ${langName(rankLang)}</div><h2>Rank ${rankInfo.rank.rank} · ${esc(rankInfo.rank.name)}</h2><p>${profile.xp||0} XP · ${rankInfo.remaining?`${rankInfo.remaining} XP to ${esc(rankInfo.next.name)}`:'top rank reached'}</p></div><div class="rank-progress"><div class="bar"><i style="width:${Math.round(rankInfo.progress*100)}%"></i></div><strong>${Math.round(rankInfo.progress*100)}%</strong></div></div>
    <div class="stat-grid stat-grid-eight">
      <div class="panel stat-card"><span class="label">Average speed</span><strong>${Math.round(agg.averageWpm)} WPM</strong><small>median ${Math.round(agg.medianWpm)} · recent ${Math.round(agg.recentAverageWpm)}</small></div>
      <div class="panel stat-card"><span class="label">Burst speed</span><strong>${Math.round(agg.averageBurstWpm)} WPM</strong><small>best short clean windows</small></div>
      <div class="panel stat-card"><span class="label">Accuracy</span><strong>${fmt1(agg.accuracy)}%</strong><small>${fmt1(agg.errorsPer1000)} errors / 1k</small></div>
      <div class="panel stat-card"><span class="label">Flow score</span><strong>${Math.round(agg.averageFlowScore)}</strong><small>accuracy + rhythm + balance</small></div>
      <div class="panel stat-card"><span class="label">Consistency</span><strong>${Math.round(agg.averageConsistency)}%</strong><small>median key ${Math.round(agg.medianIntervalMs)} ms</small></div>
      <div class="panel stat-card"><span class="label">Hand balance</span><strong>${Math.round(agg.handBalance)}%</strong><small>100 = even left/right load</small></div>
      <div class="panel stat-card"><span class="label">Input latency p95</span><strong>${agg.inputDelayP95<1?fmt1(agg.inputDelayP95):Math.round(agg.inputDelayP95)} ms</strong><small>UI queue, not finger speed</small></div>
      <div class="panel stat-card"><span class="label">Timing reliability</span><strong>${Math.round(agg.reliabilityRate)}%</strong><small>${agg.anomalousSessions} anomalous run${agg.anomalousSessions===1?'':'s'} ignored</small></div>
    </div>
    <section class="panel coach-strip"><div><div class="eyebrow">Next useful session</div><strong>${esc(coach.title)}</strong><p>${esc(coach.text)}</p></div><button id="coach-action" class="btn primary">${esc(coach.action)}</button></section>
    <section class="panel curriculum-card"><div class="chart-title"><div><div class="eyebrow">Daily quests · local only</div><h3>Three ways to progress today</h3></div></div><div class="quest-grid">${quests.map(q=>`<div class="quest"><strong>${esc(q.name)} ${q.complete?'✓':''}</strong><p>${esc(q.description)}</p><div class="bar"><i style="width:${Math.round(q.progress*100)}%"></i></div></div>`).join('')}</div></section>
    <section class="panel curriculum-card"><div class="chart-title"><div><div class="eyebrow">Three-session curriculum</div><h3>What to do next</h3></div><span class="pill">rank-aware</span></div><div class="curriculum-grid">${curriculum.map((x,i)=>`<button class="curriculum-step" data-plan="${i}"><span>${i+1}</span><strong>${esc(x.title)}</strong><small>${esc(x.why)}</small></button>`).join('')}</div></section>
    <div class="dashboard-grid">
      <section class="panel chart-card"><div class="chart-title"><div><div class="eyebrow">Daily reliable average</div><h3>Speed trend</h3></div><span class="pill">${progressFilter==='all'?'all languages':langName(progressFilter)}</span></div><canvas id="speed-chart" class="chart"></canvas></section>
      <section class="panel list-card"><div class="chart-title"><div><div class="eyebrow">Error fingerprint</div><h3>Weak characters</h3></div></div><div class="data-list">${agg.weakKeys.slice(0,8).map(k=>`<div class="data-row"><strong>${esc(k.char===' '?'␠':k.char)}</strong><span>${fmt1(k.errorRate)}% error</span><span>${Math.round(k.avgLatency)} ms</span></div>`).join('')||'<div class="empty">More sessions are needed.</div>'}</div></section>
      <section class="panel list-card"><div class="chart-title"><div><div class="eyebrow">Movement, not just letters</div><h3>Slow / error transitions</h3></div><button id="train-pairs" class="btn small-btn">Train them</button></div><div class="data-list">${agg.weakPairs.slice(0,8).map(k=>`<div class="data-row"><strong>${esc(k.pair)}</strong><span>${fmt1(k.errorRate)}% error</span><span>${Math.round(k.avgLatency)} ms</span></div>`).join('')||'<div class="empty">Transition data appears after longer sessions.</div>'}</div></section>
      <section class="panel list-card"><div class="chart-title"><div><div class="eyebrow">Recent</div><h3>Sessions</h3></div></div><div class="data-list">${recent.map(s=>`<div class="data-row"><div><strong>${esc(s.title||langName(s.language))}</strong><span style="display:block">${new Date(s.startedAt).toLocaleString()}</span></div><span>${s.summary?.reliable===false?'timing anomaly':`${Math.round(s.summary?.wpm||0)} WPM · ${Math.round(s.summary?.accuracy||0)}%`}</span><button class="btn small-btn" data-replay="${esc(s.id)}">Replay</button></div>`).join('')||'<div class="empty">No sessions yet.</div>'}</div></section>
      <section class="panel list-card"><div class="chart-title"><div><div class="eyebrow">Flow diagnostics</div><h3>Corrections and pauses</h3></div></div><div class="data-list"><div class="data-row"><strong>Correction rate</strong><span>${fmt1(agg.correctionRate)}%</span><span>${agg.backspaces} backspaces</span></div><div class="data-row"><strong>Long pauses</strong><span>${agg.longPauses}</span><span>≥ 1 second</span></div><div class="data-row"><strong>Trend</strong><span>${agg.trendWpm>=0?'+':''}${fmt1(agg.trendWpm)} WPM</span><span>recent vs prior 5</span></div><div class="data-row"><strong>Reliable PB</strong><span>${Math.round(agg.bestWpm)} WPM</span><span>${agg.reliableSessions}/${agg.sessions} scored</span></div></div></section>
      <section class="panel progress-heatmap"><div class="chart-title"><div><div class="eyebrow">Physical error map</div><h3>Keyboard heatmap</h3></div><span class="pill">error + latency</span></div><div id="progress-keyboard" class="keyboard compact-keyboard"></div></section>
    </div>
    <div class="language-compare"><section class="panel language-card"><div class="eyebrow">English · independent target</div><div class="big">${Math.round(en.averageWpm)} <span class="tiny">/ ${settings.englishTargetWpm} WPM</span></div><div class="bar"><i style="width:${Math.min(100,en.averageWpm/settings.englishTargetWpm*100)}%"></i></div><p class="muted small">${fmt1(en.accuracy)}% accuracy · ${en.reliableSessions}/${en.sessions} reliable · ${en.streak} day streak</p></section><section class="panel language-card rtl"><div class="eyebrow">فارسی · هدف مستقل</div><div class="big">${Math.round(fa.averageWpm)} <span class="tiny">/ ${settings.persianTargetWpm} WPM</span></div><div class="bar"><i style="width:${Math.min(100,fa.averageWpm/settings.persianTargetWpm*100)}%"></i></div><p class="muted small">دقت ${fmt1(fa.accuracy)}٪ · ${fa.reliableSessions}/${fa.sessions} معتبر · زنجیره ${fa.streak} روز</p></section></div>
    <section class="panel goal-card"><div><div class="eyebrow">Today's goal</div><strong>${Math.round(today.minutes)} / ${settings.dailyMinutes} minutes</strong></div><div class="bar"><i style="width:${goalPct}%"></i></div></section>
  </div>`;
  requestAnimationFrame(()=>drawLineChart(document.querySelector('#speed-chart'),agg.daily.slice(-30)));
  const heatLanguage=progressFilter==='all'?settings.language:progressFilter;const heatKeyboard=new KeyboardView(document.querySelector('#progress-keyboard'),layoutMapper(heatLanguage));heatKeyboard.setHeatmap(agg.weakKeys);
  document.querySelector('#coach-action').onclick=()=>{if(coach.route){routeTo(coach.route);return;}if(coach.harder)practiceState.level=Math.min(5,practiceState.level+1);practiceState.mode=coach.mode||'text';practiceState.currentText=null;routeTo('practice',{mode:practiceState.mode,fresh:true});};
  document.querySelectorAll('[data-plan]').forEach(b=>b.onclick=()=>{const step=curriculum[Number(b.dataset.plan)];if(!step)return;practiceState.mode=step.mode;practiceState.currentText=null;if(step.title.toLowerCase().includes('endurance'))settings.sessionLength='endurance';routeTo('practice',{mode:step.mode,fresh:true});});
  document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{progressFilter=b.dataset.filter;renderProgress();});
  document.querySelector('#train-pairs').onclick=()=>{practiceState.mode='weak';practiceState.currentText=null;routeTo('practice',{mode:'weak',fresh:true});};
  document.querySelectorAll('[data-replay]').forEach(b=>b.onclick=()=>{const s=sessions.find(x=>x.id===b.dataset.replay);if(s)showReplay(s);});
}

async function showReplay(session){
  if(!session?.text){toast('This older session has no replay text stored.','error');return;}
  const keyEvents=(session.events||[]).filter(e=>e.type==='key').slice(0,2500);
  openModal(`<div class="eyebrow">Keystroke replay</div><h2>${esc(session.title||'Session')}</h2><div id="replay-text" class="typing-text ${session.language==='fa'?'rtl':''}" dir="${session.language==='fa'?'rtl':'ltr'}" style="height:260px"></div><div class="head-actions"><button id="replay-start" class="btn primary">Replay</button><button id="replay-practice" class="btn">Practice this text</button><span id="replay-state" class="muted small"></span></div>`,modal=>{
    const host=modal.querySelector('#replay-text');
    host.lang=session.language==='fa'?'fa':'en';
    const replayChars=graphemes(session.text,session.language);
    const offsets=new Array(replayChars.length+1);let off=0;for(let i=0;i<replayChars.length;i++){offsets[i]=off;off+=replayChars[i].length;}offsets[replayChars.length]=off;
    const node=document.createTextNode(session.text);const runEl=document.createElement('div');runEl.className='typing-glyph-layer';runEl.append(node);host.append(runEl);
    const canHighlight=session.language!=='fa'&&typeof CSS!=='undefined'&&CSS.highlights&&typeof Highlight!=='undefined';
    const good=canHighlight?new Highlight():null,bad=canHighlight?new Highlight():null;if(canHighlight){CSS.highlights.set('replay-correct',good);CSS.highlights.set('replay-wrong',bad);}
    const rangeAt=index=>{if(index<0||index>=replayChars.length)return null;const r=document.createRange();r.setStart(node,offsets[index]);r.setEnd(node,offsets[index+1]);return r;};
    let timers=[];const run=()=>{timers.forEach(clearTimeout);timers=[];good?.clear();bad?.clear();if(!keyEvents.length)return;const base=keyEvents[0].at||session.startedAt;keyEvents.forEach((e,i)=>{const delay=Math.min(20000,Math.max(0,(e.at||base)-base));timers.push(setTimeout(()=>{if(!host.isConnected)return;const r=rangeAt(e.index);if(r)(e.correct?good:bad)?.add(r);modal.querySelector('#replay-state').textContent=`${i+1}/${keyEvents.length}`;},delay));});};
    modal.querySelector('#replay-start').onclick=run;modal.querySelector('#replay-practice').onclick=()=>{timers.forEach(clearTimeout);if(canHighlight){CSS.highlights.delete('replay-correct');CSS.highlights.delete('replay-wrong');}closeModal();routeTo('practice',{text:{id:`replay-${session.id}`,title:session.title||'Replay text',text:session.text,language:session.language,level:3,source:'replay'}});};
  });
}

async function renderLibrary(serial=routeSerial){
  const custom=await getCustomTextsCached();
  if(serial!==routeSerial)return;
  const saved=boundedBookmarks(loadJson('keyflow.saved-passages',[])).map((x,i)=>({...x,id:`saved-${x.key||i}`,source:'saved',tags:['favorite','saved'],level:x.level||3}));
  const all=[...saved,...custom,...BUILTIN_TEXTS];
  const reviewState=loadJson('keyflow.review',{});
  const currentLang=settings.language;let q='';let level='all';let source='all';
  let history=new Map(),historyLoaded=false;
  view.innerHTML=`<div class="view-inner wide"><div class="page-head"><div><div class="eyebrow">Meaningful + no-repeat pool</div><h1>Text library.</h1><p>Original practical passages, public-domain classics, your imports, and validated AI drafts.</p></div><button id="add-custom" class="btn primary">Add / import text</button></div>
  <div class="segmented" style="margin-bottom:12px;width:max-content"><button data-lib-lang="en" class="${currentLang==='en'?'active':''}">English</button><button data-lib-lang="fa" class="${currentLang==='fa'?'active':''}">فارسی</button></div>
  <div class="library-toolbar panel"><input id="lib-search" class="input" placeholder="Search title, content, or tag..."><select id="lib-level" class="select"><option value="all">All levels</option>${[1,2,3,4,5].map(x=>`<option value="${x}">Level ${x}</option>`).join('')}</select><select id="lib-source" class="select"><option value="all">All sources</option><option value="original">Original</option><option value="public-domain">Public domain</option><option value="ai">AI generated</option><option value="custom">My texts</option><option value="saved">★ Saved passages</option></select><select id="lib-history" class="select"><option value="all">All texts</option><option value="practiced">Practiced</option><option value="unused">Never practiced</option></select><span id="lib-history-status" class="muted small">Loading passage history…</span></div><div id="text-grid" class="text-grid"></div></div>`;
  const grid=document.querySelector('#text-grid');
  const draw=()=>{
    const list=all.filter(t=>t.language===settings.language).filter(t=>level==='all'||String(t.level)===level).filter(t=>source==='all'||(source==='custom'?String(t.id).startsWith('custom-'):t.source===source)).filter(t=>!q||`${t.title} ${t.text} ${(t.tags||[]).join(' ')}`.toLowerCase().includes(q)).filter(t=>{const mode=document.querySelector('#lib-history')?.value||'all';const practiced=(history.get(t.id)?.started||0)>0;return mode==='all'||(mode==='practiced'?practiced:!practiced);});
    grid.innerHTML=list.map(t=>`<article class="panel text-card ${t.language==='fa'?'rtl':''}"><div><span class="pill">${t.language==='fa'?'فا':'EN'} · L${esc(t.level||3)}</span>${reviewState[t.id]?(reviewState[t.id].dueAt<=Date.now()?'<span class="pill warn">Review due</span>':`<span class="pill good">Review ${new Date(reviewState[t.id].dueAt).toLocaleDateString()}</span>`):''} ${t.source==='public-domain'?'<span class="pill good">public domain</span>':''}${t.source==='ai'?`<span class="pill warn">AI · health ${esc(t.health??'?')}</span>`:''}</div><h3>${esc(t.title)}</h3><p>${esc(t.text)}</p><div class="tag-row">${(t.tags||[]).slice(0,4).map(x=>`<span class="tag">${esc(x)}</span>`).join('')}</div><div class="library-stats">${historyLoaded?(history.get(t.id)?.started?(()=>{const h=history.get(t.id);return `<strong>${h.started} practice starts · ${h.attempts} saved runs · ${h.completions} completed</strong><span>Best ${Math.round(h.bestWpm)} WPM · Avg ${Math.round(h.averageAccuracy)}% · ${h.uniqueDays} recorded days</span><span>Last: ${new Date(h.lastAt).toLocaleDateString()}</span>`;})():'<span>Not practiced yet</span>'):'<span>Loading practice history…</span>'}</div><footer><button class="btn ghost small-btn" data-details="${esc(t.id)}">Detailed stats</button><button class="btn primary small-btn" data-practice="${esc(t.id)}">Practice</button>${String(t.id).startsWith('custom-')||t.source==='ai'?`<button class="btn ghost small-btn danger" data-delete="${esc(t.id)}">Delete</button>`:`<span class="tiny dim">${esc(t.author||t.source||'builtin')}</span>`}</footer></article>`).join('')||'<div class="empty panel" style="grid-column:1/-1">No texts match these filters.</div>';
    grid.querySelectorAll('[data-details]').forEach(b=>b.onclick=()=>{
      const t=all.find(x=>x.id===b.dataset.details),h=history.get(b.dataset.details);
      if(!t)return;
      openModal(`<div class="eyebrow">Per-passage practice record</div><h2 dir="auto">${esc(t.title)}</h2><p class="muted">${t.text.length} characters · ${esc(langName(t.language))} · tier ${esc(t.level||3)}</p><div class="stat-grid"><div class="panel stat-card"><span class="label">Practice starts</span><strong>${h?.started||0}</strong></div><div class="panel stat-card"><span class="label">Saved attempts</span><strong>${h?.attempts||0}</strong></div><div class="panel stat-card"><span class="label">Full completions</span><strong>${h?.completions||0}</strong></div><div class="panel stat-card"><span class="label">Best valid WPM</span><strong>${Math.round(h?.bestWpm||0)}</strong></div><div class="panel stat-card"><span class="label">Average accuracy</span><strong>${Math.round(h?.averageAccuracy||0)}%</strong></div><div class="panel stat-card"><span class="label">Typing minutes (allocated)</span><strong>${(h?.minutes||0).toFixed(1)}</strong></div><div class="panel stat-card"><span class="label">Different days</span><strong>${h?.uniqueDays||0}</strong></div></div><h3>Recent attempts</h3><div class="data-list">${(h?.runs||[]).map(r=>`<div class="data-row"><strong>${new Date(r.at).toLocaleString()}</strong><span>${Math.round(r.wpm)} WPM · ${Math.round(r.accuracy)}% accuracy</span><span>${r.full?'Complete':'Partial'} · ${r.covered} chars</span></div>`).join('')||'<p class="muted">No finished session report yet. A practice start is counted only once typing begins.</p>'}</div>`);
    });
    grid.querySelectorAll('[data-practice]').forEach(b=>b.onclick=()=>{const t=all.find(x=>x.id===b.dataset.practice);if(t){settings.language=t.language;persistSettings();practiceState.currentText=t;routeTo('practice',{text:t});}});
    grid.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{await deleteText(b.dataset.delete);invalidateCustomTextCache();toast('Text deleted.','success');renderLibrary();});
  };
  draw();
  document.querySelectorAll('[data-lib-lang]').forEach(b=>b.onclick=()=>{settings.language=b.dataset.libLang;persistSettings();renderLibrary();});
  document.querySelector('#lib-search').oninput=e=>{q=e.target.value.toLowerCase().trim();draw();};
  document.querySelector('#lib-level').onchange=e=>{level=e.target.value;draw();};
  document.querySelector('#lib-source').onchange=e=>{source=e.target.value;draw();};
  document.querySelector('#lib-history').onchange=draw;
  setTimeout(async()=>{
    try{const sessions=await getRecentSessions({limit:2000});if(serial!==routeSerial)return;
      history=perPassageHistory(all,sessions,getSeenState());historyLoaded=true;
      document.querySelector('#lib-history-status').textContent=`History: last ${sessions.length} sessions (up to 2000)`;draw();
    }catch(error){if(serial!==routeSerial)return;document.querySelector('#lib-history-status').textContent='History temporarily unavailable';}
  },40);
  document.querySelector('#add-custom').onclick=()=>openAddTextModal();
}

function openAddTextModal(prefill={}){
  openModal(`<div class="eyebrow">Local content</div><h2>Add or clean a text</h2><div class="field-row two"><label class="field">Language<select id="add-lang" class="select"><option value="en">English</option><option value="fa">فارسی</option></select></label><label class="field">Title<input id="add-title" class="input" value="${esc(prefill.title||'')}"></label></div><label class="field" style="margin-top:12px">Paste text<textarea id="add-text" class="textarea" dir="auto">${esc(prefill.text||'')}</textarea></label><div id="add-health" class="status-line"></div><div class="head-actions" style="margin-top:12px"><button id="add-clean" class="btn">Clean for keyboard</button><button id="add-save" class="btn primary">Save text</button></div>`,modal=>{
    const lang=modal.querySelector('#add-lang');lang.value=prefill.language||settings.language;const area=modal.querySelector('#add-text');
    const evaluate=()=>{const layout=lang.value==='fa'?settings.persianLayout:settings.englishLayout;const v=validatePracticeContent(area.value,{language:lang.value,layoutId:layout,calibration:settings.calibration[layout]||{},allowDiacritics:settings.allowPersianDiacritics,minLength:20});modal.querySelector('#add-health').textContent=`Content health ${v.health}/100${v.issues.length?' · '+v.issues.join(' '):' · ready'}`;return v;};
    area.oninput=evaluate;lang.onchange=evaluate;evaluate();
    modal.querySelector('#add-clean').onclick=()=>{area.value=cleanImportedText(area.value,lang.value,{allowDiacritics:settings.allowPersianDiacritics});evaluate();};
    modal.querySelector('#add-save').onclick=async()=>{const v=evaluate();if(!v.ok){toast('Fix content validation issues before saving: '+v.issues.join(' '),'error',5500);return;}const t={id:`custom-${crypto.randomUUID()}`,language:lang.value,title:modal.querySelector('#add-title').value.trim()||'My text',text:v.text,level:3,tags:['custom'],source:'custom',createdAt:Date.now(),health:v.health};await saveText(t);invalidateCustomTextCache();closeModal();toast('Text saved locally.','success');settings.language=t.language;persistSettings();routeTo('library');};
  });
}

async function renderAi(serial=routeSerial){
  const sessions=await getRecentSessions({language:settings.language,limit:240}).catch(error=>{console.warn('AI personalization history unavailable:',error);return[];});
  if(serial!==routeSerial)return;const aggregate=aggregateSessions(sessions,settings.language);const weak=aggregate.weakKeys.slice(0,8).map(x=>x.char).join(' ');
  const custom=await getCustomTextsCached();
  if(serial!==routeSerial)return;
  const avoidTexts=[...BUILTIN_TEXTS,...custom].filter(x=>x.language===settings.language).map(x=>x.text);
  view.innerHTML=`<div class="view-inner wide"><div class="page-head"><div><div class="eyebrow">Live discovery · retry · fallback · proxy</div><h1>AI practice studio.</h1><p>Generate longer passages, reject duplicates, repair language problems, and optionally route provider traffic through your local V2Ray/SOCKS proxy.</p></div><span class="pill good">Secrets: ${esc(credentialStorageMode())}</span></div>
  <div class="ai-grid"><section class="panel ai-config"><div class="eyebrow">Connection</div><h3>Provider + network</h3><div class="stack"><label class="field">Provider<select id="ai-provider" class="select">${Object.values(PROVIDERS).map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><div id="provider-note" class="provider-note"></div><label class="field">API key<input id="ai-key" class="input" type="password" autocomplete="off" placeholder="saved in KWallet on Linux; never in localStorage"></label><div id="provider-extra" class="stack"></div><div class="proxy-box"><div class="setting-row"><div><strong>Use AI proxy</strong><small>Supports HTTP(S), SOCKS5 and SOCKS5H in the native AppImage.</small></div><button id="ai-proxy-toggle" class="switch ${settings.aiProxyEnabled?'on':''}" role="switch" aria-checked="${settings.aiProxyEnabled}"></button></div><label class="field">Proxy URL<input id="ai-proxy-url" class="input" value="${esc(settings.aiProxyUrl||'socks5h://127.0.0.1:10808')}" placeholder="socks5h://127.0.0.1:10808"></label><div class="head-actions"><button id="test-proxy" class="btn">Test route</button><span id="proxy-status" class="pill">${settings.aiProxyEnabled?'proxy enabled':'direct'}</span></div></div><div class="model-row"><label class="field">Live model ID<input id="ai-model" class="input" list="model-list" placeholder="Refresh models or type an ID"><datalist id="model-list"></datalist></label><div class="head-actions" style="align-self:end"><button id="smart-model" class="btn">Smart pick</button><button id="refresh-models" class="btn">Refresh</button></div></div><div id="model-status" class="status-line"></div>${toggleRow('ai-fallback','Automatic model fallback','On incompatible or empty completions, quota errors, or transient failures, try two other text-capable models.',settings.aiAutoFallback!==false)}<div class="head-actions"><button id="save-provider" class="btn primary">Save config</button><button id="test-provider" class="btn">Test selected model</button><button id="remove-key" class="btn ghost danger">Clear key</button></div></div></section>
  <section class="panel ai-compose"><div class="eyebrow">Adaptive long-form content</div><h3>Generate a validated practice passage</h3><div class="field-row"><label class="field">Language<select id="gen-lang" class="select"><option value="en">English</option><option value="fa">فارسی</option></select></label><label class="field">Level<select id="gen-level" class="select">${[1,2,3,4,5].map(x=>`<option value="${x}">${x}</option>`).join('')}</select></label><label class="field">Length<select id="gen-length" class="select"><option value="short">350–500</option><option value="medium">600–900</option><option value="long" selected>950–1400</option><option value="endurance">1500–2200</option></select></label></div><div class="field-row two" style="margin-top:12px"><label class="field">Writing format<select id="gen-format" class="select"><option value="practical">Practical prose</option><option value="story">Coherent story</option><option value="essay">Explanatory essay</option><option value="dialogue">Natural dialogue</option></select></label><label class="field">Topic<input id="gen-topic" class="input" value="${settings.language==='fa'?'فناوری و زندگی روزمره':'technology and daily life'}"></label></div><label class="field" style="margin-top:12px">Weak characters / transitions<input id="gen-weak" class="input" value="${esc(weak)}" placeholder="optional"></label><div class="tag-row" id="topic-chips" style="margin:10px 0"></div><div class="setting-row"><div><strong>Duplicate guard</strong><small>Rejects passages with high phrase overlap against built-in and saved texts.</small></div><span class="pill good">mandatory</span></div><div class="setting-row"><div><strong>Keyboard-safe output</strong><small>Reject unsupported characters and unwanted Persian marks before saving.</small></div><span class="pill good">mandatory</span></div><div class="field-row two" style="margin-top:12px"><label class="field">OpenRouter reasoning<select id="gen-reasoning" class="select"><option value="low">Low (recommended)</option><option value="minimal">Minimal (fastest)</option><option value="none">Off (if supported)</option><option value="default">Model default</option></select></label><label class="field">Maximum output tokens<select id="gen-token-budget" class="select"><option value="6000">6,000</option><option value="8192">8,192 · recommended</option><option value="12000">12,000</option><option value="16000">16,000</option></select></label></div><p class="muted small" style="margin:9px 0">Thinking tokens consume output capacity. Reasoning controls apply to OpenRouter; Dahl uses its documented standard chat format. A blank length-limited result gets one adjusted retry before changing models. Higher limits may increase token usage; free models may have their own caps.</p>${toggleRow('gen-review','Deep language review','A second pass fixes grammar, verb agreement, tense, meaning, repetition, and story causality without shortening the text.',settings.aiDeepReview!==false)}<button id="generate" class="btn primary" style="width:100%;margin-top:14px">Generate → validate → deduplicate → review</button><div class="head-actions" style="margin-top:10px"><button id="prompt-maker" class="btn">Build prompt for external AI</button><button id="import-ai-answer" class="btn ghost">Paste AI answer</button></div><div id="gen-status" class="status-line"></div></section></div><section id="ai-result" class="panel ai-result" style="display:none"></section></div>`;
  const providerSelect=document.querySelector('#ai-provider'),keyInput=document.querySelector('#ai-key'),modelInput=document.querySelector('#ai-model'),extra=document.querySelector('#provider-extra'),note=document.querySelector('#provider-note'),status=document.querySelector('#model-status'),proxyStatus=document.querySelector('#proxy-status');
  providerSelect.value=settings.provider in PROVIDERS?settings.provider:'openrouter';document.querySelector('#gen-lang').value=settings.language;document.querySelector('#gen-level').value=String(practiceState.level);document.querySelector('#gen-length').value=settings.sessionLength==='endurance'?'endurance':'long';document.querySelector('#gen-reasoning').value=settings.aiReasoningMode||'low';document.querySelector('#gen-token-budget').value=String(settings.aiTokenBudget||8192);
  const drawTopics=()=>{const lang=document.querySelector('#gen-lang').value;document.querySelector('#topic-chips').innerHTML=TOPICS[lang].map(t=>`<button class="tag" data-topic="${esc(t)}">${esc(t)}</button>`).join('');document.querySelectorAll('[data-topic]').forEach(b=>b.onclick=()=>document.querySelector('#gen-topic').value=b.dataset.topic);};drawTopics();document.querySelector('#gen-lang').onchange=()=>drawTopics();
  const loadConfig=async()=>{const id=providerSelect.value,p=PROVIDERS[id],cfg=loadProviderConfig(id);keyInput.value='';keyInput.placeholder='Loading saved credential…';try{const key=await getCredential(id);if(providerSelect.value===id && route==='ai')keyInput.value=key;}catch(error){if(providerSelect.value===id)status.textContent=`Wallet: ${error.message}`;}if(providerSelect.value!==id || route!=='ai')return;keyInput.placeholder='API key';note.innerHTML=`<strong>${esc(p.freeLabel)}</strong><br>${esc(p.description)}`;extra.innerHTML=(p.fields||[]).map(f=>`<label class="field">${esc(f.label)}<input class="input" data-config="${esc(f.key)}" placeholder="${esc(f.placeholder||'')}" value="${esc(cfg[f.key]||'')}"></label>`).join('');modelInput.value=settings.modelByProvider?.[id]||cfg.model||'';status.textContent='Model list is fetched live; no retired model ID is assumed.';};
  const collect=()=>{const cfg=loadProviderConfig(providerSelect.value);cfg.apiKey=keyInput.value.trim();extra.querySelectorAll('[data-config]').forEach(i=>cfg[i.dataset.config]=i.value.trim());cfg.proxyUrl=settings.aiProxyEnabled?(settings.aiProxyUrl||'').trim():'';cfg.timeoutMs=60000;return cfg;};
  let refreshSerial=0;
  const refresh=async(force=true)=>{const serial=++refreshSerial,id=providerSelect.value,cfg=collect();status.textContent=`Discovering live models ${cfg.proxyUrl?'through proxy':'direct'}…`;try{const models=await listProviderModels(id,cfg,{force});if(serial!==refreshSerial || id!==providerSelect.value || route!=='ai')return[];lastProviderModels=models;document.querySelector('#model-list').innerHTML=models.map(m=>`<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');const current=models.find(m=>m.id===modelInput.value);if(!current){const recommended=pickRecommendedModel(models);if(recommended)modelInput.value=recommended.id;}const recommended=pickRecommendedModel(models);status.textContent=`${models.length} catalog candidate${models.length===1?'':'s'} (generation not verified).${recommended?` Smart pick: ${recommended.id}`:''}`;return models;}catch(e){status.textContent=`Discovery failed: ${e.message}`;toast(e.message,'error');return[];}};
  providerSelect.onchange=()=>{refreshSerial++;settings.provider=providerSelect.value;persistSettings();lastProviderModels=[];loadConfig().then(()=>{if(providerSelect.value==='dahl')refresh(false);});};loadConfig();
  document.querySelector('#ai-proxy-toggle').onclick=e=>{settings.aiProxyEnabled=!settings.aiProxyEnabled;e.currentTarget.classList.toggle('on',settings.aiProxyEnabled);e.currentTarget.setAttribute('aria-checked',String(settings.aiProxyEnabled));persistSettings();proxyStatus.textContent=settings.aiProxyEnabled?'proxy enabled':'direct';};
  document.querySelector('#ai-proxy-url').onchange=e=>{settings.aiProxyUrl=e.target.value.trim();persistSettings();};
  document.querySelector('#test-proxy').onclick=async()=>{settings.aiProxyUrl=document.querySelector('#ai-proxy-url').value.trim();persistSettings();proxyStatus.textContent='testing…';try{const r=await testAiTransport({proxyUrl:settings.aiProxyEnabled?settings.aiProxyUrl:''});proxyStatus.textContent=`${r.proxy==='direct'?'direct':'proxy'} · ${Math.round(r.latencyMs)} ms · ${r.models} models`;proxyStatus.className='pill good';}catch(e){proxyStatus.textContent=`failed · ${e.message}`;proxyStatus.className='pill bad';}};
  document.querySelector('#refresh-models').onclick=()=>refresh(true);document.querySelector('#smart-model').onclick=async()=>{const models=lastProviderModels.length?lastProviderModels:await refresh(false);const pick=pickRecommendedModel(models);if(pick){modelInput.value=pick.id;toast(`Selected ${pick.id}`,'success');}};document.querySelector('#test-provider').onclick=async()=>{
    const cfg=collect(),id=providerSelect.value,model=modelInput.value.trim();
    if(!model){toast('Select a model to test.','error');return;}
    status.textContent=`Checking ${model} for actual readable text…`;
    try{const result=await providerChat(id,cfg,model,[{role:'user',content:'Reply with exactly KEYFLOW_OK and nothing else.'}],{retries:0,maxTokens:2048,reasoningMode:'minimal'});
      status.textContent=`Text completion works: ${result.text.trim().slice(0,110)}`;
      toast('Model returned readable text.','success');
    }catch(error){status.textContent=`Text generation failed: ${error.message}`;toast(error.message,'error',6500);}
  };
  document.querySelector('#ai-fallback').onclick=e=>{settings.aiAutoFallback=settings.aiAutoFallback===false;e.currentTarget.classList.toggle('on',settings.aiAutoFallback!==false);e.currentTarget.setAttribute('aria-checked',String(settings.aiAutoFallback!==false));persistSettings();};
  document.querySelector('#gen-review').onclick=e=>{const on=!e.currentTarget.classList.contains('on');e.currentTarget.classList.toggle('on',on);e.currentTarget.setAttribute('aria-checked',String(on));settings.aiDeepReview=on;persistSettings();};
  document.querySelector('#save-provider').onclick=async()=>{const id=providerSelect.value,cfg=collect();try{if(cfg.apiKey)await setCredential(id,cfg.apiKey);saveProviderConfig(id,cfg);settings.provider=id;settings.modelByProvider||={};settings.modelByProvider[id]=modelInput.value.trim();persistSettings();toast(`Saved settings; key storage: ${credentialStorageMode()}.`,'success');}catch(error){toast('Could not save credential: '+error.message,'error',7000);}};
  document.querySelector('#remove-key').onclick=async()=>{try{await removeCredential(providerSelect.value);keyInput.value='';toast('API credential removed from wallet.','success');}catch(error){toast('Could not clear key: '+error.message,'error',6500);}};
  for(const [control,key,convert] of [['gen-reasoning','aiReasoningMode',v=>v],['gen-token-budget','aiTokenBudget',Number]])document.querySelector('#'+control).onchange=e=>{settings[key]=convert(e.target.value);persistSettings();};
  const generationOptions=()=>{
    const lang=document.querySelector('#gen-lang').value;
    return {language:lang,level:Number(document.querySelector('#gen-level').value),length:document.querySelector('#gen-length').value,format:document.querySelector('#gen-format').value,topic:document.querySelector('#gen-topic').value.trim(),weakCharacters:Array.from(document.querySelector('#gen-weak').value.trim()),allowDiacritics:lang==='fa'&&settings.allowPersianDiacritics,aiReasoningMode:document.querySelector('#gen-reasoning').value,aiTokenBudget:Number(document.querySelector('#gen-token-budget').value)};
  };
  document.querySelector('#prompt-maker').onclick=()=>{
    const prompt=buildPortablePrompt(generationOptions());
    openModal(`<div class="eyebrow">Offline / external AI prompt maker</div><h2>Copy this prompt to any AI service</h2><p class="muted">Works without an API key. After generation, use “Paste AI answer”.</p><textarea id="portable-prompt" class="textarea" rows="12" readonly></textarea><div class="head-actions"><button id="copy-portable" class="btn primary">Copy prompt</button></div>`,modal=>{
      const area=modal.querySelector('#portable-prompt');area.value=prompt;
      modal.querySelector('#copy-portable').onclick=async()=>{try{await navigator.clipboard.writeText(prompt);toast('Prompt copied.','success');}catch{area.focus();area.select();document.execCommand('copy');toast('Selected prompt for copying.','success');}};
    });
  };
  document.querySelector('#import-ai-answer').onclick=()=>{
    openModal(`<div class="eyebrow">External AI import</div><h2>Paste AI-generated passage</h2><p class="muted">Accepts JSON {title,text,language} or plain prose. Validation runs before saving.</p><textarea id="external-answer" class="textarea" rows="12" dir="auto" placeholder="Paste the AI response..."></textarea><div class="head-actions"><button id="use-external" class="btn primary">Validate in Library</button></div>`,modal=>modal.querySelector('#use-external').onclick=()=>{
      const raw=modal.querySelector('#external-answer').value.trim();if(!raw){toast('Paste your passage first.','error');return;}
      let parsed={text:raw};try{const data=parseGeneratedJson(raw);if(typeof data?.text==='string')parsed=data;}catch{}
      closeModal();openAddTextModal({language:generationOptions().language,title:parsed.title||'AI imported passage',text:parsed.text});
    });
  };
  document.querySelector('#generate').onclick=async()=>{const id=providerSelect.value,cfg=collect(),model=modelInput.value.trim();if(!model){toast('Select or type a model ID.','error');return;}if(PROVIDERS[id].requiresKey!==false&&!cfg.apiKey){toast('Enter an API key for this provider.','error');return;}const lang=document.querySelector('#gen-lang').value,layout=lang==='fa'?settings.persianLayout:settings.englishLayout;const localRefs=[...BUILTIN_TEXTS,...await getCustomTextsCached()].filter(x=>x.language===lang).map(x=>x.text);const options={language:lang,level:Number(document.querySelector('#gen-level').value),length:document.querySelector('#gen-length').value,format:document.querySelector('#gen-format').value,topic:document.querySelector('#gen-topic').value.trim(),weakCharacters:Array.from(document.querySelector('#gen-weak').value.trim()),allowDiacritics:lang==='fa'&&settings.allowPersianDiacritics,layoutId:layout,deepReview:settings.aiDeepReview!==false,avoidTexts:localRefs,aiReasoningMode:document.querySelector('#gen-reasoning').value,aiTokenBudget:Number(document.querySelector('#gen-token-budget').value)};const genStatus=document.querySelector('#gen-status');genStatus.textContent='Generating → length check → language check → keyboard check → duplicate guard → repair/review…';document.querySelector('#generate').disabled=true;try{if(!lastProviderModels.length)await refresh(false);const fallbacks=settings.aiAutoFallback!==false?fallbackModels(lastProviderModels,model,2):[];generatedDraft=await generatePracticeText({providerId:id,config:cfg,model,fallbackModels:fallbacks,options,calibration:settings.calibration[layout]||{}});settings.modelByProvider[id]=generatedDraft.model||model;saveProviderConfig(id,cfg);persistSettings();const box=document.querySelector('#ai-result');box.style.display='block';box.innerHTML=`<div class="chart-title"><div><div class="eyebrow">Validated draft · health ${generatedDraft.health}/100 · overlap ${Math.round((generatedDraft.duplicateScore||0)*100)}%</div><h3>${esc(generatedDraft.title)}</h3></div><span class="pill good">${esc(id)} · ${esc(generatedDraft.model||model)}</span></div><div class="ai-preview ${lang==='fa'?'rtl':''}" dir="${lang==='fa'?'rtl':'ltr'}">${esc(generatedDraft.text)}</div><div class="head-actions" style="margin-top:16px"><button id="draft-practice" class="btn primary">Practice now</button><button id="draft-save" class="btn">Save to library</button><span class="small muted">${generatedDraft.text.length} chars · ${generatedDraft.validation.unsupported.length?`Unmapped: ${esc(generatedDraft.validation.unsupported.join(' '))}`:'keyboard-safe'}</span></div>`;box.querySelector('#draft-practice').onclick=()=>{settings.language=generatedDraft.language;persistSettings();routeTo('practice',{text:generatedDraft});};box.querySelector('#draft-save').onclick=async()=>{await saveText(generatedDraft);invalidateCustomTextCache();toast('AI text saved to library.','success');};genStatus.textContent=`Passed length, language purity, keyboard safety, duplicate guard, and ${generatedDraft.deepReviewed?'deep semantic review':'structural quality'} checks.`;playFeedback('ready');}catch(e){genStatus.textContent=e.message;toast(e.message,'error',5000);}finally{document.querySelector('#generate').disabled=false;}};
}

async function renderSettings(){
  const rendererLabel=runtimeInfo.rendererMode||'browser';
  const envLabel=(runtimeInfo.appliedEnv||[]).join(', ')||'none';
  const gpuLabel=(runtimeInfo.gpuVendors||[]).join(', ')||'unknown';
  view.innerHTML=`<div class="view-inner wide"><div class="page-head"><div><div class="eyebrow">EndeavourOS-first local preferences</div><h1>Settings.</h1><p>The default profile is tuned for Arch/EndeavourOS + KDE and keeps the typing hot path isolated from expensive work.</p></div><span class="pill ${String(rendererLabel).includes('safe')?'warn':'good'}">${esc(rendererLabel)}</span></div><div class="settings-grid">
  <section class="panel settings-card"><div class="eyebrow">Goals</div><h3>Targets and language separation</h3><div class="field-row"><label class="field">Daily minutes<input id="s-daily" class="input" type="number" min="1" max="240" value="${settings.dailyMinutes}"></label><label class="field">English target WPM<input id="s-en-wpm" class="input" type="number" min="5" max="250" value="${settings.englishTargetWpm}"></label><label class="field">Persian target WPM<input id="s-fa-wpm" class="input" type="number" min="5" max="250" value="${settings.persianTargetWpm}"></label></div><div class="hairline"></div><div class="setting-row"><div><strong>Current practice language</strong><small>Library, AI defaults, drills, and targets stay independent per language.</small></div><div class="segmented"><button data-setting-lang="en" class="${settings.language==='en'?'active':''}">EN</button><button data-setting-lang="fa" class="${settings.language==='fa'?'active':''}">فا</button></div></div></section>
  <section class="panel settings-card"><div class="eyebrow">Practice engine</div><h3>Latency, length and behavior</h3><div class="field-row two"><label class="field">Performance profile<select id="s-performance" class="select"><option value="ultra">Ultra latency — recommended on EndeavourOS</option><option value="balanced">Balanced visuals</option></select></label><label class="field">Default session length<select id="s-session-length" class="select"><option value="standard">Standard · focused</option><option value="long">Long · recommended</option><option value="endurance">Endurance · sustained flow</option></select></label></div><p class="muted small">Long and endurance sessions are assembled from a global no-repeat deck rather than looping one short story. WPM uses active monotonic typing time and rejects impossible timing samples.</p><div class="hairline"></div>${toggleRow('s-strict','Strict accuracy mode','Wrong keys do not advance the cursor.',settings.strictAccuracy)}${toggleRow('s-pause','Pause when unfocused','Prevents background time from corrupting WPM. Pre-start pauses are never subtracted from a session that has not started.',settings.pauseWhenUnfocused)}${toggleRow('s-auto-level','Adaptive difficulty','Permanent skill rank/XP is separate from adaptive passage difficulty, so one bad session never erases progression.',settings.autoLevel!==false)}${toggleRow('s-heatmap','Weak-key heatmap','Tint the physical keyboard using your recent error/latency fingerprint.',settings.showWeakKeyHeatmap!==false)}${toggleRow('s-diacritics','Persian diacritics / marks','Off by default; enable only after calibrating advanced marks.',settings.allowPersianDiacritics)}${toggleRow('s-reduce','Reduce motion','Disable nonessential movement.',settings.reduceMotion)}<div class="hairline"></div><label class="field">Automatic idle pause<select id="s-idle-pause" class="select"><option value="0">Never</option><option value="30">30 seconds</option><option value="45">45 seconds</option><option value="60">60 seconds</option><option value="90">90 seconds</option></select></label><label class="field">Fresh passage protection<select id="s-freshness" class="select"><option value="7">7 days</option><option value="14">14 days</option><option value="21">21 days · recommended</option><option value="30">30 days</option><option value="90">90 days · maximum variety</option></select></label><p class="muted small">Typing is paused after inactivity instead of silently counting it against speed. Auto-follow and text zoom are available directly above the passage.</p></section>
  <section class="panel settings-card"><div class="eyebrow">Physical layouts</div><h3>Real EndeavourOS/XKB mapping</h3><div class="field-row two"><label class="field">English layout<select id="s-en-layout" class="select"><option value="en-us">English · US</option></select></label><label class="field">Persian layout<select id="s-fa-layout" class="select">${Object.values(LAYOUTS).filter(x=>x.language==='fa').map(x=>`<option value="${x.id}">${esc(x.label)}</option>`).join('')}</select></label></div><p class="muted small">The standard profile now mirrors <code>/usr/share/X11/xkb/symbols/ir</code> instead of guessing from a Windows table. Keyflow still learns <code>KeyboardEvent.key + code + Shift + AltGr</code> from your real keyboard and learned mappings override the profile.</p><div class="hairline"></div><div class="eyebrow">Live layout probe</div><div id="probe" class="probe" tabindex="0"><div id="probe-key" class="probe-key">Press a key</div><div id="probe-meta" class="probe-meta">Focus this box and press Persian keys. Mapping is learned locally.</div></div><div class="head-actions" style="margin-top:10px"><button id="probe-focus" class="btn small-btn">Focus probe</button><button id="guided-map" class="btn small-btn">Guided calibration</button><button id="reset-map" class="btn ghost small-btn danger">Reset learned map</button></div><div id="mapping-table" class="mapping-table"></div></section>
  <section class="panel settings-card"><div class="eyebrow">Sound coach</div><h3>Calm Cuelume feedback</h3>${toggleRow('s-sound','Sound feedback','Cuelume remains the sound engine, with a lower comfort mix so repeated keystrokes do not become fatiguing.',settings.soundEnabled)}${toggleRow('s-keysound','Per-key sound','Printable keys, Space, Backspace and Enter use Cuelume typing context; mistakes and completion have separate low-intensity cues.',settings.keySounds)}<label class="field" style="margin-top:14px">Sound profile<select id="s-sound-profile"><option value="soft">Soft · recommended</option><option value="minimal">Minimal · quietest</option><option value="mechanical">Mechanical · dry</option><option value="playful">Playful</option></select></label><label class="field" style="margin-top:14px">Comfort volume <span class="muted small">(recommended 30–55%)</span><input id="s-volume" type="range" min="0" max="0.8" step="0.02" value="${Math.min(.8,settings.soundVolume)}"></label><div class="head-actions" style="margin-top:12px"><button id="test-sound" class="btn primary">Test calm typing sequence</button><span id="sound-status" class="pill">Cuelume · ${esc(getAudioStatus().state)} · GStreamer ${runtimeInfo.gstreamerReady?'ready':'check'}</span></div><p class="muted small">The test uses the exact Cuelume path used during practice. The default profile deliberately attenuates per-key cues; it never boosts volume behind your back.</p><div class="mapping-table"><div><strong>Media framework</strong><span>${runtimeInfo.gstreamerReady?'bundled + ready':runtimeInfo.mediaFrameworkBundled?'bundled but incomplete':'not detected (normal in browser/dev)'}</span></div><div><strong>Plugin path</strong><span>${esc(runtimeInfo.gstreamerPluginPath||'AppImage runtime only')}</span></div></div></section>
  <section class="panel settings-card"><div class="eyebrow">AI network</div><h3>Local proxy route</h3>${toggleRow('s-ai-proxy','Use AI proxy','Route native provider requests through HTTP(S), SOCKS5 or SOCKS5H. Useful with V2Ray on EndeavourOS.',settings.aiProxyEnabled)}<label class="field" style="margin-top:14px">Proxy URL<input id="s-ai-proxy-url" class="input" value="${esc(settings.aiProxyUrl||'socks5h://127.0.0.1:10808')}" placeholder="socks5h://127.0.0.1:10808"></label><div class="head-actions" style="margin-top:12px"><button id="s-test-proxy" class="btn">Test proxy route</button><span id="s-proxy-status" class="pill">${settings.aiProxyEnabled?'proxy enabled':'direct'}</span></div><p class="muted small">SOCKS5H resolves provider hostnames through the proxy, which is normally the safer V2Ray choice. Native credentials are stored in your unlocked Secret Service wallet.</p></section>
  <section class="panel settings-card"><div class="eyebrow">Linux graphics</div><h3>AppImage renderer diagnostics</h3><div class="data-list"><div class="data-row"><strong>Distro</strong><span>${esc(runtimeInfo.distro||'browser')}</span><span>${esc(runtimeInfo.distroLike||'')}</span></div><div class="data-row"><strong>Desktop / session</strong><span>${esc(runtimeInfo.desktop||'unknown')}</span><span>${esc(runtimeInfo.displayServer||runtimeInfo.session||'unknown')}</span></div><div class="data-row"><strong>GPU vendor</strong><span>${esc(gpuLabel)}</span><span></span></div><div class="data-row"><strong>Renderer</strong><span>${esc(rendererLabel)}</span><span></span></div><div class="data-row"><strong>Compatibility env</strong><span>${esc(envLabel)}</span><span></span></div></div><p class="muted small" style="margin-top:12px">Startup diagnostics: <code>${esc(runtimeInfo.startupLog||'~/.local/state/keyflow/startup.log')}</code>. Override only for troubleshooting: <code>KEYFLOW_RENDERER=normal</code>, <code>software</code>, or <code>x11-safe</code>.</p></section>
  <section class="panel settings-card"><div class="eyebrow">Responsiveness</div><h3>Live performance tools</h3><p class="muted small">Practice now measures browser event-queue delay (p95) separately from typing rhythm, so a slow UI is visible instead of being mistaken for slow fingers.</p><div class="head-actions"><button id="run-benchmark" class="btn">Run UI benchmark</button><span id="benchmark-result" class="pill">not run</span></div><div class="hairline"></div><p class="muted small">Ultra mode removes blur/backdrop filters, expensive shadows, glyph transitions, and unnecessary paint work while preserving the actual typing feedback.</p></section>
  </div><div class="head-actions" style="margin-top:14px"><button id="save-settings" class="btn primary">Save settings</button><button id="open-lab" class="btn">Open training lab</button></div></div>`;
  document.querySelector('#s-fa-layout').value=settings.persianLayout;document.querySelector('#s-en-layout').value=settings.englishLayout;document.querySelector('#s-performance').value=settings.performanceMode||'ultra';document.querySelector('#s-session-length').value=settings.sessionLength||'long';document.querySelector('#s-idle-pause').value=String(settings.idlePauseSeconds??45);document.querySelector('#s-freshness').value=String(settings.freshnessDays??21);
  document.querySelectorAll('[data-setting-lang]').forEach(b=>b.onclick=()=>{settings.language=b.dataset.settingLang;persistSettings();renderSettings();});
  const toggles=[['#s-strict','strictAccuracy'],['#s-pause','pauseWhenUnfocused'],['#s-auto-level','autoLevel'],['#s-heatmap','showWeakKeyHeatmap'],['#s-diacritics','allowPersianDiacritics'],['#s-reduce','reduceMotion'],['#s-sound','soundEnabled'],['#s-keysound','keySounds'],['#s-ai-proxy','aiProxyEnabled']];
  toggles.forEach(([sel,key])=>document.querySelector(sel).onclick=e=>{
    settings[key]=!settings[key];
    e.currentTarget.classList.toggle('on',settings[key]);
    if(key==='soundEnabled'||key==='keySounds') applyAudioSettings({soundEnabled:settings.soundEnabled,soundVolume:settings.soundVolume,keyClickSounds:settings.keySounds,soundProfile:settings.soundProfile});
    persistSettings();
  });
  document.querySelector('#s-sound-profile').value=settings.soundProfile||'soft';
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
    if(settings.soundVolume<0.12){ settings.soundVolume=0.36; document.querySelector('#s-volume').value='0.36'; }
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
  document.querySelector('#s-ai-proxy-url').onchange=e=>{settings.aiProxyUrl=e.target.value.trim();persistSettings();};
  document.querySelector('#s-test-proxy').onclick=async()=>{const out=document.querySelector('#s-proxy-status');settings.aiProxyUrl=document.querySelector('#s-ai-proxy-url').value.trim();persistSettings();out.textContent='testing…';try{const result=await testAiTransport({proxyUrl:settings.aiProxyEnabled?settings.aiProxyUrl:''});out.textContent=`${settings.aiProxyEnabled?'proxy':'direct'} · ${Math.round(result.latencyMs)} ms · ${result.modelCount ?? result.models ?? 0} models`;out.className='pill good';}catch(err){out.textContent=`route failed · ${err.message}`;out.className='pill bad';}};
  document.querySelector('#save-settings').onclick=()=>{settings.dailyMinutes=Number(document.querySelector('#s-daily').value)||15;settings.englishTargetWpm=Number(document.querySelector('#s-en-wpm').value)||55;settings.persianTargetWpm=Number(document.querySelector('#s-fa-wpm').value)||40;settings.englishLayout=document.querySelector('#s-en-layout').value;settings.persianLayout=document.querySelector('#s-fa-layout').value;settings.performanceMode=document.querySelector('#s-performance').value;settings.sessionLength=document.querySelector('#s-session-length').value;settings.idlePauseSeconds=Number(document.querySelector('#s-idle-pause').value);settings.freshnessDays=Number(document.querySelector('#s-freshness').value);settings.aiProxyUrl=document.querySelector('#s-ai-proxy-url').value.trim();settings.soundVolume=Math.min(.8,Number(document.querySelector('#s-volume').value));persistSettings();applyAudioSettings({soundEnabled:settings.soundEnabled,soundVolume:settings.soundVolume,keyClickSounds:settings.keySounds,soundProfile:settings.soundProfile});toast('Settings saved.','success');renderSettings();};
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

async function renderLab(serial=routeSerial){
  view.innerHTML='<div class="practice-loading" role="status">Loading your training workstation…</div>';
  const sessions=await getRecentSessions({language:settings.language,limit:240}).catch(()=>[]);
  if(serial!==routeSerial)return;
  const aggregate=aggregateSessions(sessions,settings.language);
  const last=sessions.at(-1);
  const target=settings.language==='fa'?settings.persianTargetWpm:settings.englishTargetWpm;
  const stage=stageEvidence(sessions,settings.language,practiceState.level,target);
  const weak=aggregate.weakKeys?.slice(0,5)||[];
  const badPairs=aggregate.weakPairs?.slice(0,4)||[];
  const rankInfo=rankProgress(profileForLanguage(progression,settings.language));
  const aiProxy=settings.aiProxyUrl?.trim()||'Direct network';
  const modeButton=(id,icon,title,description,action)=>`<article class="panel lab-workout"><span class="lab-icon">${icon}</span><h3>${title}</h3><p>${description}</p><button class="btn primary" id="${id}">${action}</button></article>`;
  view.innerHTML=`<div class="view-inner wide"><div class="page-head"><div><div class="eyebrow">Training workstation · ${langName(settings.language)}</div><h1>Practice lab.</h1><p>Run real drills, examine your mistakes, and build measurable skill—not a directory of settings pages.</p></div><span class="pill">Tier ${practiceState.level}/5 · ${stage.successes}/3 qualifying runs</span></div>
  <section class="panel lab-diagnosis"><div><div class="eyebrow">Personal training prescription</div><h3>${aggregate.sessions?'Train what is slowing you down':'Start with a baseline'}</h3><p>${aggregate.sessions?`Recent ${aggregate.sessions} sessions · ${Math.round(aggregate.accuracy)}% accuracy · ${Math.round(aggregate.recentAverageWpm)} WPM. Stage requires ≥${stage.required} WPM, ≥96% accuracy and ≥65% consistency in three distinct full passages.`:'Complete a full passage to build a baseline. Practice in your preferred language and return for targeted drills.'}</p><p class="muted small">Weak keys: ${weak.map(k=>esc(k.char)).join(' · ')||'not enough data'} | Weak transitions: ${badPairs.map(k=>esc(k.pair)).join(' · ')||'not enough data'}</p></div><div class="head-actions"><button id="lab-new" class="btn">Fresh baseline</button><button id="lab-replay" class="btn" ${last?'':'disabled'}>Review last run</button></div></section>
  <div class="lab-workouts">
  ${modeButton('lab-adaptive','◎','Weak-key repair',`Build a keyboard-safe custom drill using your errors and slow grapheme transitions. ${weak.length?'Personal data is ready.':'Baseline needed for personal targeting.'}`,'Start weak-key drill')}
  ${modeButton('lab-rhythm','♬','Rhythm calibration','Practice controlled, even spacing and smooth key transitions, then compare consistency.','Start rhythm')}
  ${modeButton('lab-sprints','◷','One-minute sprint','A short active-time test. Pauses do not secretly count; a partial passage never earns a full completion.','Start timed sprint')}
  ${modeButton('lab-length','↔','Endurance typing','Train stamina on a longer mixed passage with distinct source tracking.','Start endurance')}
  ${modeButton('lab-punctuation',';','Punctuation precision','Concentrate on punctuation and keyboard punctuation transitions.','Train punctuation')}
  ${modeButton('lab-numbers','#','Numbers & symbols','Work through punctuation, number rows, and symbols with real-time accuracy feedback.','Train symbols')}
  ${modeButton('lab-recovery','↶','Recover last mistakes','Regenerate a drill from actual errors in the most recent session, not randomly selected letters.','Retry mistakes')}
  ${modeButton('lab-zen','◌','Distraction-free flow',`Enter a clean visual environment for a real practice passage. Currently ${settings.zenPractice?'enabled':'disabled'}.`,'Toggle Zen + start')}
  </div>
  <section class="panel lab-evidence"><div class="eyebrow">Training diagnostics · active safeguards</div><div class="lab-evidence-grid">
    <div><strong>Timing integrity guard</strong><small>${Math.round(aggregate.reliabilityRate||0)}% reliable runs in this sample · unusual clock readings excluded from records</small></div>
    <div><strong>Global smart deck</strong><small>Per-source no-repeat scheduler · previews do not count · mixed sessions commit only the sections you actually reach</small></div>
    <div><strong>Skill rank + XP</strong><small>${esc(rankInfo.rank?.name||'Apprentice')} · ${Math.round(rankInfo.progress*100)}% toward the next XP rank; typing tier uses separate completion evidence</small></div>
    <div><strong>Three-session curriculum</strong><small>${stage.successes}/3 distinct qualifying passages · current tier ${practiceState.level}/5 · target ${stage.required} WPM</small></div>
    <div><strong>AI proxy route</strong><small>${esc(aiProxy)} · configured in Settings; network connection remains subject to provider support</small></div>
    <div><strong>AI model failover</strong><small>Provider fallback with explicit empty-response and token-limit errors; test a model in AI Studio before generating</small></div>
    <div><strong>AI duplicate guard</strong><small>Normalized fingerprint, similarity and keyboard-compatible content checks for generated texts</small></div>
    <div><strong>Lazy startup</strong><small>Historical reports are loaded after navigation; typing input never waits for the full Library analysis</small></div>
  </div></section>
  <section class="panel future-features"><div class="eyebrow">New · eight functional systems</div><h2>Next-generation training</h2><div class="next-feature-grid">
    <div class="next-tile"><strong>01 · Memory-aware reviews</strong><p id="review-count">Due reviews loading…</p><button class="btn primary small-btn" id="lab-review">Start due review</button></div>
    <div class="next-tile"><strong>02 · Personal-best ghost</strong><p>Race your own actual past keystrokes when you revisit the same passage.</p><button class="btn small-btn" id="lab-ghost">Open a saved PB passage</button></div>
    <div class="next-tile"><strong>03 · Error DNA</strong><p>See confused keys and measured hesitation; drill actual error words.</p><button class="btn small-btn" id="lab-dna">Analyze errors</button></div>
    <div class="next-tile"><strong>04 · Guided circuit</strong><p>Baseline → focused repair → exact-text retest. Compare genuine results.</p><button class="btn small-btn" id="lab-circuit">${circuitState?.step==='complete'?'View results':circuitState?.step?'Resume circuit':'Begin circuit'}</button></div>
    <div class="next-tile"><strong>05 · Code fluency</strong><p>Practice authentic punctuation, indentation and syntax in five languages.</p><select id="lab-code-select" class="select">${CODE_WORKOUTS.map(x=>`<option value="${x.id}">${esc(x.title)}</option>`).join('')}</select><button class="btn small-btn" id="lab-code">Type this code</button></div>
    <div class="next-tile"><strong>06 · Interrupted-session recovery</strong><p>Restore cursor, mistakes and active clock without scoring time away.</p><button class="btn small-btn" id="lab-checkpoint">${validCheckpoint(loadJson(CHECKPOINT_KEY,null))?'Resume saved session':'No saved interruption'}</button></div>
    <div class="next-tile"><strong>07 · Private Data Vault</strong><p>Export + merge history, custom passages and preferences without API secrets.</p><button class="btn small-btn" id="lab-vault">Open backup vault</button></div>
    <div class="next-tile"><strong>08 · Fatigue radar</strong><p>Real-time slowing/error detection—suggestions, never forced pauses.</p><button class="btn small-btn" id="lab-fatigue-live">Start monitored practice</button></div>
  </div></section>
  <section class="panel lab-diagnosis"><div><div class="eyebrow">Measure and review</div><h3>Last session evidence</h3><p>${last?`${esc(last.title||'Practice')} · ${Math.round(last.summary?.wpm||0)} WPM · ${Math.round(last.summary?.accuracy||0)}% accuracy · ${Math.round(last.summary?.consistency||0)}% consistency · ${last.completionReason==='passage'?'Full passage':'Timed/partial'}`:'No saved results yet.'}</p><div class="head-actions"><button id="lab-fatigue" class="btn" ${last?'':'disabled'}>Fatigue breakdown</button><button id="lab-timeline" class="btn" ${last?'':'disabled'}>Error timeline</button><button id="lab-saved" class="btn">Passage statistics</button><button id="lab-ai" class="btn">AI prompt maker</button><button id="lab-export" class="btn ghost">Export history</button></div></div></section></div>`;
  const allTexts=[...BUILTIN_TEXTS,...await getCustomTextsCached()];
  if(serial!==routeSerial)return;
  const due=dueReviews(loadJson('keyflow.review',{}),allTexts,{language:settings.language,limit:12});
  document.querySelector('#review-count').textContent=`${due.length} due passage${due.length===1?'':'s'} · scheduled only after reliable completions`;
  document.querySelector('#lab-review').disabled=!due.length;
  document.querySelector('#lab-review').onclick=()=>{if(due.length)routeTo('practice',{text:due[0]});};
  document.querySelector('#lab-ghost').onclick=async()=>{
    const candidate=sessions.filter(x=>x.summary?.reliable&&x.completionReason==='passage'&&x.text).sort((a,b)=>(b.summary?.wpm||0)-(a.summary?.wpm||0))[0];
    if(!candidate){toast('Complete a full passage first to create a personal ghost.','error');return;}
    routeTo('practice',{text:{id:candidate.textId||`ghost-${candidate.id}`,language:candidate.language,text:candidate.text,title:candidate.title,source:'ghost-replay',level:candidate.level||3}});
  };
  document.querySelector('#lab-dna').onclick=()=>openDNA(sessions);
  document.querySelector('#lab-vault').onclick=openVault;
  document.querySelector('#lab-circuit').onclick=()=>{
    if(circuitState?.step==='complete'){
      openModal(`<div class="eyebrow">Guided training evidence</div><h2>Circuit complete</h2><p>Same-text retest: ${Math.round(circuitState.baseline?.wpm||0)} → ${Math.round(circuitState.result?.wpm||0)} WPM · ${Math.round(circuitState.baseline?.accuracy||0)}% → ${Math.round(circuitState.result?.accuracy||0)}% accuracy.</p><div class="head-actions"><button class="btn primary" id="circuit-again">Start a new circuit</button></div>`,m=>m.querySelector('#circuit-again').onclick=()=>{closeModal();launchCircuit();});
    }else if(circuitState?.step)routeTo('practice',{text:circuitNextPassage(circuitState)});
    else launchCircuit();
  };
  document.querySelector('#lab-code').onclick=()=>{const t=codeWorkout(document.querySelector('#lab-code-select').value);if(t)routeTo('practice',{text:t,mode:'text'});};
  const ckpt=loadJson(CHECKPOINT_KEY,null);
  document.querySelector('#lab-checkpoint').disabled=!validCheckpoint(ckpt);
  document.querySelector('#lab-checkpoint').onclick=()=>{if(validCheckpoint(ckpt))routeTo('practice',{text:ckpt.passage,checkpoint:ckpt});};
  document.querySelector('#lab-fatigue-live').onclick=()=>routeTo('practice',{fresh:true});
  const start=(mode='text',extra={})=>{practiceState.mode=mode;practiceState.currentText=null;Object.assign(settings,extra);persistSettings();routeTo('practice',{mode,fresh:true});};
  document.querySelector('#lab-new').onclick=()=>start('text');
  document.querySelector('#lab-adaptive').onclick=()=>start('weak');
  document.querySelector('#lab-rhythm').onclick=()=>start('rhythm');
  document.querySelector('#lab-sprints').onclick=()=>start('text',{sprintSeconds:60});
  document.querySelector('#lab-length').onclick=()=>start('text',{sprintSeconds:0,sessionLength:'endurance'});
  document.querySelector('#lab-punctuation').onclick=()=>start('punctuation');
  document.querySelector('#lab-numbers').onclick=()=>start('numbers');
  document.querySelector('#lab-recovery').onclick=()=>last?routeTo('practice',{text:makeRecoveryText(last),mode:'weak'}):toast('Complete a practice first.','error');
  document.querySelector('#lab-replay').onclick=()=>last&&showReplay(last);
  document.querySelector('#lab-zen').onclick=()=>start('text',{zenPractice:!settings.zenPractice});
  document.querySelector('#lab-ai').onclick=()=>routeTo('ai');
  document.querySelector('#lab-saved').onclick=()=>routeTo('library');
  document.querySelector('#lab-export').onclick=async()=>exportSessions(await getSessions());
  document.querySelector('#lab-fatigue').onclick=()=>{
    if(!last)return;
    const curve=fatigueCurve(last);
    openModal(`<div class="eyebrow">Typing pace across thirds</div><h2>Last session pacing</h2>${curve.length?'<canvas id="lab-curve" class="chart" style="height:240px"></canvas>':'<p class="muted">Not enough typing data.</p>'}`,modal=>{
      if(curve.length)requestAnimationFrame(()=>drawBars(modal.querySelector('#lab-curve'),curve.map(x=>({label:x.label,value:x.wpm}))));
    });
  };
  document.querySelector('#lab-timeline').onclick=()=>{
    if(!last)return;
    const buckets=errorTimeline(last);
    openModal(`<div class="eyebrow">Errors by passage position</div><h2>Where mistakes accumulated</h2><canvas id="lab-errors" class="chart" style="height:240px"></canvas>`,modal=>requestAnimationFrame(()=>drawBars(modal.querySelector('#lab-errors'),buckets)));
  };
}

function feature(icon,title,text,id,action){return `<section class="panel feature-card"><div class="icon">${icon}</div><h3>${esc(title)}</h3><p>${esc(text)}</p><button id="${id}" class="btn small-btn">${esc(action)}</button></section>`;}
function exportSessions(sessions){const payload={schema:1,exportedAt:new Date().toISOString(),settings:{dailyMinutes:settings.dailyMinutes,englishTargetWpm:settings.englishTargetWpm,persianTargetWpm:settings.persianTargetWpm,englishLayout:settings.englishLayout,persianLayout:settings.persianLayout},sessions};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`keyflow-export-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('Export prepared.','success');}

function openCommandPalette(){
  const commands=[
    {name:'Start a new smart practice text',keys:'Ctrl Enter',run:()=>{practiceState.currentText=null;routeTo('practice',{fresh:true});}},
    {name:'Practice weak characters and transitions',keys:'adaptive',run:()=>routeTo('practice',{mode:'weak',fresh:true})},
    {name:'Start rhythm drill',keys:'rhythm',run:()=>routeTo('practice',{mode:'rhythm',fresh:true})},
    {name:'Open Error DNA',keys:'dna',run:async()=>openDNA(await getRecentSessions({language:settings.language,limit:240}))},
    {name:'Open Data Vault',keys:'backup',run:openVault},
    {name:'Start baseline-repair-retest circuit',keys:'circuit',run:launchCircuit},
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
async function switchLanguage(lang){settings.language=lang;practiceState.level=Math.max(1,Math.min(5,Number(settings.stageByLanguage?.[lang])||3));progressFilter=lang;practiceState.currentText=null;persistSettings();closeModal();routeTo('practice',{fresh:true});}

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
// Never delay the initial UI for a native diagnostic IPC round-trip. Runtime
// labels are updated independently after the passage is already interactive.
applyAppearance();
await setupWindowButtons();
await routeTo('practice',{fastStart:true});
loadRuntimeInfo().catch(error=>console.warn('Native diagnostics delayed:',error));
// Cache custom library opportunistically, never on the cold-render path.
const preloadTexts=()=>getCustomTextsCached().catch(()=>{});
if(typeof window.requestIdleCallback==='function')window.requestIdleCallback(preloadTexts);
else window.setTimeout(preloadTexts,8500);
warmAudioLater({soundEnabled:settings.soundEnabled,soundVolume:settings.soundVolume,keyClickSounds:settings.keySounds,soundProfile:settings.soundProfile});

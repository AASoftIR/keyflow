import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeStudioSettings,effectiveMotion,estimatedPracticeMinutes,studioPreset,practiceProgress} from '../app/ui/studio.js';
import {loadSettings,saveSettings} from '../app/core/storage.js';

const data=new Map();
globalThis.localStorage={getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)};
const ui=await readFile(new URL('../app/index.html',import.meta.url),'utf8');
const css=await readFile(new URL('../app/studio.css',import.meta.url),'utf8');
const main=await readFile(new URL('../app/main.js',import.meta.url),'utf8');
const tauri=JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json',import.meta.url),'utf8'));
const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
let checks=0;
const test=(title,fn)=>{fn();checks++;console.log('✓ v3.3: '+title);};

test('stored visual and motion preferences survive migration',()=>{
  data.set('keyflow.settings',JSON.stringify({settingsSchema:12,theme:'rose',visualStyle:'glass',motionStyle:'expressive',sessionLength:'quick',showKeyboard:false}));
  const result=loadSettings();
  assert.equal(result.visualStyle,'glass');assert.equal(result.motionStyle,'expressive');assert.equal(result.sessionLength,'quick');assert.equal(result.showKeyboard,false);
  saveSettings(result);assert.equal(loadSettings().theme,'rose');
});
test('invalid preferences use safe defaults without disturbing other settings',()=>{
  const original=loadSettings();saveSettings({...original,visualStyle:'WebGL-broken',motionStyle:'hyper',theme:'ocean'});
  const result=loadSettings();assert.equal(result.visualStyle,'depth');assert.equal(result.motionStyle,'subtle');assert.equal(result.theme,'ocean');
  assert.deepEqual(normalizeStudioSettings({visualStyle:'bad',motionStyle:'bad'}),{visualStyle:'depth',motionStyle:'subtle'});
});
test('ultra latency and reduced motion always suppress decorative animation',()=>{
  assert.equal(effectiveMotion({motionStyle:'expressive',performanceMode:'ultra'}),'none');
  assert.equal(effectiveMotion({motionStyle:'expressive',performanceMode:'balanced',reduceMotion:true}),'none');
  assert.equal(effectiveMotion({motionStyle:'expressive',performanceMode:'balanced',prefersReducedMotion:true}),'none');
  assert.equal(effectiveMotion({motionStyle:'expressive',performanceMode:'balanced'}),'expressive');
});
test('session preparation duration and progress are bounded and deterministic',()=>{
  assert.equal(estimatedPracticeMinutes(1000,50),4);
  assert.equal(estimatedPracticeMinutes(0,0),1);
  assert.equal(practiceProgress(50,200),25);
  assert.equal(practiceProgress(500,200),100);
  assert.equal(practiceProgress(-3,0),0);
});
test('four real quick routines target distinct practice behavior',()=>{
  assert.equal(studioPreset('warmup').sessionLength,'quick');
  assert.equal(studioPreset('precision').mode,'weak');
  assert.equal(studioPreset('flow').zenPractice,true);
  assert.equal(studioPreset('code').source,'code');
  assert.equal(studioPreset('invalid'),null);
});
test('semantic keyboard navigation and search affordance exist in shell',()=>{
  for(const route of ['practice','progress','library','ai','lab','settings'])assert.ok(ui.includes(`data-route="${route}"`));
  assert.match(ui,/id="launch-command"/);
  assert.match(ui,/aria-current="page"/);
  assert.match(main,/setAttribute\('aria-current','page'\)/);
  assert.match(main,/modalKeydown=e=>/);
  assert.match(main,/e\.key==='Escape'/);
});
test('practice buttons are wired to executable modes rather than navigation placeholders',()=>{
  assert.match(main,/\[data-studio-routine\]/);
  assert.match(main,/codeWorkout\('python'\)/);
  assert.match(main,/settings\.sessionLength=preset\.sessionLength/);
  assert.match(main,/id="studio-completion-fill"/);
  assert.match(main,/practiceProgress\(d\.index,d\.total\)/);
});
test('small desktop can reach the typing passage while retaining advanced options',()=>{
  assert.match(ui,/id="nav-new-session"/);
  assert.match(main,/id="practice-tools-toggle"/);
  assert.match(main,/id="practice-details-toggle"/);
  assert.match(css,/\.typing-card:not\(\.details-open\) \.practice-insights/);
  assert.match(css,/max-width:760px/);
  assert.equal(tauri.app.windows[0].minWidth,480);
});
test('effects never target the Persian text or fixed caret overlay',()=>{
  assert.doesNotMatch(css,/(?:\.typing-text|\.typing-glyph-layer|\.typing-viewport-overlay)[^\{]*\{[^}]*\b(?:transform|filter|animation|transition)\s*:/);
  assert.match(css,/body\[data-motion="none"\]/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});
test('AI generation journey reflects working result/validation stages',()=>{
  assert.match(main,/class="studio-ai-journey"/);
  for(const step of ['connect','generate','validate','save'])assert.ok(main.includes(`data-ai-step="${step}"`));
  assert.match(main,/setAiJourney\('generate'\)/);
  assert.match(main,/setAiJourney\('validate'\)/);
  assert.match(main,/setAiJourney\('save'\)/);
  assert.match(main,/setAiJourney\('generate',true\)/);
});
test('no heavy renderer or new external UI frameworks are introduced' ,()=>{
  assert.doesNotMatch(css,/@import|url\(https?:\/\//);
  assert.doesNotMatch(main,/requestAnimationFrame\([^)]*WebGL/);
  assert.equal(pkg.version,'3.3.0');assert.equal(pkg.dependencies['@tauri-apps/api'],'2.12.0');
});
console.log(`\n${checks} KeyFlow Studio v3.3 checks passed.`);

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as voice from '../app/audio/voice-coach.js';
import {loadSettings} from '../app/core/storage.js';

let total=0;
async function test(name,fn){await fn();total++;console.log('✓ v3.6: '+name);}
const main=await readFile(new URL('../app/main.js',import.meta.url),'utf8');
const engine=await readFile(new URL('../app/core/typing-engine.js',import.meta.url),'utf8');
const keyboard=await readFile(new URL('../app/ui/keyboard.js',import.meta.url),'utf8');
const css=await readFile(new URL('../app/studio.css',import.meta.url),'utf8');

let generator=await readFile(new URL('../app/ai/generator.js',import.meta.url),'utf8');
generator=generator.replace(/^import .*;\s*$/gm,'');
const {buildGenerationPrompt,TRAINING_MISSIONS}=await import('data:text/javascript;base64,'+Buffer.from(generator).toString('base64'));

await test('six AI training missions change actual Persian and English prompts',()=>{
  assert.equal(Object.keys(TRAINING_MISSIONS).length,6);
  for(const lang of ['en','fa']){
    const base=buildGenerationPrompt({language:lang,mission:'natural'});
    for(const mission of Object.keys(TRAINING_MISSIONS)){
      const prompt=buildGenerationPrompt({language:lang,mission});
      assert.ok(prompt.includes(TRAINING_MISSIONS[mission]));
      if(mission!=='natural')assert.notEqual(prompt,base);
    }
    assert.equal(buildGenerationPrompt({language:lang,mission:'invalid'}),base);
  }
});
await test('weak transitions survive as whole prompt tokens rather than split letters',()=>{
  assert.match(main,/\.split\(\/\\s\+\/u\)\.filter\(Boolean\)\.slice\(0,12\)/);
  assert.match(buildGenerationPrompt({weakCharacters:['th','ou']}),/th ou/);
});
await test('AI Studio renders before any database scan and preloads only in the background',()=>{
  const section=main.slice(main.indexOf('async function renderAi('),main.indexOf('async function renderSettings('));
  const beforeMarkup=section.slice(0,section.indexOf('view.innerHTML='));
  assert.doesNotMatch(beforeMarkup,/await getRecentSessions|await getCustomTextsCached/);
  assert.match(section,/const personalizationTimer=setTimeout\(async\(\)=>/);
  assert.match(section,/if\(serial!==routeSerial\|\|route!=='ai'/);
  assert.match(section,/const localRefs=\[\.\.\.BUILTIN_TEXTS,\.\.\.await getCustomTextsCached\(\)\]/);
});
await test('renderer preserves instant key feedback but bounds secondary analytics paints',()=>{
  assert.match(main,/now-lastSecondaryPaint<100/);
  assert.ok(main.indexOf('const onNext=e=>')<main.indexOf('const onProgress=e=>'));
  const tick=engine.match(/this\._tickTimer=setInterval\(\(\)=>\{[^\n]+/u)?.[0]||'';
  assert.match(tick,/this\._emitProgress\(\)/);
  assert.doesNotMatch(tick,/_queueLayoutCheck/);
  assert.match(keyboard,/this\.keysByCode\.get\(next\)/);
  assert.doesNotMatch(keyboard.slice(keyboard.indexOf('  highlight(hint){')),/querySelector/);
});
await test('accuracy goal controls, fixed-height feedback, and result badge are wired',()=>{
  assert.match(main,/id=\\?"practice-accuracy-goal/);
  assert.match(main,/id=\\?"precision-goal-line/);
  assert.match(main,/settings\.accuracyGoal=Number\(e\.target\.value\)/);
  assert.match(main,/const accuracyBadge=goal/);
  assert.match(css,/\.precision-goal-line\{height:38px;min-height:38px;max-height:38px/);
});
await test('voice defaults and precision options are validated on migration',()=>{
  const original=globalThis.localStorage;
  const storage=new Map([['keyflow.settings',JSON.stringify({settingsSchema:14,voiceCoachMode:'LOUD',accuracyGoal:101,voiceCoachRate:9,voiceCoachVolume:-2,aiMission:'invalid'})]]);
  globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
  try{
    const result=loadSettings();
    assert.equal(result.voiceCoachMode,'off');assert.equal(result.accuracyGoal,0);
    assert.equal(result.voiceCoachRate,1.35);assert.equal(result.voiceCoachVolume,0);
    assert.equal(result.aiMission,'natural');assert.equal(result.settingsSchema,16);
  }finally{globalThis.localStorage=original;}
});
await test('voice coach never offers non-local/remote voices and stays silent when disabled',async()=>{
  const oldS=globalThis.speechSynthesis,oldU=globalThis.SpeechSynthesisUtterance,calls=[];
  globalThis.speechSynthesis={getVoices:()=>[{localService:false,voiceURI:'remote',name:'Cloud'},{localService:true,voiceURI:'local',name:'Local',lang:'en-US'}],speak:u=>calls.push(u),cancel:()=>calls.push('cancel')};
  globalThis.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
  try{
    assert.deepEqual(voice.localVoices().map(v=>v.voiceURI),['local']);
    voice.configureVoiceCoach({mode:'off'});
    assert.equal(voice.announceVoice('mistakes','Mistake'),false);
    voice.configureVoiceCoach({mode:'mistakes',voiceId:'remote',rate:8,volume:8});
    assert.equal(voice.announceVoice('milestones','Halfway'),false);
    assert.equal(voice.announceVoice('mistakes','Use F'),true);
    assert.equal(voice.announceVoice('mistakes','Use F'),false);
    await new Promise(resolve=>setTimeout(resolve,130));
    assert.equal(calls[0].voice.voiceURI,'local');assert.equal(calls[0].rate,1.35);assert.equal(calls[0].volume,1);
    voice.stopVoiceCoach();
    globalThis.speechSynthesis.getVoices=()=>[{localService:false,voiceURI:'remote'}];
    assert.equal(voice.announceVoice('complete','Not transmitted',{force:true}),false);
  }finally{
    voice.stopVoiceCoach();
    if(oldS===undefined)delete globalThis.speechSynthesis;else globalThis.speechSynthesis=oldS;
    if(oldU===undefined)delete globalThis.SpeechSynthesisUtterance;else globalThis.SpeechSynthesisUtterance=oldU;
  }
});
await test('automatic voice choice follows Persian/English practice language',async()=>{
  const oldS=globalThis.speechSynthesis,oldU=globalThis.SpeechSynthesisUtterance,said=[];
  globalThis.speechSynthesis={getVoices:()=>[{localService:true,voiceURI:'english',lang:'en-US'},{localService:true,voiceURI:'persian',lang:'fa-IR'}],speak:u=>said.push(u),cancel:()=>{}};
  globalThis.SpeechSynthesisUtterance=class {constructor(text){this.text=text;}};
  try{
    voice.resetVoiceCooldowns();voice.configureVoiceCoach({mode:'milestones'});
    assert.equal(voice.announceVoice('milestones','نیمی از متن',{language:'fa'}),true);
    await new Promise(resolve=>setTimeout(resolve,125));
    assert.equal(said[0].voice.voiceURI,'persian');
  }finally{
    voice.stopVoiceCoach();
    if(oldS===undefined)delete globalThis.speechSynthesis;else globalThis.speechSynthesis=oldS;
    if(oldU===undefined)delete globalThis.SpeechSynthesisUtterance;else globalThis.SpeechSynthesisUtterance=oldU;
  }
});
await test('saved spoken coaching settings and local preview are reachable',()=>{
  for(const name of ['s-voice-mode','s-voice-id','s-voice-rate','s-voice-volume','s-test-voice','voice-quick-toggle','gen-mission','ai-safe-plan'])assert.ok(main.includes(name),name);
  assert.match(main,/globalThis\.speechSynthesis\?\.addEventListener\?\.\('voiceschanged',refreshVoices\)/);
  assert.match(main,/stopVoiceCoach\(\);clearTimeout\(checkpointTimer\)/);
});
await test('Groq deep review respects 900 tokens and bounded quota guidance is specific',async()=>{
  assert.match(generator,/const budget=providerId==='groq'\?Math\.min\(900,requested\):requested/);
  const source=(await readFile(new URL('../app/ai/providers.js',import.meta.url),'utf8'))
    .replace(/^import \{ invoke \} from '@tauri-apps\/api\/core';/m,"const invoke=async()=>{throw Error('unused')};");
  const {classifyAiFailure}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const quota=classifyAiFailure({message:'Planner failed',diagnostics:{trace:[{kind:'rate-limit',message:'rate exceeded'}]}});
  assert.equal(quota.kind,'rate-limit');assert.match(quota.advice,/token-per-minute/i);
  const empty=classifyAiFailure({message:'Planner failed',diagnostics:{trace:[{kind:'empty',message:'reasoning tokens'}]}});
  assert.equal(empty.kind,'empty');assert.match(empty.advice,/instruct model/);
});

console.log(`\n${total} KeyFlow 3.6 regression checks passed.`);

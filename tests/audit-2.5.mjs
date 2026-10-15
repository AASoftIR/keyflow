import assert from 'node:assert/strict';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {paceGhost,mistakeMicroscope,errorTimeline,compareSession,dailyQuests} from '../app/core/insights.js';
import {pickFreshPassage} from '../app/core/shuffle-bag.js';
import {calculateSessionSummary} from '../app/core/stats.js';
import {TypingEngine} from '../app/core/typing-engine.js';
import {loadSettings,saveProviderConfig,loadProviderConfig,getSessions,getSeenState,loadProgression} from '../app/core/storage.js';
import {BUILTIN_TEXTS} from '../app/data/builtin-texts.js';

const root=fileURLToPath(new URL('..',import.meta.url));
let passed=0;let failed=0;
async function check(name,fn){
  try{await fn();passed++;console.log(`✓ 2.5 audit: ${name}`);}catch(e){failed++;console.error(`✗ 2.5 audit: ${name}`);console.error(e);}
}
const stored=new Map(),secrets=new Map();
globalThis.localStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,String(v)),removeItem:k=>stored.delete(k)};
globalThis.sessionStorage={getItem:k=>secrets.get(k)??null,setItem:(k,v)=>secrets.set(k,String(v)),removeItem:k=>secrets.delete(k)};
await check('settings migration tolerates JSON null and invalid nested calibration',()=>{
  localStorage.setItem('keyflow.settings','null');const a=loadSettings();assert.equal(a.language,'en');
  localStorage.setItem('keyflow.settings',JSON.stringify({settingsSchema:8,language:'bogus',calibration:null,soundVolume:900}));
  const b=loadSettings();assert.equal(b.language,'en');assert.ok(b.calibration['fa-standard']);assert.equal(b.soundVolume,.8);
});
await check('clearing provider credentials removes session-only key',()=>{
  saveProviderConfig('custom',{apiKey:'secret123',baseUrl:'https://demo.invalid'});
  assert.equal(loadProviderConfig('custom').apiKey,'secret123');
  saveProviderConfig('custom',{apiKey:'',baseUrl:'https://demo.invalid'});
  assert.equal(loadProviderConfig('custom').apiKey,'');
});
const testSession={text:'The quick brown fox jumps over the dog.',language:'en',textLength:39,events:[
  {type:'key',index:4,correct:false},{type:'key',index:5,correct:true},{type:'key',index:13,correct:false},{type:'key',index:14,correct:false},
]};
await check('mistake microscope groups real error words rather than letter salad',()=>{
  const errors=mistakeMicroscope(testSession);
  assert.equal(errors[0].word,'brown');assert.equal(errors[0].count,2);assert.equal(errors[1].word,'quick');
});
await check('mistake microscope handles joined Persian words without splitting scripts',()=>{
  const s={language:'fa',text:'این جمله برای تمرین است.',events:[{type:'key',index:10,correct:false}]};
  assert.ok(mistakeMicroscope(s).some(x=>x.word==='برای'));
});
await check('error timeline bins by text position, not key elapsed time',()=>{
  const buckets=errorTimeline(testSession,4);
  assert.equal(buckets.reduce((s,x)=>s+x.value,0),3);
  assert.equal(buckets.length,4);
});
await check('pace ghost and ETA are bounded and honest during warm-up',()=>{
  const first=paceGhost({index:2,total:1000,elapsedMs:1000,targetWpm:60});assert.equal(first.secondsLeft,null);
  const later=paceGhost({index:500,total:1000,elapsedMs:60000,targetWpm:60});assert.equal(later.ghostPct,30);assert.equal(later.secondsLeft,60);
  assert.equal(paceGhost({index:0,total:0,elapsedMs:0}).ghostPct,0);
});
await check('session comparison rejects unreliable historical data',()=>{
  const current={summary:{reliable:true,wpm:55,accuracy:97,consistency:80}};
  assert.equal(compareSession(current,{summary:{reliable:false,wpm:200000}}),null);
  assert.equal(compareSession(current,{id:'prev',summary:{reliable:true,wpm:50,accuracy:95,consistency:70}}).wpmDelta,5);
});
await check('daily quests exclude timing-anomalous runs and do not count passive time',()=>{
  const now=new Date();const today=now.getTime();const sessions=[
    {startedAt:today,language:'en',textId:'a',summary:{reliable:true,durationMs:600000,accuracy:99,typed:100}},
    {startedAt:today,language:'en',textId:'b',summary:{reliable:true,durationMs:400000,accuracy:94,typed:100}},
    {startedAt:today,language:'fa',textId:'c',summary:{reliable:true,durationMs:200000,accuracy:99,typed:100}},
    {startedAt:today,language:'en',textId:'d',summary:{reliable:false,durationMs:10000000,accuracy:100,typed:100}}
  ];
  const quests=dailyQuests(sessions,{today:now,dailyMinutes:15});assert.ok(quests.every(q=>q.complete));
  const en=dailyQuests(sessions,{today:now,dailyMinutes:15,language:'en'});assert.equal(en[2].complete,false);
});
await check('deck respects excluded source IDs and prevents tag fallback leakage',()=>{
  const samples=[{id:'a',language:'en',level:2,text:'alpha '.repeat(100)},{id:'b',language:'en',level:2,text:'bravo '.repeat(100)}];
  const one=pickFreshPassage(samples,{language:'en',level:2,targetChars:320,excludeIds:['a']});assert.equal(one.id,'b');
  const no=pickFreshPassage(samples,{language:'en',level:2,targetChars:320,tag:'punctuation'});assert.equal(no,null);
});
await check('reliable timing rejects events whose timestamps move backwards',()=>{
  const events=Array.from({length:12},(_,i)=>({type:'key',correct:true,t:1000+i*250,interval:i?250:0}));
  events[7].t=events[6].t-400;
  const summary=calculateSessionSummary({activeDurationMs:15000,events,intervals:events.slice(1).map(e=>e.interval)});
  assert.equal(summary.reliable,false);
});

// Use the real provider module under test; stub only Tauri imports (there are
// none on this runtime). In native mode the bridge remains unchanged.
const providerSource=fs.readFileSync(join(root,'app/ai/providers.js'),'utf8').replace("import { invoke } from '@tauri-apps/api/core';",'const invoke = async () => {throw new Error("unexpected native invoke");};');
const providers=await import('data:text/javascript;base64,'+Buffer.from(providerSource).toString('base64'));
await check('custom API model and chat URLs always contain a separator',()=>{
  assert.equal(providers.joinApiUrl('https://local.invalid/v1','models'),'https://local.invalid/v1/models');
  assert.equal(providers.joinApiUrl('http://127.0.0.1:10808/v1/','/chat/completions'),'http://127.0.0.1:10808/v1/chat/completions');
  assert.throws(()=>providers.joinApiUrl('https://local.invalid/v1','https://attacker.invalid'));
});
await check('AI model discovery cache is isolated per API key/account',async()=>{
  const oldFetch=globalThis.fetch;let calls=[];
  globalThis.fetch=async(url,options)=>{
    calls.push({url,auth:options.headers.Authorization});
    return {status:200,headers:{entries:()=>[]},text:async()=>JSON.stringify({data:[{id:options.headers.Authorization==='Bearer alpha'?'model-alpha':'model-beta'}]})};
  };
  try{
    const a=await providers.listProviderModels('groq',{apiKey:'alpha'});
    const b=await providers.listProviderModels('groq',{apiKey:'beta'});
    assert.equal(a[0].id,'model-alpha');assert.equal(b[0].id,'model-beta');assert.equal(calls.length,2);
  }finally{globalThis.fetch=oldFetch;}
});

// Inject a deterministic chat transport only; every production validator and
// repair loop runs unchanged. The first two responses deliberately violate
// language/duplicate constraints to catch the 2.4 loophole.
const genFile=fs.readFileSync(join(root,'app/ai/generator.js'),'utf8')
 .replace("import { providerChat } from './providers.js';",'const providerChat=()=>{throw new Error("transport must be injected");};')
 .replace("from '../core/content-validator.js'",`from '${pathToFileURL(join(root,'app/core/content-validator.js')).href}'`)
 .replace("from '../core/normalization.js'",`from '${pathToFileURL(join(root,'app/core/normalization.js')).href}'`);
const generator=await import('data:text/javascript;base64,'+Buffer.from(genFile).toString('base64'));
await check('AI rejects wrong language tags instead of treating mutated validation as OK',async()=>{
  const text='This is a well formed English passage about good software practices and a useful daily routine. '.repeat(5);
  let calls=0;
  const draft=await generator.generatePracticeText({providerId:'fake',config:{},model:'fake',options:{language:'en',length:'short',level:2,layoutId:'en-us',deepReview:false},chat:async()=>{calls++;return {text:JSON.stringify({title:'test',text,language:calls===1?'fa':'en',level:2,tags:['test']})};}});
  assert.ok(calls>=2);assert.equal(draft.language,'en');
});
await check('AI rejects duplicates, retries and accepts a fresh second draft',async()=>{
  const repeated='This is a well formed English passage about good software practices and a useful daily routine. '.repeat(5);
  const other='A careful editor reviews the project each week. Each new release includes improvements to reliability, accessibility, usability, and thoughtful writing. '.repeat(4);
  let calls=0;
  const draft=await generator.generatePracticeText({providerId:'fake',config:{},model:'fake',options:{language:'en',length:'short',level:2,layoutId:'en-us',deepReview:false,avoidTexts:[repeated]},chat:async()=>{calls++;return {text:JSON.stringify({title:'test',text:calls===1?repeated:other,language:'en',level:2,tags:[]})};}});
  assert.ok(calls>=2);assert.ok(!draft.text.includes('good software practices'));
});
await check('frontend navigation/version and new features remain wired',()=>{
  const source=fs.readFileSync(join(root,'app/main.js'),'utf8');
  for(const s of ['routeSerial','serial!==routeSerial','finish-eta','typing-ghost','pause-toggle','finish-microscope','lab-timeline','dailyQuests','compareSession'])assert.ok(source.includes(s),`Missing UI wiring: ${s}`);
  assert.ok(fs.readFileSync(join(root,'src-tauri/src/lib.rs'),'utf8').includes('Policy::none()'));
});
await check('per-key highlight painting defers geometry into requestAnimationFrame',()=>{
  const source=fs.readFileSync(join(root,'app/core/typing-engine.js'),'utf8');
  const hotPath=source.slice(source.indexOf('  _onKey(event){'),source.indexOf('  _backspace(){'));
  assert.ok(!hotPath.includes('getBoundingClientRect'));assert.ok(source.includes('_queueMarkerPaint'));
  assert.ok(source.includes('setInterval(()=>{if(this.startedAt'));
});
await check('backspace removes visible error markers before clearing the saved status',()=>{
  const engine=Object.create(TypingEngine.prototype);
  engine.statuses=new Uint8Array([2]);
  engine.statusRanges=[null];
  engine.useHighlights=false;
  let removed=0;
  engine.markerLayer={querySelector(selector){assert.equal(selector,'[data-status-index="0"]');return {remove(){removed++}};}};
  engine._removeStatus(0);
  assert.equal(engine.statuses[0],0);
  assert.equal(removed,1,'The previous mistake marker must vanish on backspace');
});
await check('IndexedDB open failure is not cached forever and can retry',async()=>{
  const existing=globalThis.indexedDB;
  let attempts=0;
  globalThis.indexedDB={open:()=>{
    attempts++;
    const request={};
    queueMicrotask(()=>{request.error=new Error('simulated storage outage');request.onerror?.();});
    return request;
  }};
  try{
    await assert.rejects(getSessions(),/simulated storage outage/);
    await assert.rejects(getSessions(),/simulated storage outage/);
    assert.equal(attempts,2);
  }finally{if(existing===undefined)delete globalThis.indexedDB;else globalThis.indexedDB=existing;}
});
await check('corrected errors are distinguished from raw accuracy penalties',()=>{
  const summary=calculateSessionSummary({startedAt:1,endedAt:60001,unresolvedErrors:0,events:[
    {type:'key',correct:true},{type:'key',correct:false},{type:'key',correct:true},
    {type:'key',correct:true},{type:'key',correct:true},{type:'key',correct:true}
  ]});
  assert.equal(summary.errors,1);assert.equal(summary.unresolvedErrors,0);
  assert.equal(summary.rawWpm,summary.wpm);
  assert.ok(summary.accuracy<100);
});
await check('deck reports when available library cannot fulfill target length',()=>{
  const item={id:'only',language:'en',level:1,text:'Short but valid practice passage here.'};
  const selected=pickFreshPassage([item],{language:'en',level:1,targetChars:1000});
  assert.ok(selected.shortfallChars>900);
});
await check('corrupted local deck/progression objects recover safely',()=>{
  localStorage.setItem('keyflow.seen','null');
  localStorage.setItem('keyflow.progression','[]');
  assert.deepEqual(getSeenState(),{});
  assert.deepEqual(loadProgression(),{en:{},fa:{}});
});
await check('daily variety requires distinct content, not recycled generated IDs',()=>{
  const now=new Date(),content='Practice text used for a repeat drill.';
  const entries=[{id:'session-a',textId:'deck-123',text:content},{id:'session-b',textId:'deck-456',text:content}]
   .map(s=>({...s,startedAt:now.getTime(),language:'en',summary:{reliable:true,durationMs:100000,typed:60,accuracy:99}}));
  const q=dailyQuests(entries,{today:now,language:'en'});
  assert.equal(q[2].progress,1/3);
});
await check('malformed saved provider configuration cannot crash AI studio',()=>{
  localStorage.setItem('keyflow.providers','null');
  assert.equal(loadProviderConfig('custom').apiKey,'');
  saveProviderConfig('custom',{apiKey:'',baseUrl:'https://valid.invalid/v1'});
  assert.equal(loadProviderConfig('custom').baseUrl,'https://valid.invalid/v1');
});
console.log(`\nKeyflow 2.5 regression audit: ${passed} passed, ${failed} failed`);
if(failed)process.exitCode=1;

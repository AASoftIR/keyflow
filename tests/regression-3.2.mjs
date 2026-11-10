/** KeyFlow v3.2: regressions based on actual reported incomplete-text and AI problems. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {
  pickFreshText,deckAvailability,commitSessionCompletions,reconcileFirstKeyHistory,
  contentFingerprint
} from '../app/core/shuffle-bag.js';
import {getSeenState,loadSettings,saveSettings,saveSeenState} from '../app/core/storage.js';
import {completedSourceIds} from '../app/next/review.js';
import {recordModelHealth,getModelHealth,preferHealthyFallbacks,resetModelHealth} from '../app/ai/model-health.js';

const store=new Map();
globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
const reset=()=>store.clear();
let count=0;
const test=async(label,fn)=>{reset();await fn();count++;console.log(`✓ v3.2: ${label}`)};
const texts=[
  {id:'first',language:'en',level:2,text:'A quiet morning brings fresh ideas and an opportunity to learn something useful. '},
  {id:'second',language:'en',level:2,text:'Another story describes a careful student and the books they practice reading. '},
  {id:'third',language:'en',level:2,text:'The final example concerns a creative studio that makes helpful software for people. '},
];
const now=1_800_000_000_000;
const summary={reliable:true,typed:80,accuracy:99,consistency:90,wpm:56};
const session=(data={})=>({id:'s1',language:'en',textId:'first',text:texts[0].text,
  completedChars:0,completionReason:'abandoned',summary,startedAt:now-60000,endedAt:now,...data});

await test('preview, start, and abandon do not consume texts or mutate seen storage',()=>{
  const seenBefore=JSON.stringify(getSeenState());
  const draft=pickFreshText(texts,{language:'en',level:2,now});
  assert.ok(draft);
  assert.equal(JSON.stringify(getSeenState()),seenBefore);
  const result=commitSessionCompletions(session({completedChars:25}),draft,{now});
  assert.deepEqual(result.completed,[]);
  assert.equal(deckAvailability(texts,{language:'en',level:2,now}).fresh,3);
  assert.equal(getSeenState()['deck:en'],undefined);
});

await test('only verified finish consumes one source and repeating the callback does not double count',()=>{
  const p=pickFreshText(texts,{language:'en',level:2,now});
  const completed=session({textId:p.id,text:p.text,completedChars:Array.from(p.text).length,completionReason:'passage'});
  const first=commitSessionCompletions(completed,p,{now});
  assert.deepEqual(first.completed,[p.id]);
  const second=commitSessionCompletions(completed,p,{now:now+1});
  assert.equal(second.saved,true);
  assert.equal(getSeenState()['deck:en'].history.length,1);
  assert.equal(deckAvailability(texts,{language:'en',level:2,now:now+2000}).fresh,2);
});

await test('mixed sprint consumes fully completed parts only, not the trailing unfinished source',()=>{
  const [a,b]=texts;
  const passage={id:'deck',language:'en',text:a.text+'\n\n'+b.text,
    sourceParts:[{id:a.id,start:0,end:a.text.length,text:a.text,originalText:a.text},
      {id:b.id,start:a.text.length+2,end:a.text.length+2+b.text.length,text:b.text,originalText:b.text}]};
  const partial=session({text:passage.text,textId:passage.id,sourceParts:passage.sourceParts,
    completedChars:a.text.length+1,completionReason:'sprint'});
  assert.deepEqual(completedSourceIds(partial),['first']);
  assert.deepEqual(commitSessionCompletions(partial,passage,{now}).completed,['first']);
  assert.equal(deckAvailability(texts,{language:'en',level:2,now}).fresh,2);
  assert.ok(pickFreshText(texts,{language:'en',level:2,excludeIds:['first'],now}));
});

await test('migration releases falsely used passages while retaining actual completed sessions',()=>{
  const history=texts.map((t,i)=>({id:t.id,fp:contentFingerprint(t.text),sample:t.text,at:now-i*100,committed:true}));
  saveSeenState({'deck:en':{freshSchema:3,history,recentIds:texts.map(t=>t.id),counts:{first:1,second:1,third:1},lastSeen:{first:now,second:now,third:now}}});
  const reliable=session({id:'real',completionReason:'passage',textId:'first',text:texts[0].text,completedChars:texts[0].text.length});
  const incomplete=session({id:'abandoned',completionReason:'sprint',textId:'second',text:texts[1].text,completedChars:8});
  const result=reconcileFirstKeyHistory([reliable,incomplete],texts,'en');
  assert.equal(result.changed,true);
  const migrated=getSeenState()['deck:en'];
  assert.equal(migrated.freshSchema,4);
  assert.deepEqual(migrated.history.map(h=>h.id),['first']);
  assert.equal(migrated.history[0].completed,true);
  assert.equal(deckAvailability(texts,{language:'en',level:2,now}).fresh,2);
  assert.equal(reconcileFirstKeyHistory([reliable],texts,'en').changed,false);
});

await test('quick-mode and customization preferences survive migration and validation',()=>{
  store.set('keyflow.settings',JSON.stringify({settingsSchema:11,sessionLength:'quick',theme:'violet',density:'compact',caretStyle:'block',practiceWidth:850,showKeyboard:false,aiPreset:'speed',aiAllowPaidModels:true}));
  const settings=loadSettings();
  assert.equal(settings.sessionLength,'quick');
  assert.ok(settings.settingsSchema>=12);
  for(const [key,val] of Object.entries({theme:'violet',density:'compact',caretStyle:'block',practiceWidth:850,showKeyboard:false,aiPreset:'speed',aiAllowPaidModels:true}))assert.equal(settings[key],val,key);
  saveSettings(settings);
  const loaded=loadSettings();assert.equal(loaded.theme,'violet');
  loaded.theme='unrecognized';loaded.aiPreset='unlimited';saveSettings(loaded);
  assert.equal(loadSettings().theme,'amber');assert.equal(loadSettings().aiPreset,'balanced');
});

let genSource=await readFile(new URL('../app/ai/generator.js',import.meta.url),'utf8');
for(const [from,to] of [
  ['./providers.js','data:text/javascript;base64,'+Buffer.from('export const providerChat=()=>{throw Error("mock only")};').toString('base64')],
  ['../core/content-validator.js',new URL('../app/core/content-validator.js',import.meta.url).href],
  ['../core/normalization.js',new URL('../app/core/normalization.js',import.meta.url).href],
])genSource=genSource.replace(`from '${from}'`,`from '${to}'`);
const {generatePracticeText}=await import('data:text/javascript;base64,'+Buffer.from(genSource).toString('base64'));
const opts={language:'en',length:'medium',level:2,layoutId:'en-us',topic:'writing',format:'practical',weakCharacters:[],allowDiacritics:false,avoidTexts:[],aiTokenBudget:8192,aiReasoningMode:'low',deepReview:false};
await test('Speed mode has a hard two-call budget and does not retry HTTP 503 on same model',async()=>{
  const calls=[],events=[];
  const chat=async(_id,_cfg,model)=>{calls.push(model);const e=new Error('Service temporarily unavailable');e.status=503;throw e;};
  await assert.rejects(()=>generatePracticeText({providerId:'openrouter',config:{apiKey:'fake'},model:'one',fallbackModels:['two','three'],options:{...opts,aiPreset:'speed'},chat,onEvent:e=>events.push(e)}),e=>e.message.includes('2/2 bounded requests')&&e.diagnostics.requests===2);
  assert.deepEqual(calls,['one','two']);
  assert.ok(events.some(e=>e.phase==='failure'));
});

await test('Dahl quota / invalid key fail immediately with diagnostic trace and no credential disclosure',async()=>{
  const calls=[],key='VERY_PRIVATE_TOKEN';
  const chat=async()=>{calls.push('request');const e=new Error('API reports '+key+' invalid');e.status=402;throw e;};
  await assert.rejects(()=>generatePracticeText({providerId:'dahl',config:{apiKey:key},model:'first',fallbackModels:['other'],options:{...opts,aiPreset:'quality'},chat}),e=>e.status===402&&!e.message.includes(key)&&e.diagnostics.requests===1&&!JSON.stringify(e.diagnostics).includes(key));
  assert.equal(calls.length,1);
});

await test('reasoning-token exhaustion gets one adjusted recovery with increased token budget',async()=>{
  const calls=[];
  const chat=async(_id,_cfg,model,_msg,settings)=>{calls.push({model,...settings});const e=new Error('4800 reasoning tokens, no readable text');e.code='EMPTY_COMPLETION';e.finishReason='length';throw e;};
  await assert.rejects(()=>generatePracticeText({providerId:'openrouter',config:{apiKey:'secret'},model:'deep-reasoner',fallbackModels:['text-model'],options:{...opts,aiPreset:'balanced',aiTokenBudget:6000},chat}),/bounded requests/);
  assert.equal(calls[1].model,'deep-reasoner');
  assert.equal(calls[1].reasoningMode,'minimal');
  assert.ok(calls[1].maxTokens>calls[0].maxTokens);
  assert.equal(calls[2].model,'text-model');
});

await test('cancelled AI generation stops the planner before processing a late response',async()=>{
  const controller=new AbortController();let calls=0;
  const chat=async()=>{calls++;controller.abort();return {text:JSON.stringify({title:'Ignored',text:'Text',language:'en'})};};
  await assert.rejects(()=>generatePracticeText({providerId:'openrouter',config:{},model:'model',options:{...opts,aiPreset:'quality'},chat,signal:controller.signal}),e=>e.code==='ABORTED');
  assert.equal(calls,1);
});

await test('health-aware routing temporarily avoids repeatedly empty models without blocking explicit choice',()=>{
  const t=now;
  recordModelHealth('openrouter','reasoning-only',{kind:'empty',now:t});
  recordModelHealth('openrouter','reasoning-only',{kind:'empty',now:t+1000});
  recordModelHealth('openrouter','reasoning-only',{kind:'empty',now:t+2000});
  recordModelHealth('openrouter','fast-text',{ok:true,now:t+2000});
  assert.equal(getModelHealth('openrouter','reasoning-only',t+3000).isCoolingDown,true);
  assert.deepEqual(preferHealthyFallbacks('openrouter',['reasoning-only','fast-text'],t+3000),['fast-text']);
  assert.deepEqual(preferHealthyFallbacks('openrouter',['reasoning-only'],t+3000),['reasoning-only']);
  assert.equal(getModelHealth('dahl','reasoning-only',t+3000).failures,0);
  recordModelHealth('openrouter','reasoning-only',{ok:true,now:t+4000});
  assert.equal(getModelHealth('openrouter','reasoning-only',t+4000).isCoolingDown,false);
  resetModelHealth('openrouter');
  assert.equal(getModelHealth('openrouter','reasoning-only').failures,0);
});

await test('provider credit failures never poison model health, and health records contain no secrets',()=>{
  recordModelHealth('dahl','MiniMax M2.7',{kind:'account',now});
  assert.equal(getModelHealth('dahl','MiniMax M2.7').failures,0);
  recordModelHealth('dahl','MiniMax M2.7',{kind:'temporary',now});
  const data=String(store.get('keyflow.ai-model-health.v1'));
  assert.equal(data.includes('API key'),false);
  assert.equal(data.includes('private'),false);
});

await test('new interface exposes personalized appearance and bounded AI generation controls',async()=>{
  const main=await readFile(new URL('../app/main.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../app/styles.css',import.meta.url),'utf8');
  for(const id of ['s-theme','s-density','s-caret','s-width','s-keyboard','gen-preset','cancel-generation','ai-trace','ai-include-paid','model-health','reset-ai-health'])assert.ok(main.includes(id),id);
  assert.match(main,/commitSessionCompletions\(s,text/);
  assert.doesNotMatch(main,/commitPassageExposure\(/);
  assert.ok(css.includes('body[data-theme="violet"]') || css.includes('[data-theme="violet"]'));
});
console.log(`\n${count} v3.2 reliability regression checks passed.`);

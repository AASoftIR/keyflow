import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {makeTimeTrialPlan,normalizeTimeTrialMode,timeTrialRemaining,timeTrialResult} from '../app/core/time-trial.js';
import {TypingEngine} from '../app/core/typing-engine.js';
import {completedSourceIds} from '../app/next/review.js';
import {perPassageHistory} from '../app/core/library-analytics.js';

let passed=0;
async function test(label,fn){await fn();passed++;console.log('✓ v3.5: '+label);}
const sample='A calm library helps people learn to type. Each visitor can find a story, listen to the rhythm of keys, and gradually develop a better routine.';

await test('difficulty, language, length, punctuation and pro pace change passage allowance',()=>{
  const regular=makeTimeTrialPlan(sample,{language:'en',level:3,mode:'steady'});
  const expert=makeTimeTrialPlan(sample,{language:'en',level:5,mode:'steady'});
  const pro=makeTimeTrialPlan(sample,{language:'en',level:3,mode:'pro'});
  const longer=makeTimeTrialPlan(sample.repeat(3),{language:'en',level:3,mode:'steady'});
  const symbols=makeTimeTrialPlan(sample.replace('calm','45,?'),{language:'en',level:3,mode:'steady'});
  const persian=makeTimeTrialPlan('امروز مردم در کتابخانهٔ شهر تمرین تایپ می‌کنند. '.repeat(6),{language:'fa',level:4,mode:'steady'});
  assert.ok(regular.allowanceMs<expert.allowanceMs);
  assert.ok(pro.allowanceMs<regular.allowanceMs);
  assert.ok(longer.allowanceMs>regular.allowanceMs);
  assert.ok(symbols.effort>makeTimeTrialPlan(sample.replace('calm','abcd'),{mode:'steady'}).effort);
  assert.ok(persian.characters>0&&persian.allowanceMs>0);
  assert.equal(normalizeTimeTrialMode('invalid'),'off');
  assert.equal(makeTimeTrialPlan(sample,{mode:'off'}),null);
});

await test('remaining time uses active milliseconds and respects boundary',()=>{
  const plan=makeTimeTrialPlan(sample,{mode:'steady'});
  assert.equal(timeTrialRemaining(0,plan),plan.allowanceMs/1000);
  assert.equal(timeTrialRemaining(plan.allowanceMs-1,plan),1);
  assert.equal(timeTrialRemaining(plan.allowanceMs,plan),0);
  assert.equal(timeTrialRemaining(plan.allowanceMs+5000,plan),0);
});

await test('time trial stops with one character, saves its actual effort and never credits text completion',()=>{
  const plan=makeTimeTrialPlan('abcdef',{mode:'pro'});
  const engine=new TypingEngine({language:'en'});
  engine.reset('abcdef',{id:'ai-abcdef1234',title:'Partial run',level:3,sourceIds:['ai-abcdef1234'],timeTrial:plan});
  engine.active=true;engine.stop=()=>{engine.active=false;};engine._mark=()=>{};engine._syncCurrent=()=>{};engine._emitProgress=()=>{};engine._feedback=()=>{};
  const completed=[];engine.addEventListener('finish',event=>completed.push(event.detail));
  const press=key=>engine._onKey({key,code:'KeyA',timeStamp:performance.now(),preventDefault(){},getModifierState(){return false;}});
  press('a');assert.equal(engine.index,1);assert.equal(engine.finished,false);
  engine.activeElapsedMs=plan.allowanceMs;engine.activeSegmentStartedPerf=0;
  press('b');assert.equal(engine.index,1);assert.equal(engine.finished,true);
  assert.equal(completed.length,1);assert.equal(completed[0].completionReason,'time-trial');
  assert.equal(completed[0].completedChars,1);assert.equal(completed[0].summary.typed,1);
  assert.deepEqual(completedSourceIds(completed[0]),[]);
  const review=timeTrialResult(completed[0]);
  assert.equal(review.succeeded,false);assert.equal(review.remainingChars,5);
  assert.ok(review.score>=0&&review.score<100);
});

await test('full passage under deadline is a pass, but partial sessions have a coverage-weighted grade',()=>{
  const plan=makeTimeTrialPlan('a'.repeat(100),{mode:'steady'});
  const base={textLength:100,completedChars:100,completionReason:'passage',timeTrial:plan,activeDurationMs:plan.allowanceMs-1000,summary:{accuracy:98}};
  assert.equal(timeTrialResult(base).succeeded,true);
  assert.equal(timeTrialResult({...base,activeDurationMs:plan.allowanceMs+500}).succeeded,false);
  const partial=timeTrialResult({...base,completedChars:42,completionReason:'time-trial',summary:{accuracy:75}});
  assert.deepEqual([partial.completion,partial.score,partial.remainingChars],[42,32,58]);
});

await test('Library retains partial time-trial detail but credits zero completed source parts',()=>{
  const passages=[{id:'piece-a',language:'en',text:'apple'},{id:'piece-b',language:'en',text:'berry'}];
  const plan=makeTimeTrialPlan('appleberry',{mode:'steady'});
  const session={id:'trial',language:'en',text:'appleberry',textId:'composite',sourceIds:['piece-a','piece-b'],
    sourceParts:[{id:'piece-a',start:0,end:5},{id:'piece-b',start:5,end:10}],textLength:10,
    completionReason:'time-trial',completedChars:7,timeTrial:plan,startedAt:1000,endedAt:42000,
    activeDurationMs:41000,summary:{reliable:true,accuracy:85,wpm:10,durationMs:41000}};
  const h=perPassageHistory(passages,[session]);
  assert.equal(h.get('piece-a').attempts,1);
  assert.equal(h.get('piece-a').completions,0);
  assert.equal(h.get('piece-b').completions,0);
  assert.equal(h.get('piece-a').runs[0].trial.succeeded,false);
  assert.equal(h.get('piece-a').runs[0].trial.completion,70);
});

let providerSource=await readFile(new URL('../app/ai/providers.js',import.meta.url),'utf8');
providerSource=providerSource.replace(/^import \{ invoke \} from '@tauri-apps\/api\/core';/m,"const invoke=async()=>{throw Error('unused')};");
const providers=await import('data:text/javascript;base64,'+Buffer.from(providerSource).toString('base64'));
const ok=content=>({status:200,text:async()=>JSON.stringify({choices:[{message:{content}}]}),headers:new Map()});

await test('Groq Qwen uses top-level reasoning_effort none, never OpenRouter reasoning map',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return ok('Readable answer.');};
  try{
    await providers.providerChat('groq',{apiKey:'fake'},'qwen/qwen3.8-27b',[{role:'user',content:'Hello'}],{retries:0,maxTokens:900,reasoningMode:'none'});
    assert.equal(calls[0].url,'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(calls[0].body.reasoning_effort,'none');
    assert.equal(calls[0].body.reasoning,undefined);
    assert.equal(calls[0].body.max_completion_tokens,900);
  }finally{globalThis.fetch=original;}
});

await test('Groq GPT-OSS never turns low-effort into unsupported none or minimal',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(_url,opts)=>{calls.push(JSON.parse(opts.body));return ok('Visible text.');};
  try{
    await providers.providerChat('groq',{apiKey:'fake'},'openai/gpt-oss-20b',[{role:'user',content:'Hello'}],{retries:0,maxTokens:900,reasoningMode:'none'});
    assert.equal(calls[0].reasoning_effort,'low');assert.equal(calls[0].reasoning,undefined);
    assert.equal(calls[0].temperature,undefined);
  }finally{globalThis.fetch=original;}
});

let generatorSource=await readFile(new URL('../app/ai/generator.js',import.meta.url),'utf8');
for(const [from,to] of [
  ['./providers.js','data:text/javascript;base64,'+Buffer.from('export const providerChat=async()=>{}').toString('base64')],
  ['../core/content-validator.js',new URL('../app/core/content-validator.js',import.meta.url).href],
  ['../core/normalization.js',new URL('../app/core/normalization.js',import.meta.url).href]
])generatorSource=generatorSource.replace(`from '${from}'`,`from '${to}'`);
const generator=await import('data:text/javascript;base64,'+Buffer.from(generatorSource).toString('base64'));
const options={language:'en',length:'medium',level:3,layoutId:'en-us',topic:'observatories',format:'practical',weakCharacters:[],avoidTexts:[],allowDiacritics:false,aiPreset:'speed',aiTokenBudget:16000,aiReasoningMode:'low',deepReview:false};

await test('a 1713+ character coherent draft can be sentence-trimmed locally, with one request',async()=>{
  const text=Array.from({length:21},(_,i)=>`At the observatory, analyst ${i+1} studied clouds above the northern hills while the evening light changed gradually.`).join(' ');
  assert.ok(text.length>1713);
  const trimmed=generator.trimExcessAtSentence(text,{min:540,max:1050});
  assert.ok(trimmed.length>=540&&trimmed.length<=1050);
  assert.match(trimmed,/gradually\.$/);
  const events=[];let calls=0;
  const result=await generator.generatePracticeText({providerId:'groq',config:{apiKey:'fake'},model:'qwen/qwen3.8-27b',options,
    chat:async()=>{calls++;return {text:JSON.stringify({title:'Evening observations',text,language:'en',level:3,tags:[]})};},
    onEvent:event=>events.push(event)});
  assert.equal(calls,1);assert.ok(result.text.length<=1050);
  assert.ok(events.some(e=>e.phase==='local-repair'));
  assert.ok(result.diagnostics.trace.some(e=>e.kind==='local-length-repair'));
});

await test('429 then reasoning-only length exhausts only two Groq calls and never requests 16000 tokens',async()=>{
  const calls=[],events=[];
  const chat=async(_id,_cfg,model,_messages,opts)=>{
    calls.push({model,...opts});
    if(model.startsWith('qwen/')){const error=new Error('OTPM limit 1000, used 554');error.status=429;error.retryAfter=42;throw error;}
    const error=new Error('No visible text; 15998 reasoning tokens');error.code='EMPTY_COMPLETION';error.finishReason='length';error.reasoningTokens=15998;throw error;
  };
  await assert.rejects(()=>generator.generatePracticeText({providerId:'groq',config:{apiKey:'fake'},model:'qwen/qwen3.8-27b',fallbackModels:['openai/gpt-oss-20b'],options,chat,onEvent:e=>events.push(e)}),error=>{
    assert.equal(error.diagnostics.requests,2);
    assert.deepEqual(error.diagnostics.trace.map(x=>x.kind),['rate-limit','empty']);return true;
  });
  assert.equal(calls.length,2);
  assert.ok(calls.every(x=>x.maxTokens<=900));
  assert.equal(calls[0].reasoningMode,'none');
  assert.equal(calls[1].reasoningMode,'low');
  assert.equal(events.find(e=>e.kind==='rate-limit').retryAfter,42);
});

await test('rate-limited models cool down immediately instead of earning three 429 failures',async()=>{
  let healthSource=await readFile(new URL('../app/ai/model-health.js',import.meta.url),'utf8');
  healthSource=healthSource.replace("from '../core/storage.js'","from 'data:text/javascript;base64,"+Buffer.from('const db={};export const loadJson=(key,fallback)=>db[key]||fallback;export const saveJson=(key,value)=>{db[key]=value;return true;};').toString('base64')+"'");
  const health=await import('data:text/javascript;base64,'+Buffer.from(healthSource).toString('base64'));
  const now=1700000000000;
  const after=health.recordModelHealth('groq','qwen/qwen3.8-27b',{kind:'rate-limit',retryAfter:40,now});
  assert.equal(after.isCoolingDown,true);
  assert.equal(after.blockedUntil,now+40000);
  assert.deepEqual(health.preferHealthyFallbacks('groq',['qwen/qwen3.8-27b','other'],now+500),['other']);
});

await test('practice UI exposes adaptive choice, partial report and auto countdown but no timer in key handler',async()=>{
  const main=await readFile(new URL('../app/main.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../app/studio.css',import.meta.url),'utf8');
  assert.match(main,/id="practice-time-trial"/);
  assert.match(main,/id="time-trial-clock"/);
  assert.match(main,/engine\.finishTimeTrial\(\)/);
  assert.match(main,/timeTrialResult\(s\)/);
  assert.match(main,/timeTrial \|\| !engine\.startedAt/);
  assert.match(css,/\.time-trial-board\{/);
});

console.log(`\n${passed} KeyFlow 3.5 regression checks passed.`);

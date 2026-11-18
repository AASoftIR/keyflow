import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TypingEngine, printablePracticeKey} from '../app/core/typing-engine.js';

let source=await readFile(new URL('../app/ai/providers.js',import.meta.url),'utf8');
source=source.replace(/^import \{ invoke \} from '@tauri-apps\/api\/core';/m,"const invoke=async()=>{throw Error('native mock')};");
const ai=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
let count=0;
async function verify(name,fn){await fn();count++;console.log('✓ 2.8.2: '+name);}
const success=json=>({status:200,text:async()=>JSON.stringify(json),headers:new Map()});
const fail=(status,message)=>({status,text:async()=>JSON.stringify({error:{message}}),headers:new Map()});
const models={data:[{id:'MiniMaxAI/MiniMax-M2.7',name:'MiniMax M2.7'},{id:'deepseek-ai/DeepSeek-V4-Flash-0731',name:'DeepSeek Flash'}]};
await verify('Dahl discovers public live models without any API key and selects MiniMax for writing',async()=>{
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return success(models);};
  try{
    const found=await ai.listProviderModels('dahl',{apiKey:''},{force:true});
    assert.equal(found.length,2);
    assert.equal(calls[0].url,'https://inference.dahl.global/v1/models');
    assert.equal(calls[0].opts.headers.Authorization,undefined);
    assert.equal(ai.pickRecommendedModel(found).id,'MiniMaxAI/MiniMax-M2.7');
  }finally{globalThis.fetch=original;}
});
await verify('Dahl POST matches documented OpenAI-compatible format and uses the key without leaking it',async()=>{
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,opts)=>{calls.push({url,opts});return success({choices:[{message:{content:'Persian prose'}}]});};
  try{
    const result=await ai.providerChat('dahl',{apiKey:'private-key'},'MiniMaxAI/MiniMax-M2.7',[{role:'user',content:'Write a typing passage'}],{retries:0,maxTokens:8192,reasoningMode:'none'});
    assert.equal(result.text,'Persian prose');
    assert.equal(calls[0].url,'https://inference.dahl.global/v1/chat/completions');
    assert.equal(calls[0].opts.headers.Authorization,'Bearer private-key');
    const body=JSON.parse(calls[0].opts.body);
    assert.equal(body.model,'MiniMaxAI/MiniMax-M2.7');
    assert.equal(body.messages[0].role,'user');
    assert.equal(body.max_tokens,8192);
    assert.equal(body.reasoning,undefined);
    assert.equal(body.temperature,undefined);
  }finally{globalThis.fetch=original;}
});
await verify('Dahl token balance and invalid model errors have practical diagnostics with no credential disclosure',async()=>{
  const original=globalThis.fetch;
  try{
    for(const [code,detail,contains] of [[402,'available tokens exhausted','allocate tokens'],[401,'Invalid API token','API key'],[400,'This model is not currently offered','Refresh the live model catalog']]){
      globalThis.fetch=async()=>fail(code,detail);
      await assert.rejects(()=>ai.providerChat('dahl',{apiKey:'secret'},'retired',[{role:'user',content:'x'}],{retries:0}),e=>e.status===code&&e.message.includes(contains)&&!e.message.includes('secret'));
    }
    await assert.rejects(()=>ai.providerChat('dahl',{},'any',[{role:'user',content:'x'}],{retries:0}),/API key required/);
  }finally{globalThis.fetch=original;}
});
await verify('OpenRouter returns visible-text exhaustion metadata rather than claiming a model-list success',async()=>{
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,opts)=>{calls.push(JSON.parse(opts.body));return success({choices:[{message:{content:''},finish_reason:'length'}],usage:{completion_tokens:4800,completion_tokens_details:{reasoning_tokens:4799}}});};
  try{
    await assert.rejects(()=>ai.providerChat('openrouter',{apiKey:'test'},'model/free',[{role:'user',content:'hi'}],{retries:0,maxTokens:4800,reasoningMode:'low'}),e=>e.code==='EMPTY_COMPLETION' && e.finishReason==='length' && e.reasoningTokens===4799);
    assert.equal(calls.length,1);
    assert.equal(calls[0].max_completion_tokens,4800);
    assert.deepEqual(calls[0].reasoning,{effort:'low'});
    assert.equal(calls[0].temperature,undefined);
  }finally{globalThis.fetch=original;}
});
await verify('Typing engine attempts expose both real incorrect key and expected key in Latin and Persian',()=>{
  for(const [lang,target,key] of [['en','abcd','z'],['fa','سلام','ب']]){
    const eng=new TypingEngine({language:lang,strictAccuracy:false});
    eng.active=true;eng.reset(target);eng.active=true;
    const received=[];eng.addEventListener('attempt',e=>received.push(e.detail));
    // Stub out view/sound/timer operations: verify actual keyboard logic and event data.
    eng._mark=()=>{};eng._syncCurrent=()=>{};eng._emitProgress=()=>{};eng._feedback=()=>{};
    eng._onKey({key,code:'KeyZ',timeStamp:performance.now(),preventDefault(){},getModifierState(){return false;}});
    assert.equal(received.length,1);
    assert.equal(received[0].correct,false);
    assert.equal(received[0].key,key);
    assert.equal(received[0].expected,lang==='en'?'a':'س');
    assert.equal(eng.index,1);
    assert.equal(eng.errors,1);
    eng.active=false;
  }
});
await verify('Strict accuracy keeps the cursor and the wrong-key display formats special characters',()=>{
  const eng=new TypingEngine({language:'en',strictAccuracy:true});eng.active=true;eng.reset('abcd');eng.active=true;
  let actual;eng.addEventListener('attempt',e=>actual=e.detail);
  eng._mark=()=>{};eng._syncCurrent=()=>{};eng._emitProgress=()=>{};eng._feedback=()=>{};
  eng._onKey({key:'b',code:'KeyB',timeStamp:performance.now(),preventDefault(){},getModifierState(){return false;}});
  assert.equal(eng.index,0);assert.equal(actual.key,'b');assert.equal(actual.expected,'a');
  assert.equal(printablePracticeKey(' '),'Space (␣)');
  assert.equal(printablePracticeKey('\n'),'Enter (↵)');
  assert.equal(printablePracticeKey('\t'),'Tab (⇥)');
  assert.equal(printablePracticeKey('‌'),'Half-space (ZWNJ)');
  eng.active=false;
});
await verify('Typing UI has a reachable live wrong-vs-expected readout and non-blocking update path',async()=>{
  const main=await readFile(new URL('../app/main.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../app/styles.css',import.meta.url),'utf8');
  assert.match(main,/id="mistake-typed"/);assert.match(main,/id="mistake-expected"/);
  assert.match(main,/mistyped\.textContent=printablePracticeKey\(e\.detail\.key\)/);
  assert.match(main,/mistakeExpected\.textContent=printablePracticeKey\(e\.detail\.expected\)/);
  assert.match(css,/\.mistake-feedback\[hidden\]\{display:none!important\}/);
  assert.doesNotMatch(main,/mistakeBox\.offsetWidth/);
});


await verify('Generator recovers a reasoning-only length result once before switching models',async()=>{
  let genSource=await readFile(new URL('../app/ai/generator.js',import.meta.url),'utf8');
  const imports=[
    ['./providers.js',"data:text/javascript;base64,"+Buffer.from("export const providerChat=()=>{throw Error(\"unused\")};").toString("base64")],
    ['../core/content-validator.js',new URL('../app/core/content-validator.js',import.meta.url).href],
    ['../core/normalization.js',new URL('../app/core/normalization.js',import.meta.url).href],
  ];
  for(const [from,to] of imports)genSource=genSource.replace(`from '${from}'`,`from '${to}'`);
  const gen=await import(`data:text/javascript;base64,${Buffer.from(genSource).toString('base64')}`);
  const paragraph='A quiet library offers a simple place for focused practice. Visitors arrive with notebooks, read short stories, and write down their questions. The librarian keeps the shelves tidy, helps new readers find useful books, and encourages everyone to return tomorrow. A good routine begins with short sessions and builds through steady attention. ';
  const sample=paragraph.repeat(3).slice(0,730);
  const response=JSON.stringify({title:'Library practice',text:sample,language:'en',level:3,tags:['practice']});
  const calls=[];
  const mock=async(_id,_cfg,model,_messages,opts)=>{
    calls.push({model,opts});
    if(calls.length===1){const err=new Error('No visible text');err.code='EMPTY_COMPLETION';err.finishReason='length';throw err;}
    return {text:response};
  };
  const result=await gen.generatePracticeText({
    providerId:'openrouter',config:{apiKey:'fixture'},model:'reasoning-model',fallbackModels:['text-model'],
    options:{language:'en',length:'medium',level:3,layoutId:'en-us',topic:'reading',format:'practical',weakCharacters:[],allowDiacritics:false,avoidTexts:[],aiTokenBudget:6000,aiReasoningMode:'low',deepReview:false},
    calibration:{},chat:mock
  });
  assert.equal(calls.length,2);
  assert.equal(calls[0].opts.maxTokens,6000);
  assert.equal(calls[1].opts.reasoningMode,'minimal');
  assert.ok(calls[1].opts.maxTokens>6000);
  assert.equal(result.model,'reasoning-model');
  assert.equal(result.language,'en');
});

console.log(`\n${count} v2.8.2 checks passed.`);

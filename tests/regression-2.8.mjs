import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {perPassageHistory} from '../app/core/library-analytics.js';
import {stageEvidence,nextEarnedStage} from '../app/core/mastery.js';
import {pickFreshPassage,commitPassageExposure,deckAvailability,reconcileLegacyExposures,contentFingerprint} from '../app/core/shuffle-bag.js';

let count=0;
async function check(name,run){await run();console.log('✓ 2.8: '+name);count++;}
const storage=new Map();
globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)};
const mk=(id,text)=>({id,title:id,text,language:'en',level:3,tags:['technical']});
const a=mk('a','The clear river follows a quiet valley, where the farmers plant apple trees and monitor their soil with care. Every morning they share fresh observations.');
const b=mk('b','During an expedition, researchers explore a remote mountain trail and record unusual cloud formations. They compare samples in their field notebook and return safely.');
const clock=Date.UTC(2026,9,23);
await check('previewed sections are not marked as practiced',()=>{
  storage.clear();const deck=pickFreshPassage([a,b],{language:'en',targetChars:500,now:clock,record:false});
  assert.deepEqual(new Set(deck.sourceIds),new Set(['a','b']));
  assert.equal(deckAvailability([a,b],{language:'en',now:clock}).fresh,2);
  commitPassageExposure({...deck,sourceParts:[deck.sourceParts[0]]},{now:clock});
  const available=deckAvailability([a,b],{language:'en',now:clock+500});
  assert.equal(available.fresh,1);
  const untouched=deck.sourceIds[1];
  assert.equal(pickFreshPassage([a,b],{language:'en',now:clock+1000,record:false,single:true})?.id,untouched);
});
await check('old shown-only history is reconciled against real sessions',()=>{
  storage.clear();
  const history=[a,b].map(p=>({id:p.id,fp:contentFingerprint(p.text),at:clock-100,sample:p.text}));
  storage.set('keyflow.seen',JSON.stringify({'deck:en':{freshSchema:2,history,counts:{a:1,b:1},lastSeen:{a:clock-100,b:clock-100},recentIds:['a','b'],recentFingerprints:history.map(h=>h.fp)}}));
  const restored=reconcileLegacyExposures([{language:'en',completedChars:a.text.length,textId:'a',text:a.text,sourceIds:['a']}],[a,b],'en');
  assert.equal(restored.restored,1);
  const available=deckAvailability([a,b],{language:'en',now:clock});assert.equal(available.fresh,1);
});
await check('mixed-session library history credits only reached sections',()=>{
  const list=[a,b];const start=a.text.length+2;
  const base={id:'s1',language:'en',textId:'deck-en-1',sourceIds:['a','b'],sourceParts:[{id:'a',start:0,end:a.text.length},{id:'b',start,end:start+b.text.length}],text:`${a.text}\n\n${b.text}`,textLength:a.text.length+2+b.text.length,startedAt:clock,endedAt:clock+60_000,activeDurationMs:60_000,summary:{wpm:44,accuracy:97,reliable:true},completionReason:'sprint'};
  let h=perPassageHistory(list,[{...base,completedChars:a.text.length-3}]);
  assert.equal(h.get('a').attempts,1);assert.equal(h.get('b').attempts,0);
  h=perPassageHistory(list,[{...base,completedChars:start+20}]);
  assert.equal(h.get('a').attempts,1);assert.equal(h.get('b').attempts,1);
  assert.equal(h.get('b').completions,0);
  assert.ok(h.get('b').minutes<1 && h.get('b').minutes>0);
});
await check('Library includes sessions abandoned after actual typing, not preview-only passages',()=>{
  const entries={ 'deck:en':{history:[
    {id:'a',fp:contentFingerprint(a.text),at:clock,committed:true},
    {id:'b',fp:contentFingerprint(b.text),at:clock,committed:false}
  ]}};
  const h=perPassageHistory([a,b],[],entries);
  assert.equal(h.get('a').started,1);
  assert.equal(h.get('b').started,0);
  assert.equal(h.get('a').attempts,0);
});
await check('mastery requires three different reliable completions, not XP or repeat grinding',()=>{
  const complete=id=>({language:'en',level:3,textId:id,completionReason:'passage',completedChars:200,textLength:200,summary:{reliable:true,wpm:44,accuracy:98,consistency:80}});
  assert.equal(stageEvidence([complete('one'),complete('one'),complete('one')],'en',3,40).successes,1);
  const three=['one','two','three'].map(complete);
  assert.equal(stageEvidence(three,'en',3,40).unlocked,true);
  assert.equal(nextEarnedStage(three,'en',3,40),4);
  assert.equal(stageEvidence([...three,{...complete('four'),completionReason:'sprint'}],'en',4,40).unlocked,false);
});
let providerSource=await readFile(new URL('../app/ai/providers.js',import.meta.url),'utf8');
providerSource=providerSource.replace(/^import \{ invoke \} from '@tauri-apps\/api\/core';/m,'const invoke=async()=>{throw Error("browser mock only")};');
const providers=await import(`data:text/javascript;base64,${Buffer.from(providerSource).toString('base64')}`);
await check('AI completion parser accepts OpenAI, Gemini, Workers, Responses and parts',()=>{
  const cases=[
    {choices:[{message:{content:'alpha'}}]},
    {choices:[{message:{content:[{type:'text',text:'alpha'}]}}]},
    {output:[{content:[{type:'output_text',text:'alpha'}]}]},
    {candidates:[{content:{parts:[{text:'alpha'}]}}]},
    {result:{response:'alpha'}},
    {data:{choices:[{message:{content:'alpha'}}]}}
  ];
  for(const c of cases)assert.equal(providers.extractCompletionText(c),'alpha');
  assert.throws(()=>providers.extractCompletionText({choices:[{message:{content:null},finish_reason:'length'}],usage:{completion_tokens:100}}),e=>e.code==='EMPTY_COMPLETION'&&e.message.includes('finish=length'));
});
await check('AI ignores nontext model catalog entries and can parse unexpected SSE',async()=>{
  assert.equal(providers.isTextCapableModel({id:'some/tts-model'}),false);
  assert.equal(providers.isTextCapableModel({id:'text/small:free',raw:{architecture:{output_modalities:['text']}}}),true);
  const original=globalThis.fetch;
  globalThis.fetch=async()=>({status:200,text:async()=>['data: {"choices":[{"delta":{"content":"hello"}}]}','data: {"choices":[{"delta":{"content":" world"}}]}','data: [DONE]'].join('\n'),headers:new Map()});
  try{const response=await providers.PROVIDERS.custom.chat({baseUrl:'https://example.test/v1'},'test-model',[{role:'user',content:'hi'}]);assert.equal(response.text,'hello world');}finally{globalThis.fetch=original;}
});
await check('AI sends modern token limits and adapts rejected sampling parameters',async()=>{
  const original=globalThis.fetch, calls=[];
  globalThis.fetch=async(_url,opts)=>{
    const body=JSON.parse(opts.body);calls.push(body);
    if(body.temperature!=null)return {status:400,text:async()=>JSON.stringify({error:{message:'temperature parameter not supported'}}),headers:new Map()};
    return {status:200,text:async()=>JSON.stringify({choices:[{message:{content:'verified completion'}}]}),headers:new Map()};
  };
  try{
    const cfg={apiKey:'test-key',proxyUrl:''};
    assert.equal((await providers.providerChat('openrouter',cfg,'a-text-model:free',[{role:'user',content:'hi'}],{retries:0})).text,'verified completion');
    assert.ok(calls[0].max_completion_tokens>3000);
    assert.equal(calls[0].max_tokens,undefined);
    assert.equal(calls.length,1);
    assert.equal(calls[0].temperature,undefined);
    calls.length=0;
    assert.equal((await providers.providerChat('gemini',cfg,'gemini-chat',[{role:'user',content:'hi'}],{retries:0})).text,'verified completion');
    assert.equal(calls.length,1);
    assert.equal(calls[0].temperature,undefined);
  }finally{globalThis.fetch=original;}
});
console.log(`\n${count} Keyflow 2.8 regression tests passed.`);

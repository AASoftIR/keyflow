import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TypingEngine} from '../app/core/typing-engine.js';
import {graphemes} from '../app/core/normalization.js';
import {KeyboardMapper} from '../app/core/layouts.js';
import {buildReplayTimeline,replayAt,formatReplayTime} from '../app/core/replay-timeline.js';
import {summarizeFrames,profileFrames} from '../app/core/frame-profiler.js';
import {loadSettings} from '../app/core/storage.js';
import {createBackup} from '../app/next/vault.js';

let passed=0;
async function test(label,fn){await fn();passed++;console.log('✓ v3.7: '+label);}
const main=await readFile(new URL('../app/main.js',import.meta.url),'utf8');
const engineCode=await readFile(new URL('../app/core/typing-engine.js',import.meta.url),'utf8');

await test('replay includes backspaces and preserves its complete event timeline',()=>{
  const start=1_700_000_000_000;
  const events=[
    {type:'key',key:'a',expected:'a',correct:true,index:0,at:start},
    {type:'key',key:'z',expected:'b',correct:false,index:1,at:start+500},
    {type:'backspace',index:1,at:start+1500},
    {type:'key',key:'b',expected:'b',correct:true,index:1,at:start+22000}
  ];
  const timeline=buildReplayTimeline({events,startedAt:start,strictAccuracy:false});
  assert.equal(timeline.steps.length,4);
  assert.ok(timeline.durationMs>22000,'No 20-second timer compression');
  assert.equal(timeline.typed,3);assert.equal(timeline.mistakes,1);assert.equal(timeline.backspaces,1);
  assert.equal(replayAt(timeline,0).count,0);
  assert.equal(replayAt(timeline,750).count,2);
  assert.deepEqual(replayAt(timeline,750).visibleErrors,[1]);
  assert.equal(replayAt(timeline,1550).step.type,'backspace');
  assert.deepEqual(replayAt(timeline,1550).visibleErrors,[],'Backspace must clear old red error');
  assert.equal(replayAt(timeline,23000).count,4);
  assert.equal(formatReplayTime(126000),'2:06');
  const strictTimeline=buildReplayTimeline({startedAt:start,strictAccuracy:true,events:[
    {type:'key',index:0,key:'z',expected:'a',correct:false,at:start},
    {type:'key',index:0,key:'a',expected:'a',correct:true,at:start+200}
  ]});
  assert.deepEqual(replayAt(strictTimeline,100).visibleErrors,[0]);
  assert.deepEqual(replayAt(strictTimeline,300).visibleErrors,[],'Repair on strict mode must clear red error');
});

await test('replay seeking is monotonic and works for 12,000 recorded events',()=>{
  const events=Array.from({length:12000},(_,i)=>({type:'key',key:'a',correct:true,index:i,at:2000000+i*38}));
  const timeline=buildReplayTimeline({events,startedAt:2000000});
  const half=replayAt(timeline,timeline.durationMs/2);
  assert.ok(half.count>=5000&&half.count<=7000);
  assert.equal(replayAt(timeline,timeline.durationMs).finished,true);
  assert.equal(replayAt(timeline,timeline.durationMs).count,12000);
  assert.equal(replayAt(timeline,-500).count,0);
  assert.match(main,/modalCleanup=\(\)=>\{pause\(\)/);
  const source=main.slice(main.indexOf('async function showReplay('),main.indexOf('async function renderLibrary('));
  assert.doesNotMatch(source,/timers\.push\(setTimeout|keyEvents\.forEach/);
  assert.match(source,/requestAnimationFrame\(tick\)/);
});

await test('frame profiler identifies stable, janky and severe frame streams',()=>{
  assert.equal(summarizeFrames([16,17,16,15,17]).quality,'stable');
  assert.equal(summarizeFrames([16,17,40,40,40]).quality,'janky');
  assert.equal(summarizeFrames([32,32,32,32,32]).quality,'janky','A steady 31 FPS must not be described as smooth');
  assert.equal(summarizeFrames([16,17,60,80,90]).quality,'severe');
  assert.equal(summarizeFrames([]).quality,'unavailable');
  assert.equal(summarizeFrames([16,16,16]).fps,63);
});

await test('frame profiler runs only when requested, supports abort and finishes',async()=>{
  let t=0;
  const result=await profileFrames({durationMs:1600,requestFrame:fn=>{queueMicrotask(()=>fn(t+=16));return t;},
    cancelFrame:()=>{},clock:()=>t,isVisible:()=>true});
  assert.equal(result.reason,'complete');assert.ok(result.frames>=95);assert.equal(result.quality,'stable');
  const controller=new AbortController();controller.abort();
  assert.equal((await profileFrames({signal:controller.signal,requestFrame:()=>1})).reason,'cancelled');
});

await test('layout hint cache invalidates when the user teaches a new physical key',()=>{
  const mapper=new KeyboardMapper({profileId:'en-us',calibration:{}});
  const first=mapper.hintFor('a','en');
  assert.equal(mapper.hintFor('a','en'),first);
  mapper.observe({code:'KeyQ',shiftKey:false,getModifierState:()=>false},'a','en');
  assert.equal(mapper.hintFor('a','en').code,'KeyQ');
  mapper.setProfile('fa-standard');
  assert.equal(mapper.hintFor('ش','fa').code,'KeyA');
});

await test('a long Persian passage reuses marker DOM and reads at most 18 status cells per paint',()=>{
  const oldDoc=globalThis.document,oldCSS=globalThis.CSS,oldRAF=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame;
  const callbacks=new Map();let nextId=1,elements=0,ranges=0;
  class ClassList{toggle(){}add(){}remove(){}}
  class Element{
    constructor(){this.style={};this.dataset={};this.children=[];this.classList=new ClassList();this.isConnected=true;
      this.scrollTop=0;this.scrollHeight=200;this.clientHeight=200;}
    append(...children){this.children.push(...children);for(const x of children)x.isConnected=true;}
    replaceChildren(...children){this.children=[...children];}
    remove(){this.isConnected=false;}
    removeEventListener(){}
    setAttribute(){}
    getBoundingClientRect(){return {left:40,top:30,right:640,bottom:240,width:600,height:210};}
    querySelector(){return null;}
  }
  const fakeText=text=>({nodeType:3,textContent:text,length:text.length});
  globalThis.document={body:new Element(),createElement:()=>{elements++;return new Element();},createTextNode:fakeText,
    createRange:()=>{ranges++;let at=0;return {setStart(_node,i){at=i;},setEnd(){},getClientRects(){const left=60+(at%40)*10;return [{left,top:80,right:left+10,bottom:112,width:10,height:32}];}};}};
  globalThis.CSS=undefined;
  globalThis.requestAnimationFrame=fn=>{const id=nextId++;callbacks.set(id,fn);return id;};
  globalThis.cancelAnimationFrame=id=>callbacks.delete(id);
  const flush=()=>{for(let round=0;round<8&&callbacks.size;round++){const frames=[...callbacks.entries()];callbacks.clear();for(const [,fn] of frames)fn();}};
  try{
    const engine=new TypingEngine({language:'fa',mapper:{hintFor:()=>null}});
    engine.container=new Element();engine.setText('ا'.repeat(4000),{id:'long-persian'});flush();
    const markerCount=elements;
    assert.equal(engine.markerLayer.children.length,16,'One caret, 3 green and 12 red reusable slots');
    engine.index=3000;const raw=new Uint8Array(4000);raw.fill(1);raw[2999]=2;
    let reads=0;
    engine.statuses=new Proxy(raw,{get(target,key){if(typeof key==='string'&&/^\d+$/.test(key))reads++;return Reflect.get(target,key,target);}});
    engine.wrongInputs.set(2999,'x');
    for(let i=0;i<120;i++){engine._queueMarkerPaint();flush();}
    assert.ok(reads<120*25,`Expected bounded scans, read ${reads} status cells`);
    assert.equal(elements,markerCount,'No marker nodes created during 120 repaints');
    assert.ok(ranges<120*6+20,'Only caret and nearby marks need Range geometry');
    assert.equal(engine._markerNodes.current.dataset.currentIndex,'3000');
    engine._removeStatus(2999);flush();
    assert.equal(engine._markerNodes.wrong[0].style.display,'none');
    engine.destroy();
  }finally{
    globalThis.document=oldDoc;globalThis.CSS=oldCSS;
    globalThis.requestAnimationFrame=oldRAF;globalThis.cancelAnimationFrame=oldCancel;
  }
});

await test('new guided options persist with safe settings schema',()=>{
  const original=globalThis.localStorage;
  const store=new Map([['keyflow.settings',JSON.stringify({settingsSchema:15,lookAheadCount:120})]]);
  globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)};
  try{const result=loadSettings();assert.equal(result.settingsSchema,16);assert.equal(result.lookAheadCount,2);}finally{globalThis.localStorage=original;}
  for(const key of ['practice-lookahead','practice-lookahead-strip','practice-frame-profile','run-frame-profile'])assert.ok(main.includes(key),key);
  assert.match(main,/recordFrameProbe\(result,'practice'\)/);
  assert.match(main,/recordFrameProbe\(result,'settings'\)/);
  assert.match(main,/frame-probe-history/);
  const backedUp=createBackup({settings:{},sessions:[],texts:[],local:{'keyflow.frame-probes':[{at:12,fps:60,p95Ms:16}]}});
  assert.deepEqual(backedUp.preferences['keyflow.frame-probes'],[{at:12,fps:60,p95Ms:16}]);
  assert.doesNotMatch(main.slice(main.indexOf('const preloadTexts=async()=>'),main.indexOf('warmAudioLater({')),/getRecentSessions\(\{limit:5000\}\)/);
  assert.match(main,/ghostLookupTimer=setTimeout\(loadGhost,2400\)/);
  assert.match(main,/if\(typingIsHot\(\)\)\{ghostLookupTimer=setTimeout\(loadGhost,2800\);return;\}/);
  assert.match(main,/if\(typingIsHot\(\)\)\{scheduleHeatmap\(\);return;\}/);
  assert.match(engineCode,/const measured=planned\.map\(/);
});

console.log(`\n${passed} KeyFlow 3.7 regressions passed.`);

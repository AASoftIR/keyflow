import assert from 'node:assert/strict';
import { normalizePersian, sanitizePracticeText, scriptStats } from '../app/core/normalization.js';
import { KeyboardMapper, keyboardSafe, fingerForCode } from '../app/core/layouts.js';
import { validatePracticeContent } from '../app/core/content-validator.js';
import { calculateSessionSummary, aggregateSessions } from '../app/core/stats.js';
import { targetCharacters, pickFreshPassage } from '../app/core/shuffle-bag.js';
import { profileForLanguage, rankForXp, rankProgress, updateProgression, recommendedDifficulty } from '../app/core/progression.js';
import { BUILTIN_TEXTS } from '../app/data/builtin-texts.js';
import { shouldUseCustomHighlights } from '../app/core/typing-engine.js';

let passed=0;
function test(name,fn){
  try{fn();passed++;console.log(`✓ ${name}`);}catch(e){console.error(`✗ ${name}`);throw e;}
}

test('Persian renderer never uses CSS Custom Highlights even when available',()=>{
  assert.equal(shouldUseCustomHighlights('fa',true),false);
  assert.equal(shouldUseCustomHighlights('en',true),true);
});

test('normalizes Arabic Yeh/Kaf to Persian forms',()=>{
  assert.equal(normalizePersian('علي كد'),'علی کد');
});

test('removes Persian diacritics when advanced marks are off',()=>{
  assert.equal(sanitizePracticeText('سَلامِ',{language:'fa',allowDiacritics:false}),'سلام');
});

test('script purity detects Persian and English correctly',()=>{
  assert.ok(scriptStats('این یک متن فارسی است').persianRatio>.95);
  assert.ok(scriptStats('This is an English sentence').latinRatio>.98);
});

test('standard Persian letter hints map to physical codes',()=>{
  const mapper=new KeyboardMapper({profileId:'fa-standard'});
  assert.equal(mapper.hintFor('ف','fa').code,'KeyT');
  assert.equal(mapper.hintFor('ی','fa').code,'KeyD');
  assert.equal(mapper.hintFor('ک','fa').code,'Semicolon');
});

test('EndeavourOS XKB Persian profile matches ir(pes) for high-risk keys',()=>{
  const mapper=new KeyboardMapper({profileId:'fa-standard'});
  assert.equal(mapper.hintFor('پ','fa').code,'KeyM');
  assert.equal(mapper.hintFor(':','fa').code,'Semicolon');
  assert.equal(mapper.hintFor(':','fa').shift,true);
  assert.equal(mapper.hintFor('‌','fa').code,'Space');
  assert.equal(mapper.hintFor('‌','fa').shift,true);
  const windows=new KeyboardMapper({profileId:'fa-windows'});
  assert.equal(windows.hintFor('پ','fa').code,'Backslash');
});

test('EndeavourOS XKB Windows compatibility profile mirrors ir(winkeys)',()=>{
  const mapper=new KeyboardMapper({profileId:'fa-windows'});
  assert.equal(mapper.hintFor('پ','fa').code,'Backslash');
  const fatha=mapper.hintFor('َ','fa');
  assert.equal(fatha.code,'KeyA'); assert.equal(fatha.shift,true);
  const kasra=mapper.hintFor('ِ','fa');
  assert.equal(kasra.code,'KeyD'); assert.equal(kasra.shift,true);
  const zwnj=mapper.hintFor('‌','fa');
  assert.equal(zwnj.code,'Digit2'); assert.equal(zwnj.altGraph,true); assert.equal(zwnj.shift,true);
});


test('finger coach maps physical codes independent of language legend',()=>{
  assert.equal(fingerForCode('KeyT'),'Left index');
  assert.equal(fingerForCode('KeyM'),'Right index');
  assert.equal(fingerForCode('Semicolon'),'Right pinky');
  assert.equal(fingerForCode('Space'),'Thumb');
});
test('learned mapping overrides static profile',()=>{
  const mapper=new KeyboardMapper({profileId:'fa-standard',calibration:{'ف':{code:'KeyX',shift:false,altGraph:false,source:'learned'}}});
  assert.equal(mapper.hintFor('ف','fa').code,'KeyX');
  assert.equal(mapper.hintFor('ف','fa').confidence,'learned');
});

test('all built-in texts are keyboard-safe for their default profile',()=>{
  const failures=[];
  for(const t of BUILTIN_TEXTS){
    const layout=t.language==='fa'?'fa-standard':'en-us';
    const bad=keyboardSafe(sanitizePracticeText(t.text,{language:t.language,allowDiacritics:false}),layout,{});
    if(bad.length) failures.push(`${t.id}: ${bad.join(' ')}`);
  }
  assert.deepEqual(failures,[]);
});

test('built-in texts pass basic content validation',()=>{
  for(const t of BUILTIN_TEXTS){
    const v=validatePracticeContent(t.text,{language:t.language,layoutId:t.language==='fa'?'fa-standard':'en-us',allowDiacritics:false,minLength:20,maxLength:2000});
    assert.ok(v.health>=64,`${t.id} health=${v.health}: ${v.issues.join(' | ')}`);
  }
});

test('session summary computes net WPM, accuracy, and consistency',()=>{
  const session={startedAt:0,endedAt:60000,backspaces:1,intervals:[100,110,95,105],events:[
    {type:'key',correct:true},{type:'key',correct:true},{type:'key',correct:true},{type:'key',correct:true},{type:'key',correct:true},{type:'key',correct:false}
  ]};
  const s=calculateSessionSummary(session);
  assert.equal(s.rawWpm,1.2);
  assert.ok(Math.abs(s.wpm-.2)<1e-9);
  assert.equal(Math.round(s.accuracy),83);
  assert.ok(s.consistency>90);
});

test('aggregates English and Persian separately',()=>{
  const base={endedAt:60000,backspaces:0,intervals:[100],events:Array.from({length:10},()=>({type:'key',correct:true})),keyStats:{},pairStats:{}};
  const sessions=[{...base,id:'a',language:'en',startedAt:0,summary:{durationMs:60000,typed:10,correct:10,errors:0,wpm:2,backspaces:0,reliable:true}},{...base,id:'b',language:'fa',startedAt:1,summary:{durationMs:60000,typed:10,correct:10,errors:0,wpm:3,backspaces:0,reliable:true}}];
  assert.equal(aggregateSessions(sessions,'en').sessions,1);
  assert.equal(aggregateSessions(sessions,'fa').averageWpm,3);
});



test('timing anomaly guard rejects impossible million-WPM sessions',()=>{
  const events=Array.from({length:56},(_,i)=>({type:'key',correct:i%18!==0,t:i*0.05,interval:i?0.05:0,code:'KeyA'}));
  const s=calculateSessionSummary({startedAt:1000,endedAt:1002,activeDurationMs:2,pausedMs:0,events,intervals:events.slice(1).map(e=>e.interval)});
  assert.equal(s.reliable,false);
  assert.equal(s.timingAnomaly,true);
  assert.equal(s.wpm,0);
  assert.equal(s.rawWpm,0);
});

test('long and endurance targets are genuinely longer by level',()=>{
  assert.ok(targetCharacters(1,'long')>targetCharacters(1,'standard'));
  assert.ok(targetCharacters(5,'endurance')>=2100);
  assert.ok(targetCharacters(5,'endurance')>targetCharacters(3,'endurance'));
});

test('smart deck prefers exact level and avoids immediate repeats',()=>{
  const memory=new Map();
  globalThis.localStorage={getItem:k=>memory.has(k)?memory.get(k):null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k)};
  const items=[
    {id:'l1a',language:'en',level:1,title:'a',text:'alpha '.repeat(20)},
    {id:'l3a',language:'en',level:3,title:'b',text:'bravo '.repeat(20)},
    {id:'l3b',language:'en',level:3,title:'c',text:'charlie '.repeat(20)},
    {id:'l5a',language:'en',level:5,title:'d',text:'delta '.repeat(20)}
  ];
  const first=pickFreshPassage(items,{language:'en',level:3,targetChars:80,recentWindow:3,lengthMode:'standard'});
  const second=pickFreshPassage(items,{language:'en',level:3,targetChars:80,recentWindow:3,lengthMode:'standard'});
  assert.equal(first.level,3);
  assert.equal(second.level,3);
  assert.notEqual(first.id,second.id);
});

test('skill rank is permanent while recommended difficulty remains bounded',()=>{
  let all={en:{},fa:{}};
  const good={reliable:true,typed:900,accuracy:98,consistency:88,wpm:62,correctionRate:2};
  all=updateProgression(all,'en',good,55);
  const before=profileForLanguage(all,'en');
  const rankBefore=rankForXp(before.xp).rank;
  const bad={reliable:true,typed:600,accuracy:84,consistency:40,wpm:20,correctionRate:18};
  all=updateProgression(all,'en',bad,55);
  const after=profileForLanguage(all,'en');
  assert.ok(after.xp>before.xp);
  assert.ok(rankForXp(after.xp).rank>=rankBefore);
  const diff=recommendedDifficulty(after,{sessions:6,accuracy:84,averageConsistency:40,recentAverageWpm:20});
  assert.ok(diff>=1&&diff<=5);
  assert.ok(rankProgress(after).progress>=0&&rankProgress(after).progress<=1);
});

console.log(`\n${passed} tests passed.`);

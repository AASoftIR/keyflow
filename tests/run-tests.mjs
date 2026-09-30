import assert from 'node:assert/strict';
import { normalizePersian, sanitizePracticeText, scriptStats } from '../app/core/normalization.js';
import { KeyboardMapper, keyboardSafe, fingerForCode } from '../app/core/layouts.js';
import { validatePracticeContent } from '../app/core/content-validator.js';
import { calculateSessionSummary, aggregateSessions } from '../app/core/stats.js';
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
  const sessions=[{...base,id:'a',language:'en',startedAt:0,summary:{durationMs:60000,typed:10,correct:10,errors:0,wpm:2,backspaces:0}},{...base,id:'b',language:'fa',startedAt:1,summary:{durationMs:60000,typed:10,correct:10,errors:0,wpm:3,backspaces:0}}];
  assert.equal(aggregateSessions(sessions,'en').sessions,1);
  assert.equal(aggregateSessions(sessions,'fa').averageWpm,3);
});

console.log(`\n${passed} tests passed.`);

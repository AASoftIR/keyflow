import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {recordReview,dueReviews,reviewGrade,completedSourceIds} from '../app/next/review.js';
import {buildPersonalGhost,personalGhostAt,findPersonalBest} from '../app/next/ghost.js';
import {errorDNA,repairDrill} from '../app/next/forensics.js';
import {FatigueRadar} from '../app/next/fatigue.js';
import {CODE_WORKOUTS,codeWorkout} from '../app/next/code-fluency.js';
import {beginCircuit,advanceCircuit,circuitNextPassage} from '../app/next/circuit.js';
import {createBackup,validateBackup,BACKUP_SCHEMA} from '../app/next/vault.js';
import {validCheckpoint,makeCheckpoint} from '../app/next/checkpoint.js';

let n=0;
async function test(name,fn){await fn();n++;console.log('✓ v3.0: '+name);}
const good={reliable:true,typed:80,accuracy:98,consistency:75,wpm:50};
const bad={reliable:true,typed:80,accuracy:64,consistency:60,wpm:22};

await test('spaced review intervals adapt and never count invalid runs',()=>{
  assert.equal(reviewGrade({...good,reliable:false}),null);
  const start=1700000000000;
  const a=recordReview({},'en-01',good,start);assert.equal(a['en-01'].step,0);
  assert.equal(a['en-01'].dueAt-start,86400000);
  assert.equal(dueReviews(a,[{id:'en-01',language:'en',text:'abc'}],{language:'en',now:start}).length,0);
  const b=recordReview(a,'en-01',good,start+86400000);assert.equal(b['en-01'].dueAt-(start+86400000),3*86400000);
  const c=recordReview(b,'en-01',bad,start+2*86400000);assert.equal(c['en-01'].step,-1);
  assert.equal(c['en-01'].dueAt-(start+2*86400000),86400000);
  assert.deepEqual(recordReview(c,'en-01',{...good,reliable:false}),c);
  assert.equal(dueReviews(c,[{id:'en-01',language:'en'}],{language:'en',now:start+4*86400000}).length,1);
});
await test('full completion tracks only reached mixed-deck sources even with Persian marks',()=>{
  const text='سلام!\n\nشادی';const first=text.indexOf('شادی');
  const s={completionReason:'passage',summary:good,text,language:'fa',completedChars:13,sourceParts:[{id:'a',start:0,end:first},{id:'b',start:first,end:text.length}]};
  assert.deepEqual(completedSourceIds(s),['a','b']);
  assert.deepEqual(completedSourceIds({...s,completionReason:'sprint'}),[]);
  assert.deepEqual(completedSourceIds({...s,completedChars:5}),[]);
});
await test('personal-best ghost is sourced from real reliable matching passage',()=>{
  const text='hello '.repeat(12);
  const session={id:'a',language:'en',text,textLength:text.length,summary:{...good,durationMs:10000},completionReason:'passage',events:Array.from({length:40},(_,i)=>({type:'key',index:i,correct:true,at:1000+i*250}))};
  const ghost=buildPersonalGhost(session);
  assert.ok(ghost && ghost.points.length>20);
  assert.equal(personalGhostAt(ghost,0)>=0,true);
  assert.ok(personalGhostAt(ghost,5000)>personalGhostAt(ghost,2000));
  assert.equal(findPersonalBest([session],{text,language:'en'}).sessionId,'a');
  assert.equal(findPersonalBest([session],{text:text+'x',language:'en'}),null);
  assert.equal(buildPersonalGhost({...session,summary:{...good,reliable:false}}),null);
});
await test('forensics identify wrong-vs-expected keys and authentic Persian mistake words',()=>{
  const session={language:'fa',text:'سلام ایران امروز',events:[
    {type:'key',index:0,expected:'س',key:'ش',correct:false,interval:400},
    {type:'key',index:0,expected:'س',key:'ش',correct:false,interval:390},
    ...Array.from({length:4},(_,i)=>({type:'key',index:i+2,expected:'ا',key:'ا',correct:true,interval:700}))]};
  const dna=errorDNA([session],{language:'fa'});
  assert.equal(dna.confusions[0].count,2);assert.equal(dna.confusions[0].expected,'س');
  assert.ok(dna.words.some(x=>x.word==='سلام'));
  assert.equal(dna.slowKeys[0].key,'ا');
  assert.ok(repairDrill(dna,'fa').includes('سلام'));
});
await test('fatigue detection requires baseline, distinguishes healthy vs deteriorating periods',()=>{
  const radar=new FatigueRadar();
  for(let i=0;i<64;i++)radar.observe({correct:true,interval:140});
  assert.equal(radar.status().level,'good');
  for(let i=0;i<24;i++)radar.observe({correct:i%3!==0,interval:600});
  assert.equal(radar.status().level,'high');
  const fresh=new FatigueRadar();assert.equal(fresh.status().level,'building');
});
await test('five real offline code workouts preserve syntax, whitespace and line breaks',()=>{
  assert.deepEqual(CODE_WORKOUTS.map(x=>x.id),['python','javascript','sql','bash','json']);
  for(const w of CODE_WORKOUTS){const t=codeWorkout(w.id);assert.ok(t.text.length>110 && t.text.includes('\n'));assert.equal(t.source,'code');assert.equal(t.language,'en');}
  assert.equal(codeWorkout('nonexistent'),null);
});
await test('guided circuit remains evidence based; never advances on incomplete runs',()=>{
  const passage={id:'p',language:'en',level:2,text:'the original passage'};
  let state=beginCircuit(passage,123);
  assert.equal(circuitNextPassage(state).text,passage.text);
  state=advanceCircuit(state,{id:'a',completionReason:'sprint',summary:good},'repair');assert.equal(state.step,'baseline');
  state=advanceCircuit(state,{id:'b',completionReason:'passage',summary:good},'repair');assert.equal(state.step,'repair');assert.equal(circuitNextPassage(state).text,'repair');
  state=advanceCircuit(state,{id:'c',completionReason:'passage',summary:good});assert.equal(state.step,'retest');
  state=advanceCircuit(state,{id:'d',completionReason:'passage',summary:bad});assert.equal(state.step,'complete');
  assert.equal(state.baseline.wpm,50);assert.equal(state.result.accuracy,64);
});
await test('Data Vault roundtrip excludes secrets, blocks bad schema and malicious setting keys',()=>{
  const payload=createBackup({settings:{language:'fa',dailyMinutes:20,aiProxyUrl:'socks5h://user:secret@host',apiKey:'SECRET'},sessions:[{id:'s1'}],texts:[{id:'c1'}],local:{'keyflow.review':{a:{step:1}},'keyflow.providers':{x:{apiKey:'LEAK'}}}});
  const serialized=JSON.stringify(payload);assert.ok(!serialized.includes('secret@host'));assert.ok(!serialized.includes('SECRET'));assert.ok(!serialized.includes('LEAK'));
  assert.equal(payload.schema,BACKUP_SCHEMA);
  const parsed=validateBackup(JSON.parse(serialized));assert.equal(parsed.sessions[0].id,'s1');
  assert.equal(Object.hasOwn(parsed.settings,'apiKey'),false);
  assert.throws(()=>validateBackup({...payload,schema:2}),/Unsupported/);
  assert.throws(()=>validateBackup({...payload,texts:[{id:0}]}),/Invalid/);
});
await test('checkpoint accepts recent started work; rejects complete, expired and corrupted',()=>{
  const now=1800000000000;
  const example={v:1,savedAt:now-1000,passage:{text:'a'.repeat(30)},engine:{index:12,statuses:Array(30).fill(1)}};
  assert.equal(validCheckpoint(example,now),true);
  assert.equal(validCheckpoint({...example,savedAt:now-8*86400000},now),false);
  assert.equal(validCheckpoint({...example,engine:{index:30,statuses:Array(30).fill(1)}},now),false);
  const exampleEngine={snapshot:()=>({index:1,statuses:[1,0]})};
  assert.equal(makeCheckpoint({id:'p',language:'en',text:'hi'},exampleEngine,now).engine.index,1);
});
await test('lab buttons and app wiring provide every new feature',async()=>{
  const src=await readFile(new URL('../app/main.js',import.meta.url),'utf8');
  for(const anchor of ['lab-review','lab-ghost','lab-dna','lab-circuit','lab-code','lab-checkpoint','lab-vault','lab-fatigue-live','ghost-toggle','fatigue-radar']){
    assert.ok(src.includes(`id="${anchor}"`),`Missing interface control ${anchor}`);
    assert.ok(src.includes(`'#${anchor}'`),`No action wired for ${anchor}`);
  }
  assert.ok(src.includes('mergeBackupRecords'));assert.ok(src.includes('engine.restore('));
});
console.log(`\n${n} v3.0 checks passed.`);

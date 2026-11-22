import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PENDING_AI_KEY,normalizeAiDraft,getPendingAiDraft,stagePendingAiDraft,discardPendingAiDraft,clearPendingAiDraftOnCompletion,persistAiDraft} from '../app/core/ai-drafts.js';
import {saveText} from '../app/core/storage.js';

const genSource=(await readFile(new URL('../app/ai/generator.js',import.meta.url),'utf8')).replace(/^import .*;\s*$/gm,'');
const {buildGenerationPrompt}=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(genSource));
const cells=new Map();
const storage={getItem:k=>cells.get(k)??null,setItem:(k,v)=>cells.set(k,String(v)),removeItem:k=>cells.delete(k)};
const draft={id:'ai-12345678-abc',source:'ai',language:'fa',level:4,title:'A new Persian passage',
  text:'یک متن کاملاً تازه برای تمرین تایپ فارسی که باید در کتابخانه ذخیره شود و پس از باز کردن برنامه همچنان باقی بماند.',
  provider:'dahl',model:'MiniMaxAI/MiniMax-M2.7',createdAt:Date.now(),tags:['ai','custom']};
let count=0;
async function test(title,fn){await fn();count++;console.log('✓ v3.4:',title);}
await test('AI draft saves before Practice Now and is recoverable after a simulated restart',async()=>{
  let database=new Map();
  const saving=async text=>{database.set(text.id,structuredClone(text));};
  const result=await persistAiDraft(draft,{save:saving,storage});
  assert.equal(result.queued,true);assert.equal(database.get(draft.id).text,draft.text);
  const pending=getPendingAiDraft(storage);
  assert.equal(pending.id,draft.id);assert.equal(pending.level,4);assert.equal(pending.language,'fa');
  assert.equal(cells.has(PENDING_AI_KEY),true);
});
await test('merely opening and typing partially never consumes the pending passage',async()=>{
  const pending=getPendingAiDraft(storage);
  assert.ok(pending);
  assert.equal(clearPendingAiDraftOnCompletion({textId:draft.id,completionReason:'passage',completedChars:5,textLength:100},storage),false);
  assert.equal(clearPendingAiDraftOnCompletion({textId:draft.id,completionReason:'sprint',completedChars:100,textLength:100},storage),false);
  assert.equal(clearPendingAiDraftOnCompletion({textId:'different',completionReason:'passage',completedChars:100,textLength:100},storage),false);
  assert.equal(getPendingAiDraft(storage).text,draft.text);
});
await test('only persisted full completion of the exact text clears its pending pointer',async()=>{
  assert.equal(clearPendingAiDraftOnCompletion({textId:draft.id,completionReason:'passage',completedChars:100,textLength:100},storage),true);
  assert.equal(getPendingAiDraft(storage),null);
});
await test('an IndexedDB rejection never creates a misleading pending record',async()=>{
  await assert.rejects(()=>persistAiDraft(draft,{save:async()=>{throw new Error('quota full');},storage}),/quota full/);
  assert.equal(getPendingAiDraft(storage),null);
});
await test('a missing local database never silently pretends to save a passage',async()=>{
  const had=Object.hasOwn(globalThis,'indexedDB'),original=globalThis.indexedDB;
  try{delete globalThis.indexedDB;await assert.rejects(()=>saveText(draft),/unavailable/);}finally{if(had)globalThis.indexedDB=original;}
});
await test('stored pending snapshot never contains API keys or session data',async()=>{
  stagePendingAiDraft({...draft,apiKey:'SUPER_SECRET',credentials:{secret:'NO'},diagnostics:{prompt:'private'}},storage);
  const content=cells.get(PENDING_AI_KEY);
  assert.doesNotMatch(content,/SUPER_SECRET|credentials|NO|private|diagnostics/);
  assert.equal(normalizeAiDraft({...draft,source:'builtin'}),null);
  assert.equal(normalizeAiDraft({...draft,text:'short'}),null);
  discardPendingAiDraft(storage);
});
await test('localStorage snapshot failures surface an honest warning while DB save survives',async()=>{
  let saved=false;
  const result=await persistAiDraft(draft,{save:async()=>{saved=true;},storage:{setItem:()=>{throw Error('storage denied');}}});
  assert.ok(saved);assert.equal(result.queued,false);assert.match(result.warning,/storage denied/);
});
await test('difficulty actually changes prompt constraints in both languages',async()=>{
  for(const lang of ['en','fa']){
    const beginner=buildGenerationPrompt({language:lang,level:1,length:'short'});
    const expert=buildGenerationPrompt({language:lang,level:5,length:'short'});
    assert.match(beginner,/short common words/);assert.match(expert,/complex but correct syntax/);
    assert.notEqual(beginner,expert);
  }
});
const main=await readFile(new URL('../app/main.js',import.meta.url),'utf8');
const css=await readFile(new URL('../app/studio.css',import.meta.url),'utf8');
await test('AI generation auto-persists its draft and never starts unsaved text',async()=>{
  assert.match(main,/await saveCurrentDraft\(\);setAiJourney\('save'\)/);
  assert.match(main,/persistAiDraft\(generatedDraft,\{save:saveText\}\)/);
  assert.match(main,/saved\?'':'disabled'/);
  assert.match(main,/stagePendingAiDraft\(generatedDraft\)/);
});
await test('cold start prioritizes a pending AI text, and completion clears it',async()=>{
  assert.match(main,/if\(fastStart && mode==='text'\)/);
  assert.match(main,/restoredPending:true/);
  assert.match(main,/clearPendingAiDraftOnCompletion\(s\)/);
});
await test('key guide is adjacent to the passage, fixed-size, and updated without markup churn',async()=>{
  assert.ok(main.indexOf('id="focus-key-rail"')<main.indexOf('id="typing-text"'));
  assert.match(main,/focusChord\.textContent=chord/);
  assert.match(main,/focusLast\.textContent=e\.detail\.correct/);
  assert.match(css,/\.focus-key-rail\s*\{/);
  assert.match(css,/min-height:58px;max-height:58px/);
  assert.match(css,/body\[data-motion=\"none\"\] \.focus-key-rail\{transition:none!important;animation:none!important\}/);
});
await test('AI Studio can personalize from real local history and edit before practicing',async()=>{
  assert.match(main,/id="ai-train-mistakes"/);
  assert.match(main,/aggregateSessions\(sessions,lang\)/);
  assert.match(main,/id="draft-edit"/);
  assert.match(main,/validatePracticeContent\(clean,/);
});

await test('the AI Studio and Library expose recovery without treating drafts as completed',async()=>{
  assert.match(main,/id="ai-resume-inbox"/);
  assert.match(main,/Saved for later · not yet completed/);
  assert.match(main,/Saved · unfinished/);
  assert.match(main,/if\(t.source==='ai'\)\{try\{stagePendingAiDraft\(t\)/);
  assert.match(main,/if\(getPendingAiDraft\(\)\?\.id===id\)discardPendingAiDraft\(\)/);
});
console.log(`\n${count} KeyFlow 3.4 regression checks passed.`);

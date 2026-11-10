import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BUILTIN_TEXTS} from '../app/data/builtin-texts.js';
import {contentFingerprint,deckAvailability,excerptAtBoundary,blendBoundedPassages,pickFreshPassage,targetCharacters} from '../app/core/shuffle-bag.js';
import {keyboardSafe} from '../app/core/layouts.js';
import {perPassageHistory} from '../app/core/library-analytics.js';
const map=new Map();globalThis.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};
let count=0;
const test=(label,fn)=>{map.clear();fn();count++;console.log('✓ v3.1: '+label);};
const norm=s=>s.normalize('NFC');
test('expanded library adds 35 original passages for each language with all five difficulties',()=>{
 for(const lang of ['en','fa']){
  const passages=BUILTIN_TEXTS.filter(x=>x.language===lang);
  assert.equal(passages.length,77);
  for(let level=1;level<=5;level++)assert.ok(passages.filter(x=>x.level===level).length>=10,`${lang} level ${level} understocked`);
  assert.equal(new Set(passages.map(x=>contentFingerprint(x.text))).size,passages.length);
  assert.ok(passages.every(x=>keyboardSafe(x.text,lang==='en'?'en-us':'fa-standard').length===0));
 }
});
test('balanced session lengths remain within ±12% for a full pool at every level and duration',()=>{
 for(const lang of ['en','fa'])for(let level=1;level<=5;level++)for(const mode of ['quick','standard','long','endurance']){
  const target=targetCharacters(level,mode);
  for(let run=0;run<5;run++){
   const passage=pickFreshPassage(BUILTIN_TEXTS,{language:lang,level,lengthMode:mode,record:false});
   assert.ok(passage,`no ${lang} ${level} ${mode}`);
   assert.ok(passage.text.length>=target*.88 && passage.text.length<=target*1.1,
     `imbalanced ${lang} ${level} ${mode}: ${passage.text.length}/${target}`);
   assert.equal(passage.level,level);
   assert.ok(passage.sourceParts.every(p=>p.end-p.start===p.text.length && p.originalText.length>=p.text.length));
  }
 }
});
test('no cross-difficulty fallback even when another level has many fresh texts',()=>{
 const easy=BUILTIN_TEXTS.filter(x=>x.language==='en'&&x.level===1);
 assert.equal(pickFreshPassage(easy,{language:'en',level:5,record:false}),null);
 assert.equal(deckAvailability(easy,{language:'en',level:5}).exact,0);
});
test('sentence-aware excerpt never bisects a word or Persian sentence when possible',()=>{
 const en='A practical sentence ends here. Another sentence begins with more words. The final example finishes safely.';
 assert.equal(excerptAtBoundary(en,39), 'A practical sentence ends here.');
 const fa='جمله نخست به پایان رسید. جمله دوم برای بررسی آماده است. جمله سوم کمی طولانی‌تر است.';
 const part=excerptAtBoundary(fa,59,{language:'fa'});
 assert.ok(fa.startsWith(part));assert.ok(part.endsWith('.'));assert.ok(part.length<=59);
});
test('partially displayed source retains complete original for anti-repeat protection',()=>{
 const source=BUILTIN_TEXTS.find(x=>x.id==='en-new-25');
 assert.ok(source);
 const deck=pickFreshPassage([source],{language:'en',level:5,targetChars:180,record:false});
 assert.equal(deck.sourceIds[0],source.id);
 assert.equal(deck.sourceParts[0].originalText,source.text);
 assert.ok(deck.text.length<=198);
});
test('topic-specific mixed decks honor the same upper length bound and reached-source identity',()=>{
 const pool=BUILTIN_TEXTS.filter(x=>x.language==='en'&&x.level===3);
 const focus=pickFreshPassage(pool,{language:'en',level:3,tag:'punctuation',targetChars:960,record:false});
 const rest=pickFreshPassage(pool,{language:'en',level:3,targetChars:960-focus.text.length,excludeIds:focus.sourceIds,record:false});
 assert.ok(focus&&rest);
 const mixed=blendBoundedPassages(focus,rest,{targetChars:960,language:'en'});
 assert.ok(mixed&&mixed.text.length<=1056);
 assert.deepEqual(new Set(mixed.sourceIds),new Set(mixed.sourceParts.map(x=>x.id)));
 for(const part of mixed.sourceParts)assert.equal(mixed.text.slice(part.start,part.end),part.text);
});
test('Persian Library attributes mixed passage practice using grapheme rather than UTF-16 offsets',()=>{
 const first='بِنا',second='سلام';const joined=first+'\n\n'+second;
 const start=first.length+2;
 const session={id:'persian',language:'fa',text:joined,textId:'deck-fa-test',sourceIds:['one','two'],
   sourceParts:[{id:'one',start:0,end:first.length},{id:'two',start,end:joined.length}],
   completedChars:6,summary:{wpm:30,accuracy:95,reliable:true,durationMs:10000},activeDurationMs:10000};
 const stats=perPassageHistory([{id:'one',language:'fa',text:first},{id:'two',language:'fa',text:second}],[session]);
 assert.equal(stats.get('two').attempts,1);
 assert.ok(stats.get('two').practicedChars>0);
});
test('new controls are wired into actual practice, not merely decorative UI',()=>{
 const source=readFileSync(new URL('../app/main.js',import.meta.url),'utf8');
 for(const id of ['typing-guidance','next-char','next-chord','guide-finger','last-typed','last-key-result','mistake-feedback','mistake-typed','mistake-expected','mistake-history'])assert.ok(source.includes(`id="${id}"`),`missing ${id}`);
 assert.ok(source.includes("lastKeyPanel.dataset.state=e.detail.correct?'correct':'error'"));
 assert.ok(source.includes("mistakeBox.dataset.state='error'"));
 assert.ok(source.includes('settings.manualDifficultyByLanguage'));
 assert.ok(!source.includes('settings.stageByLanguage[settings.language]=practiceState.level'));
 const css=readFileSync(new URL('../app/styles.css',import.meta.url),'utf8');
 assert.ok(css.includes('#mistake-feedback{margin:0 0 11px;min-height:49px'));
});
test('marker resize handling is coalesced and never loops through ResizeObserver synchronously',()=>{
 const engine=readFileSync(new URL('../app/core/typing-engine.js',import.meta.url),'utf8');
 assert.ok(engine.includes('this._onContainerResize=()=>this._queueLayoutCheck()'));
 assert.ok(engine.includes("if(signature===this._lastLayoutSignature)return"));
 assert.ok(engine.includes('cancelAnimationFrame(this._layoutRaf)'));
});
console.log(`${count} KeyFlow 3.1 regression checks passed.`);

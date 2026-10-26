import assert from 'node:assert/strict';
import {pickFreshPassage,pickFreshText,deckAvailability,isNearDuplicate,contentFingerprint,DEFAULT_COOLDOWN_DAYS} from '../app/core/shuffle-bag.js';
import {BUILTIN_TEXTS} from '../app/data/builtin-texts.js';

const store=new Map();
globalThis.localStorage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};
const day=86400000,base=Date.UTC(2026,9,16);
let passed=0;
const test=(name,fn)=>{store.clear();fn();passed++;console.log('✓ freshness: '+name);};
const prose={
 alpha:'An engineer investigates a failing test and discovers a subtle assumption in the controller. After comparing logs, they isolate the error and write a robust patch. The team documents the discovery, then verifies the release with a controlled regression suite.',
 bravo:'On a quiet morning a gardener plants citrus trees beside a stone walkway. Fresh water reaches each root through a narrow channel. In spring the first flowers open, and the garden becomes a meeting place for neighbors who enjoy sharing seeds.',
 charlie:'During a mountain expedition the hikers follow a winding trail through pine forest. They measure distances on an old map, cross a wooden bridge, and stop beside a clear lake. At sunset they record the changing colors of the valley.',
 delta:'A small observatory studies distant stars using a rotating telescope and a sensitive camera. The researchers compare nightly observations, identify tiny variations in brightness, and publish a careful explanation of their measurements.',
 تجربه:'در یک روز آرام، باغبان جوان به کاشت درختان تازه مشغول شد. او خاک را آماده کرد، مسیر آب را بررسی کرد و برای هر نهال جای مناسبی انتخاب کرد. همسایه ها با دیدن باغ خوشحال شدند و قول دادند از درختان مراقبت کنند.'
};
const make=(id,word='alpha',language='en',level=3)=>({id,language,level,title:id,tags:['general'],text:prose[word]||`${word} ${prose.alpha}`});

test('yesterday source cannot come back tomorrow with same ID',()=>{
  const a=make('a'),b=make('b','bravo');
  const first=pickFreshPassage([a,b],{language:'en',level:3,targetChars:180,now:base});
  const second=pickFreshPassage([a,b],{language:'en',level:3,targetChars:180,now:base+day});
  assert.deepEqual(new Set([first.id,second.id]),new Set(['a','b']));
  assert.equal(pickFreshPassage([a,b],{language:'en',level:3,targetChars:180,now:base+2*day}),null);
});
test('the same text with a different ID is blocked on a subsequent day',()=>{
  const a=make('a');pickFreshText([a],{language:'en',now:base});
  assert.equal(pickFreshText([{...a,id:'ai-recreated',title:'A new AI title'}],{language:'en',now:base+day}),null);
});
test('near-identical story with edits is blocked rather than treated as new',()=>{
  const a=make('a'),b={...a,id:'rewrite',text:a.text.replace('careful habits','excellent habits').replace('realistic projects','production projects')};
  assert.ok(isNearDuplicate(a.text,b.text));
  pickFreshText([a],{language:'en',now:base});
  assert.equal(pickFreshText([b],{language:'en',now:base+day}),null);
});
test('a single deck protects all its components, not only composite ID',()=>{
  const all=[make('a'),make('b','bravo'),make('c','charlie')];
  const deck=pickFreshPassage(all,{language:'en',level:3,targetChars:600,now:base});
  assert.equal(deck.sourceIds.length,3);
  assert.equal(deckAvailability(all,{language:'en',now:base+day}).fresh,0);
});
test('fresh-only prevents recycling even when requested length cannot be reached',()=>{
  const one=make('only');
  const p=pickFreshPassage([one],{language:'en',targetChars:1200,now:base});
  assert.ok(p.shortfallChars>900);
  assert.equal(p.sourceIds.length,1);
  assert.equal(pickFreshPassage([one],{language:'en',targetChars:1200,now:base+day}),null);
});
test('explicit replay is allowed but normal selection never silently repeats',()=>{
  const one=make('only');pickFreshText([one],{language:'en',now:base});
  assert.equal(pickFreshText([one],{language:'en',now:base+day}),null);
  assert.equal(pickFreshPassage([one],{language:'en',now:base+day,allowRepeats:true}).id,'only');
});
test('newness memory survives module-level repeated selection through localStorage',()=>{
  const a=make('persist');pickFreshText([a],{language:'en',now:base});
  const saved=store.get('keyflow.seen');assert.ok(saved.includes('persist'));
  assert.equal(pickFreshText([a],{language:'en',now:base+day}),null);
});
test('cooldown expires after 21 days unless source remains in a legacy-protected period',()=>{
  const a=make('expire');pickFreshText([a],{language:'en',now:base});
  assert.equal(pickFreshText([a],{language:'en',now:base+(DEFAULT_COOLDOWN_DAYS-1)*day}),null);
  assert.equal(pickFreshText([a],{language:'en',now:base+(DEFAULT_COOLDOWN_DAYS+1)*day}).id,'expire');
});
test('legacy 2.6.2 recent IDs/fingerprints survive migration and are not permanently blocked',()=>{
  const a=make('old');store.set('keyflow.seen',JSON.stringify({'deck:en':{recentIds:['old'],recentFingerprints:[contentFingerprint(a.text)],lastSeen:{old:base-30*day}}}));
  assert.equal(pickFreshText([a],{language:'en',now:base}),null);
  // Subsequent non-exhausted selection persists the one-off migration metadata.
  const b=make('new','bravo');pickFreshText([a,b],{language:'en',now:base+day});
  assert.equal(pickFreshText([a],{language:'en',now:base+25*day}).id,'old');
});
test('language buckets are separate and different levels do not bypass quarantine',()=>{
  const a=make('a');pickFreshText([a],{language:'en',level:3,now:base});
  assert.equal(pickFreshText([{...a,level:1}],{language:'en',level:1,now:base+day}),null);
  const fa=make('fa','تجربه','fa');assert.equal(pickFreshText([fa],{language:'fa',now:base+day}).id,'fa');
});
test('pool with identical content under two IDs contributes just one source',()=>{
  const a=make('a'),b={...a,id:'b'};
  const p=pickFreshPassage([a,b],{language:'en',targetChars:1000,now:base});
  assert.deepEqual(p.sourceIds,['a']);
  assert.equal(deckAvailability([a,b],{language:'en',now:base}).total,1);
});
test('expanded English/Persian built-ins each contain 42 validated unique passages',()=>{
  for(const language of ['fa','en']){const texts=BUILTIN_TEXTS.filter(x=>x.language===language);assert.equal(texts.length,42);assert.equal(new Set(texts.map(x=>contentFingerprint(x.text))).size,42);}
});
console.log(`\n${passed} strict freshness tests passed.`);

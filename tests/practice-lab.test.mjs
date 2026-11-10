import assert from 'node:assert/strict';
import { SPRINT_OPTIONS,normalizeSprintSeconds,timeRemaining,milestoneBucket,milestoneSummary,wordBoundaries,wordHorizon,recommendRecovery,bookmarkKey,boundedBookmarks } from '../app/core/practice-lab.js';
const run=(title,fn)=>{fn();console.log('✓ 2.7: '+title);};
run('sprint only allows known durations',()=>{assert.deepEqual(SPRINT_OPTIONS,[0,60,180,300]);assert.equal(normalizeSprintSeconds('60'),60);assert.equal(normalizeSprintSeconds(-2),0);});
run('sprint timer uses active rather than wall time',()=>{assert.equal(timeRemaining(59001,60),1);assert.equal(timeRemaining(60001,60),0);assert.equal(timeRemaining(0,0),null);});
run('milestone clamped at passage end',()=>{assert.equal(milestoneBucket(100,100),7);assert.equal(milestoneBucket(-2,100),0);});
run('section accuracy report is exact',()=>{assert.equal(milestoneSummary([10,5],[2,0],12,40)[0].accuracy,80);});
run('RTL and ZWNJ remain in the same word',()=>{const chars=Array.from('می‌نویسم خوب');const words=wordBoundaries(chars);assert.equal(words[0].word,'می‌نویسم');assert.equal(wordHorizon(words,3).current,'می‌نویسم');assert.equal(wordHorizon(words,chars.length).remaining,0);});
run('recovery guidance distinguishes error rates',()=>{assert.equal(recommendRecovery({attempts:[10],mistakes:[4],total:100,index:1}).level,'repair');assert.equal(recommendRecovery({attempts:[10],mistakes:[0],total:100,index:1}).level,'flow');});
run('bookmark identity follows normalized content',()=>{assert.equal(bookmarkKey('الف  ب'),bookmarkKey('الف ب'));assert.notEqual(bookmarkKey('الف'),bookmarkKey('ب'));});
run('bookmarks bounded and corrupted entries ignored',()=>{assert.equal(boundedBookmarks([{text:'yes'},{text:3},{text:'okay'}]).length,2);});

import {calculateSessionSummary} from '../app/core/stats.js';
run('strict mode cannot farm productive WPM by repeated wrong keys',()=>{
 const events=Array.from({length:70},(_,i)=>({type:'key',correct:false,t:i*300,interval:300}));
 const score=calculateSessionSummary({activeDurationMs:21000,startedAt:100,endedAt:21100,completedChars:0,unresolvedErrors:1,events});
 assert.equal(score.wpm,0);assert.equal(score.rawWpm,40);
});

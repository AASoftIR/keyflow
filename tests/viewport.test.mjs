import assert from 'node:assert/strict';
import {cursorScrollTarget,segmentForCursor,typingFontScale} from '../app/core/viewport.js';
import {isEditableTarget} from '../app/core/typing-engine.js';
const test=(label,fn)=>{fn();console.log('✓ viewport: '+label)};
test('caret under lower edge scrolls down even between arbitrary character counts',()=>{
 const v=cursorScrollTarget({scrollTop:0,scrollHeight:1600,clientHeight:220,viewTop:100,viewBottom:320,caretTop:315,caretBottom:348});
 assert.ok(v>0&&v<220);
});
test('caret over upper edge scrolls back up',()=>{
 const v=cursorScrollTarget({scrollTop:400,scrollHeight:1600,clientHeight:220,viewTop:100,viewBottom:320,caretTop:101,caretBottom:130});
 assert.ok(v<400);
});
test('scroll never exceeds content or becomes negative',()=>{
 assert.equal(cursorScrollTarget({scrollTop:0,scrollHeight:800,clientHeight:220,viewTop:100,viewBottom:320,caretTop:2000,caretBottom:2012}),580);
 assert.equal(cursorScrollTarget({scrollTop:10,scrollHeight:220,clientHeight:220,viewTop:100,viewBottom:320,caretTop:500,caretBottom:520}),0);
});
test('section counts are correct at boundaries',()=>{
 assert.deepEqual(segmentForCursor(0,320),{section:1,count:2,progress:0});
 assert.deepEqual(segmentForCursor(160,320),{section:2,count:2,progress:50});
 assert.deepEqual(segmentForCursor(320,320),{section:2,count:2,progress:100});
});
test('readability zoom is bounded',()=>{
 assert.equal(typingFontScale(.1),.8);assert.equal(typingFontScale(6),1.55);
});
test('buttons are excluded from typing interception',()=>{
 for(const tagName of ['BUTTON','SELECT','INPUT','TEXTAREA','A']) assert.equal(isEditableTarget({tagName}),true);
 assert.equal(isEditableTarget({tagName:'DIV'}),false);
});

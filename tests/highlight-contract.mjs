// Guard the text-content vs. viewport coordinate-space bug. The real rendering
// companion test tests/run-highlight-browser.py checks glyph/marker geometry.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const engine=read('../app/core/typing-engine.js');
const css=read('../app/styles.css');
assert.match(engine,/this\.contentLayer=document\.createElement\('div'\)/,'Missing scroll-content wrapper');
assert.match(engine,/this\.contentLayer\.append\(this\.glyphLayer\)/,'Glyph must remain in scroll content');
assert.match(engine,/document\.body\.append\(this\.markerLayer\)/,'Overlay must be outside scroll-content tree');
assert.match(engine,/overlay\.style\.top=`\$\{host\.top\}px`/,'Overlay must track scrollport top in viewport pixels');
assert.match(engine,/overlay\.style\.height=`\$\{host\.height\}px`/,'Overlay must have explicit scrollport height');
assert.match(engine,/const left=Math\.max\(0,rect\.left-host\.left\)/,'Marker and caret must be in the same viewport coordinate system');
assert.match(engine,/window\.addEventListener\('scroll',this\._onAnyScroll,true\)/,'Overlay must follow outer scrolling and inner scrolling');
assert.match(css,/\.typing-viewport-overlay\{[^}]*position:fixed!important/,'Overlay must attach to screen without scroll parent positioning');
assert.match(css,/\.typing-viewport-overlay\{[^}]*min-height:0!important/,'Override inherited 100% minimum height');
assert.match(css,/\.typing-viewport-overlay\{[^}]*overflow:hidden!important/,'Clip marker pixels to the actual scrollport');
assert.doesNotMatch(engine,/marker\.style\.top=`\$\{rect\.top-anchor\.top\}px`/,'Old full-content overlay coordinates must not return');
console.log('✓ 2.6.2 highlight contract: viewport-fixed overlay follows nested scrolling, no inherited 100% height');

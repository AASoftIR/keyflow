import assert from 'node:assert/strict';

if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event { constructor(type,init={}){ super(type); this.detail=init.detail; } };
}
class FakeClassList {
  constructor(){ this.values=new Set(); }
  toggle(name,on){ if(on===undefined) on=!this.values.has(name); on?this.values.add(name):this.values.delete(name); return on; }
  add(...names){ names.forEach(x=>this.values.add(x)); }
  remove(...names){ names.forEach(x=>this.values.delete(x)); }
  contains(name){ return this.values.has(name); }
}
class FakeElement {
  constructor(tag){ this.tagName=tag.toUpperCase(); this.children=[]; this.childNodes=this.children; this.classList=new FakeClassList(); this.style={}; this.dataset={}; this.scrollLeft=0; this.scrollTop=0; this.lang=''; this.dir=''; this._className=''; }
  set className(v){ this._className=v; this.classList=new FakeClassList(); String(v).split(/\s+/).filter(Boolean).forEach(x=>this.classList.add(x)); }
  get className(){ return this._className; }
  append(...nodes){ this.children.push(...nodes); }
  replaceChildren(...nodes){ this.children=[...nodes]; this.childNodes=this.children; }
  setAttribute(){}
  querySelector(){ return null; }
  getBoundingClientRect(){ return {left:0,top:0,right:900,bottom:220,width:900,height:220}; }
}
class FakeText {
  constructor(text){ this.textContent=text; this.length=text.length; this.nodeType=3; }
}
class FakeRange {
  setStart(node,offset){ this.startContainer=node; this.startOffset=offset; }
  setEnd(node,offset){ this.endContainer=node; this.endOffset=offset; }
  getBoundingClientRect(){ return {left:850-this.startOffset*9,top:30,right:868-this.startOffset*9,bottom:68,width:18,height:38}; }
}
class FakeHighlight { add(){} delete(){} clear(){} }
globalThis.Highlight=FakeHighlight;
globalThis.CSS={highlights:new Map()};
globalThis.document={
  createElement:tag=>new FakeElement(tag),
  createTextNode:text=>new FakeText(text),
  createRange:()=>new FakeRange(),
  addEventListener(){},
  removeEventListener(){}
};

globalThis.requestAnimationFrame=fn=>{ fn(); return 1; };
globalThis.cancelAnimationFrame=()=>{};

const { TypingEngine }=await import(`../app/core/typing-engine.js?domsmoke=${Date.now()}`);
const host=new FakeElement('div');
const engine=new TypingEngine({language:'fa',mapper:{hintFor(){return null;}}});
engine.container=host;
engine.reset('ابزار خوب برای تمرین فارسی');
engine.render();
assert.equal(engine.useHighlights,false,'Persian must ignore Custom Highlight even when the browser supports it');
assert.equal(host.children.length,2,'renderer should contain only marker layer + glyph layer');
const glyph=host.children[1];
assert.equal(glyph.className,'typing-glyph-layer');
assert.equal(glyph.children.length,1,'Persian glyph layer must hold one uninterrupted node');
assert.equal(glyph.children[0].nodeType,3);
assert.equal(glyph.children[0].textContent,'ابزار خوب برای تمرین فارسی');
assert.equal(host.dir,'rtl');
console.log('✓ Persian DOM smoke: one RTL text node, zero CSS highlights, geometry-only feedback');

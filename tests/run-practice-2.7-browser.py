"""Actual browser regression for the disappearing Keyflow caret/marker.

Uses the real TypingEngine, long Persian glyph run, and real stylesheet.
Works on EndeavourOS using the system Chromium and Python playwright:
    python tests/run-highlight-browser.py
"""
from pathlib import Path
import base64
import os
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
core=root/'app/core'

def url(source):
    return 'data:text/javascript;base64,'+base64.b64encode(source.encode()).decode()

def module_url(path):
    source=path.read_text()
    for dep in ['normalization','stats','viewport']:
        source=source.replace(f"from './{dep}.js'",f"from '{url((core/(dep+'.js')).read_text())}'")
    return url(source)

css=(root/'app/styles.css').read_text()
html=f'''<!doctype html><html><head><meta charset="utf-8"><style>{css}
body{{background:#090909;margin:15px}}
#typing-text{{width:670px;height:205px;position:relative;border:1px solid #555;--typing-font-size:29px}}
</style></head><body><div id="typing-text" class="typing-text rtl"></div></body></html>'''

source=('برنامه برای یادگیری بهتر نیاز به تمرین پیوسته دارد و مهارت با زمان بهتر می شود. ').__mul__(18)
script='''async ([engineUrl,source]) => {
 const {TypingEngine}=await import(engineUrl);
 const engine=new TypingEngine({language:'fa',strictAccuracy:false});
 engine.setText(source,{id:'persian-long'});
 engine.mount(document.querySelector('#typing-text'));
 window.testEngine=engine;
 window.typeThrough=async count => {
  const upto=Math.min(count,engine.chars.length-1);
  while(engine.index<upto){
   const next=engine.chars[engine.index];
   document.dispatchEvent(new KeyboardEvent('keydown',{key:next,bubbles:true,cancelable:true,code:'KeyP'}));
   if(engine.index%9===0) await new Promise(requestAnimationFrame);
  }
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const box=engine.container.getBoundingClientRect();
  const overlay=engine.markerLayer.getBoundingClientRect();
  const mark=engine.markerLayer.querySelector('[data-current-index]');
  const caret=engine._rangeFor(engine.index).getBoundingClientRect();
  const m=mark?.getBoundingClientRect();
  return {
    index:engine.index,scrollTop:engine.container.scrollTop,
    marker: m ? {x:m.x,y:m.y,width:m.width,height:m.height} : null,
    overlay:{left:overlay.left,top:overlay.top,bottom:overlay.bottom,width:overlay.width,height:overlay.height,overflow:getComputedStyle(engine.markerLayer).overflow,hostLeft:box.left,hostTop:box.top,hostWidth:box.width,hostHeight:box.height},
    markerInsideOverlay:!!m && m.top>=overlay.top-2 && m.bottom<=overlay.bottom+2,
    visible:!!m && m.top>=box.top-3 && m.bottom<=box.bottom+3,
    tracking:!!m && Math.abs(m.left-caret.left)<3 && Math.abs(m.top-caret.top)<3,
    glyphNodes:[...engine.glyphLayer.childNodes].filter(n=>n.nodeType===Node.TEXT_NODE).length,
    scrollHeight:engine.container.scrollHeight,
  };
 }
 return engine.chars.length;
}'''

with sync_playwright() as p:
    system=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium')
    browser=p.chromium.launch(headless=True,executable_path=system if Path(system).exists() else None,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':920,'height':550},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html)
    total=page.evaluate(script,[module_url(core/'typing-engine.js'),source])
    previous=-1
    for i in [35,160,420,750,total-10]:
        result=page.evaluate('(count)=>window.typeThrough(count)',i)
        print(f'Index {result["index"]}/{total} scroll={result["scrollTop"]} marker={result["marker"]} overlayHeight={result["overlay"]["height"]}')
        assert result['glyphNodes']==1, 'Persian graphemes must remain joined in one text node'
        assert result['overlay']['overflow']=='hidden', 'Overlay must clip to viewport: '+str(result)
        assert abs(result['overlay']['height']-result['overlay']['hostHeight'])<=1, f'Overlay is NOT viewport height: {result}'
        assert abs(result['overlay']['width']-result['overlay']['hostWidth'])<=1, f'Overlay width diverges: {result}'
        assert abs(result['overlay']['top']-result['overlay']['hostTop'])<=1, f'Overlay top diverges: {result}'
        assert abs(result['overlay']['left']-result['overlay']['hostLeft'])<=1, f'Overlay left diverges: {result}'
        assert result['markerInsideOverlay'],f"MARKER CLIPPED BY ITS LAYER: {result}"
        assert result['visible'],f"MARKER ESCAPED THE VIEWPORT: {result}"
        assert result['tracking'],f"MARKER NOT ALIGNED TO PERSIAN GLYPH: {result}"
        assert result['scrollTop']>=previous, 'Scroll unexpectedly jumped backward'
        previous=result['scrollTop']
    assert previous>300, 'Passage did not reach bottom lines'
    # A mistake at the bottom must remain visible beside the current marker.
    error_probe=page.evaluate('''async () => {
      const e=window.testEngine, oldIndex=e.index;
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'\u20ac',bubbles:true,cancelable:true,code:'KeyE'}));
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      const wrong=e.markerLayer.querySelector(`[data-status-index="${oldIndex}"]`);
      const overlay=e.markerLayer.getBoundingClientRect();
      const box=e.container.getBoundingClientRect();
      const r=wrong?.getBoundingClientRect();
      return {oldIndex,index:e.index,exists:!!wrong,visible:!!r && r.top>=box.top && r.bottom<=box.bottom,
        insideOverlay:!!r && r.top>=overlay.top && r.bottom<=overlay.bottom};
    }''')
    assert error_probe['exists'] and error_probe['visible'] and error_probe['insideOverlay'],f'Bottom-line error highlight missing: {error_probe}'
    page.evaluate('''async () => {
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Backspace',bubbles:true,cancelable:true,code:'Backspace'}));
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
    }''')
    assert page.evaluate('window.testEngine.markerLayer.querySelector("[data-status-index]")===null'),'Backspace did not clear the wrong highlight'
    # Zoom triggers a glyph reflow without any new keystrokes.
    page.evaluate("document.querySelector('#typing-text').style.setProperty('--typing-font-size','37px')")
    page.evaluate('window.testEngine.scrollToCurrent(true)')
    result=page.evaluate('(count)=>window.typeThrough(count)',total-10)
    assert result['markerInsideOverlay'] and result['visible'] and result['tracking'],f'Zoom reflow broke marker: {result}'
    assert abs(result['overlay']['height']-result['overlay']['hostHeight'])<=1, f'Zoom overflow broke overlay height: {result}'
    # A parent (#view) scroll must NOT leave a fixed-position marker stranded.
    nested=page.evaluate('''async () => {
      const engine=window.testEngine;
      const host=engine.container;
      const wrapper=document.createElement('div');
      wrapper.style.cssText='height:340px;overflow-y:auto;position:relative;width:710px';
      const spacer=document.createElement('div');spacer.style.height='190px';
      host.parentElement.insertBefore(wrapper,host);
      wrapper.append(spacer,host);
      wrapper.scrollTop=130;
      engine.scrollToCurrent(true);
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      const box=host.getBoundingClientRect();
      const overlay=engine.markerLayer.getBoundingClientRect();
      const marker=engine.markerLayer.querySelector('[data-current-index]')?.getBoundingClientRect();
      const caret=engine._rangeFor(engine.index)?.getBoundingClientRect();
      return {hostTop:box.top,overlayTop:overlay.top,hostHeight:box.height,overlayHeight:overlay.height,
        marker:marker?{top:marker.top,left:marker.left}:null,caret:caret?{top:caret.top,left:caret.left}:null,
        tracking:!!marker&&!!caret&&Math.abs(marker.top-caret.top)<2&&Math.abs(marker.left-caret.left)<2};
    }''')
    assert nested['tracking'],f'Outer scroll broke marker positioning: {nested}'
    assert abs(nested['hostTop']-nested['overlayTop'])<=1,f'Outer scroll shifted overlay: {nested}'
    assert abs(nested['hostHeight']-nested['overlayHeight'])<=1,f'Outer scroll resized overlay: {nested}'
    # A new passage must replace markers and re-attach resize observation.
    replaced=page.evaluate('''async () => {
      const engine=window.testEngine;
      engine.setText(('متن تازه برای تمرین پیوسته است و باید درست نمایش داده شود. ').repeat(10));
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      const box=engine.container.getBoundingClientRect();
      const overlay=engine.markerLayer.getBoundingClientRect();
      const marker=engine.markerLayer.querySelector('[data-current-index]')?.getBoundingClientRect();
      const caret=engine._rangeFor(engine.index)?.getBoundingClientRect();
      return {index:engine.index,scrollTop:engine.container.scrollTop,
        marker:marker?{top:marker.top,left:marker.left}:null,caret:caret?{top:caret.top,left:caret.left}:null,hostTop:box.top,
        overlays:document.querySelectorAll('.typing-viewport-overlay').length,
        tracking:!!marker&&!!caret&&Math.abs(marker.top-caret.top)<2&&Math.abs(marker.left-caret.left)<2,
        height:overlay.height,expectedHeight:box.height};
    }''')
    assert replaced['index']==0 and replaced['scrollTop']==0 and replaced['overlays']==1 and replaced['tracking'],f'New passage left stale overlay: {replaced}'
    assert abs(replaced['height']-replaced['expectedHeight'])<=1, f'New text height wrong: {replaced}'
    # A failed audio/feedback backend cannot stop the hot key loop.
    # A timeboxed sprint may finish a partially completed long passage.
    sprint=page.evaluate('''async () => {
      const e=window.testEngine;
      e.onFeedback=()=>{throw Error("simulated audio fault")};
      const before=e.index;
      const ch=e.chars[e.index];
      document.dispatchEvent(new KeyboardEvent('keydown',{key:ch,bubbles:true,cancelable:true,code:'KeyP'}));
      const advanced=e.index===before+1;
      document.dispatchEvent(new KeyboardEvent('keydown',{key:e.chars[e.index],bubbles:true,cancelable:true,code:'KeyP'}));
      const details=[];e.addEventListener('finish',ev=>details.push(ev.detail));
      const done=e.finishSprint();
      return {advanced,done,reason:details[0]?.completionReason,completedChars:details[0]?.completedChars};
    }''')
    assert sprint['advanced'] and sprint['done'] and sprint['reason']=='sprint',f'2.7 sprint or audio isolation failed: {sprint}'
    print('PASS: 2.7 browser audio-exception isolation + timed sprint partial completion')
    page.evaluate('window.testEngine.destroy()')
    browser.close()
    assert not errors,errors
    print('PASS: Chromium Persian caret visible at last line; zoom, outer scrolling, passage replacement and cleanup')

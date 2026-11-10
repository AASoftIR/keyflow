"""Chromium responsive-layout stress test without external navigation or a build server.
Exercises the real text engine, full application CSS, and the shipped guide/error
markup using a local HTML document injected with Playwright's set_content.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import base64, json
root=Path(__file__).resolve().parents[1]
core=root/'app/core'
def uri(source):return 'data:text/javascript;base64,'+base64.b64encode(source.encode()).decode()
def module(path):
    src=path.read_text()
    for dep in ('normalization','stats','viewport'):
        src=src.replace(f"from './{dep}.js'",f"from '{uri((core/(dep+'.js')).read_text())}'")
    return uri(src)
full_main=(root/'app/main.js').read_text()
start=full_main.index('      <div class="typing-guidance"')
end=full_main.index('      <div id="typing-text"',start)
actual_ui=full_main[start:end]
css=(root/'app/styles.css').read_text()
html=f'''<!DOCTYPE html><html><head><meta charset="utf-8"><style>{css}
html,body{{margin:0;overflow:hidden;background:#090909}}
#view{{position:relative!important;inset:auto!important;width:100%!important;height:100vh!important;overflow-y:auto!important;box-sizing:border-box;padding:12px!important}}
.practice-wrap{{padding:0!important;max-width:unset!important}}
.typing-card{{padding:16px!important}}
#typing-text{{width:100%;height:215px!important;position:relative;min-width:0;box-sizing:border-box}}
</style></head><body><main id="view"><div class="practice-wrap"><section class="typing-card panel"><div id="simulated-toolbar" style="height:45px"></div>{actual_ui}<div id="typing-text" class="typing-text rtl" dir="rtl"></div></section><div style="height:200px"></div></div></main></body></html>'''
text=('یک برنامه خوب باید با تغییر اندازه پنجره پایدار بماند و بازخورد تایپ را به موقع نشان دهد. ')*20
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1260,'height':740})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html)
    source=module(core/'typing-engine.js')
    page.evaluate('''async ([url,text])=>{
      const {TypingEngine}=await import(url);
      const e=new TypingEngine({language:'fa',strictAccuracy:false});
      e.setText(text,{id:'responsive-test'});e.mount(document.querySelector('#typing-text'));
      window.engine=e;
      window.paints=0;
      const original=e._queueMarkerPaint.bind(e);
      e._queueMarkerPaint=()=>{window.paints++;original();};
      window.measure=async()=>{
        e.scrollToCurrent(true);
        await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
        const host=e.container.getBoundingClientRect(),range=e._rangeFor(e.index).getBoundingClientRect();
        const m=e.markerLayer.querySelector('[data-current-index]');
        const marker=m?.getBoundingClientRect();
        return {index:e.index,host:{left:host.left,top:host.top,width:host.width,height:host.height},
         marker:marker?{left:marker.left,top:marker.top,width:marker.width}:null,
         expected:{left:range.left,top:range.top},
         panel:document.querySelector('#mistake-feedback').getBoundingClientRect().height,
         passageTop:host.top,paints:window.paints,
         guide:document.querySelector('#next-char').getBoundingClientRect().width};
      };
      window.typeSome=async count=>{
        for(let i=0;i<count;i++){
          const char=e.chars[e.index];if(!char)break;
          document.dispatchEvent(new KeyboardEvent('keydown',{key:char,code:'KeyA',bubbles:true,cancelable:true}));
          if(i%9===0)await new Promise(requestAnimationFrame);
        }
      };
    }''',[source,text])
    page.evaluate('window.typeSome(370)')
    snapshots=[]
    for width,height in [(1260,740),(950,570),(680,490),(450,430),(620,520),(1200,730)]:
        page.set_viewport_size({'width':width,'height':height})
        result=page.evaluate('window.measure()');snapshots.append((width,result))
        assert result['marker'],f'Caret vanished at {width}: {result}'
        assert abs(result['marker']['left']-result['expected']['left'])<3.5 and abs(result['marker']['top']-result['expected']['top'])<3.5, f'Caret misplaced at {width}: {result}'
        assert result['guide']>0
    print('✓ Caret follows Persian graphemes at window widths 1260, 950, 680, 450, 620 and 1200 px')
    # Error panel always has its own reserved space. No insertion/reflow when wrong.
    before=page.evaluate('window.measure()')
    page.evaluate('''()=>{
       const panel=document.querySelector('#mistake-feedback');panel.dataset.state='error';
       document.querySelector('#mistake-typed').textContent='Wrong ش';
       document.querySelector('#mistake-expected').textContent='Expected س';
       document.querySelector('#mistake-feedback-label').textContent='Incorrect key';
       const event=new KeyboardEvent('keydown',{key:'€',code:'KeyE',bubbles:true,cancelable:true});document.dispatchEvent(event);
    }''')
    after=page.evaluate('window.measure()')
    assert abs(before['panel']-after['panel'])<1, (before,after)
    assert abs(before['passageTop']-after['passageTop'])<1, (before,after)
    assert abs(after['marker']['top']-after['expected']['top'])<3.5
    wrong=page.evaluate("({typed:document.querySelector('#mistake-typed').textContent,markers:document.querySelectorAll('.typing-marker.wrong').length,errors:engine.errors})")
    assert wrong['markers'] and wrong['errors'] and 'Wrong' in wrong['typed'],wrong
    print('✓ Wrong letter remains visible in a reserved feedback slot without shifting the text or caret')
    page.evaluate('window.paints=0')
    page.evaluate('for(let i=0;i<180;i++)window.dispatchEvent(new Event("resize"))')
    page.wait_for_timeout(350)
    paints=page.evaluate('window.paints')
    assert paints<7, f'Unchanged dimensions caused a resize/paint storm: {paints}'
    print('✓ 180 duplicate resize events do not trigger a repeated marker repaint cycle:',paints,'scheduled paints')
    page.evaluate('window.engine.destroy()')
    assert page.locator('.typing-viewport-overlay').count()==0
    assert not errors,errors
    print('✓ All browser tests passed, including cleanup and no page exceptions')
    browser.close()

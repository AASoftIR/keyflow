"""Real Chromium smoke of the actual Keyflow TypingEngine without npm or server.
Run on Arch/EndeavourOS: python tests/run-viewport-browser.py
Requires playwright and a system Chromium binary.
"""
from pathlib import Path
import os,base64
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
core=root/'app/core'
def module_url(path):
    source=path.read_text()
    for dep in ['normalization','stats','viewport']:
        source=source.replace("from './"+dep+".js'", "from '"+_simple_url(core/(dep+'.js'))+"'")
    return _url(source)
def _url(source):
    return 'data:text/javascript;base64,'+base64.b64encode(source.encode()).decode()
def _simple_url(path):return _url(path.read_text())

css=(root/'app/styles.css').read_text()
html='<html><head><meta charset="utf-8"><style>'+css+'''body{background:#090909;margin:15px}#typing-text{width:670px;height:205px;position:relative;border:1px solid #555;--typing-font-size:29px}</style></head><body><div id="typing-text" class="typing-text rtl"></div></body></html>'''
script='''async (moduleUrl)=>{
 const {TypingEngine}=await import(moduleUrl);
 const source=('برنامه برای یادگیری بهتر نیاز به تمرین پیوسته دارد و مهارت با زمان بهتر می شود. ').repeat(16);
 const engine=new TypingEngine({language:'fa',strictAccuracy:false});
 engine.setText(source,{id:'persian-long'});
 engine.mount(document.getElementById('typing-text'));
 window.testEngine=engine;
 window.typeThrough=async count=>{
  const upto=Math.min(engine.chars.length,count);
  while(engine.index<upto){
    const current=engine.chars[engine.index];
    document.dispatchEvent(new KeyboardEvent('keydown',{key:current,bubbles:true,cancelable:true,code:'KeyP'}));
    if(engine.index%6===0)await new Promise(requestAnimationFrame);
  }
  await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
  const box=engine.container.getBoundingClientRect();
  const currentRect=engine._rangeFor(Math.min(engine.index,engine.chars.length-1))?.getBoundingClientRect();
  return {index:engine.index,scrollTop:engine.container.scrollTop,scrollHeight:engine.container.scrollHeight,clientHeight:engine.container.clientHeight,visible:!!currentRect&&currentRect.top>=box.top-2&&currentRect.bottom<=box.bottom+2,rect:currentRect?{top:currentRect.top,bottom:currentRect.bottom}:null,view:{top:box.top,bottom:box.bottom}};
 };
 return engine.chars.length;
}'''
with sync_playwright() as p:
    path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium')
    browser=p.chromium.launch(headless=True,executable_path=path if Path(path).exists() else None,args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':900,'height':650})
    errors=[]
    page.on('pageerror',lambda exc:errors.append(str(exc)))
    page.set_content(html)
    total=page.evaluate(script,module_url(core/'typing-engine.js'))
    samples=[page.evaluate(f'window.typeThrough({n})') for n in (35,160,420)]
    print('Passage length',total,'char samples:',samples)
    assert not errors,f'Browser errors: {errors}'
    assert samples[1]['scrollTop']>0,'Scrollbar never moved beyond the first screen'
    assert samples[2]['scrollTop']>samples[1]['scrollTop'],'Scrollbar stopped later in passage'
    assert all(x['visible'] for x in samples),'Active character escaped viewport'
    page.evaluate('window.testEngine.browsePage(-1)')
    assert page.evaluate('window.testEngine.followCursor') is False
    page.evaluate('window.testEngine.setFollowCursor(true)')
    page.evaluate('window.testEngine.destroy()')
    browser.close()
    print('PASS: REAL Chromium long Persian text advances and current key stays visible')

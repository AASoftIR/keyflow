"""Real Chromium engine test for interruption/restart with rebased performance clock."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import base64
root=Path(__file__).resolve().parents[1];core=root/'app/core'
def data(source):return 'data:text/javascript;base64,'+base64.b64encode(source.encode()).decode()
def module_file(path):
 source=path.read_text()
 for dep in ['normalization','stats','viewport']:
  source=source.replace(f"from './{dep}.js'",f"from '{data((core/(dep+'.js')).read_text())}'")
 return data(source)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page();page.set_content(f"<style>{(root/'app/styles.css').read_text()} #test{{width:700px;height:240px}}</style><div id='test' class='typing-text'></div>")
 outcome=page.evaluate('''async (url)=>{
   const {TypingEngine}=await import(url);
   const text='we learn by practicing clean keys often.';
   const e=new TypingEngine({language:'en'});e.setText(text,{id:'ckpt'});e.mount(document.querySelector('#test'));
   async function press(ch){document.dispatchEvent(new KeyboardEvent('keydown',{key:ch,code:'KeyA',bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,65));}
   for(const ch of text.slice(0,21))await press(ch);
   const before=e.snapshot();if(before.index!==21)throw Error('Snapshot did not track typed cursor');
   // Simulate performance timestamps from a previous process with higher uptime.
   for(const ev of before.events)if(typeof ev.t==='number')ev.t+=999999;
   e.destroy();
   const restored=new TypingEngine({language:'en'});restored.setText(text,{id:'ckpt'});restored.mount(document.querySelector('#test'));
   if(!restored.restore(before))throw Error('Engine rejected a valid checkpoint');
   if(restored.index!==21 || restored.correct!==21)throw Error('Cursor/accuracy mismatch after restore');
   if(restored.chars[restored.index]!==text[21])throw Error('Wrong next key after restore');
   let done=null;restored.addEventListener('finish',ev=>done=ev.detail);
   for(const ch of text.slice(21))await press(ch);
   if(!done || !done.summary.reliable)throw Error('Restored session finished without a valid score: '+JSON.stringify(done?.summary));
   return {index:before.index,typed:done.summary.typed,wpm:done.summary.wpm,accuracy:done.summary.accuracy,reliable:done.summary.reliable};
 }''',module_file(core/'typing-engine.js'))
 print('✓ Actual browser restart restoration:',outcome)
 assert outcome['reliable'] and outcome['accuracy']==100 and outcome['typed']==len('we learn by practicing clean keys often.')
 browser.close()

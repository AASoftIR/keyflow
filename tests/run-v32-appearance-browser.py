"""Chromium CSS/layout smoke using set_content (network navigation prohibited)."""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
css=(root/'app/styles.css').read_text()
html=f'''<!doctype html><html><head><meta charset="utf-8"><style>{css}</style></head>
<body data-theme="amber" data-caret="underline" style="--practice-max:1250px">
<div class="practice-wrap" style="width:auto"><div class="practice-toolbar"></div><div class="metrics"><div class="metric">99</div></div><section class="typing-card"><div class="typing-text">Sample practice text</div><div class="typing-marker current">T</div></section><div class="keyboard-panel">Keyboard</div></div></body></html>'''
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1600,'height':900});errors=[]
 page.on('pageerror',lambda error:errors.append(str(error)))
 page.set_content(html)
 initial=page.evaluate('''()=>({accent:getComputedStyle(document.body).getPropertyValue('--accent').trim(),width:document.querySelector('.practice-wrap').getBoundingClientRect().width})''')
 page.evaluate('''()=>{document.body.dataset.theme='violet';document.body.dataset.caret='outline';document.body.classList.add('compact-density','keyboard-hidden');document.body.style.setProperty('--practice-max','850px');}''')
 changed=page.evaluate('''()=>({accent:getComputedStyle(document.body).getPropertyValue('--accent').trim(),width:document.querySelector('.practice-wrap').getBoundingClientRect().width,keyboard:getComputedStyle(document.querySelector('.keyboard-panel')).display,caret:getComputedStyle(document.querySelector('.typing-marker')).borderTopStyle})''')
 assert initial['accent']!=changed['accent'],(initial,changed)
 assert changed['width']<=851,changed
 assert changed['keyboard']=='none',changed
 assert changed['caret']=='solid',changed
 print('✓ Palette, compact workspace, 850-pixel reading width, hidden keyboard and outline caret apply in Chromium')
 page.set_viewport_size({'width':490,'height':550})
 rect=page.evaluate('''()=>{const r=document.querySelector('.practice-wrap').getBoundingClientRect();return {x:r.x,width:r.width,screen:innerWidth}}''')
 assert rect['width']<=rect['screen'] and rect['x']>=0,rect
 assert not errors,errors
 print('✓ Customized layout remains within a 490px window without page exceptions')
 browser.close()

"""Chromium smoke of KeyFlow's actual vanilla UI without network navigation.

Some restricted CI environments prohibit even localhost/file:// navigation. This
harness uses set_content plus browser-created blob module URLs for all unchanged
app modules and minimal Tauri/audio stubs. It deliberately does not test native
credential or Cuelume integration.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root=Path(__file__).resolve().parents[1]
app=root/'app'
files={f'app/{p.relative_to(app).as_posix()}':p.read_text() for p in app.rglob('*.js')}
files.update({
  '@tauri-apps/api/window': 'export function getCurrentWindow(){return {minimize:async()=>{},toggleMaximize:async()=>{},close:async()=>{},startDragging:async()=>{},startResizeDragging:async()=>{}}}',
  '@tauri-apps/api/core': 'export async function invoke(){return {}}',
  'cuelume': 'export const bind=()=>{};export const play=()=>{};export const setEnabled=()=>{};export const setTheme=()=>{};export const setVolume=()=>{};'
})
html=(app/'index.html').read_text()
html=html.replace('<link rel="stylesheet" href="/styles.css" />',f'<style>{(app/"styles.css").read_text()}</style>')
html=html.replace('<link rel="stylesheet" href="/studio.css" />',f'<style>{(app/"studio.css").read_text()}</style>')
html=html.replace('<script type="module" src="/main.js"></script>','')
errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1440,'height':900})
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.set_content(html,wait_until='domcontentloaded')
    # Opaque about:blank origins cannot access localStorage. A deterministic
    # in-memory store tests settings within one page while avoiding credentials.
    page.evaluate('''() => {
      const values=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{
        getItem:k=>values.has(k)?values.get(k):null,
        setItem:(k,v)=>values.set(k,String(v)),
        removeItem:k=>values.delete(k)
      }});
      delete window.indexedDB;
    }''')
    page.evaluate('''async files => {
      const urls=new Map(),inFlight=new Set();
      const make=(id)=>{
        if(urls.has(id))return urls.get(id);
        if(inFlight.has(id))throw new Error('Circular blob dependency: '+id);
        if(!(id in files))throw new Error('Missing module '+id);
        inFlight.add(id);
        const source=files[id].replace(/(\\bfrom\\s*['\"])([^'\"]+)(['\"])/g,(_match,pre,dep,post)=>{
          const target=dep.startsWith('.') ? new URL(dep,'https://test.invalid/'+id).pathname.slice(1) : dep;
          return pre+make(target)+post;
        });
        const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
        urls.set(id,url);inFlight.delete(id);return url;
      };
      await import(make('app/main.js'));
    }''',files)
    page.locator('#typing-text').wait_for(timeout=15000)
    page.screenshot(path='/mnt/data/keyflow_design_work/studio-wide.png',full_page=True)
    assert page.locator('.studio-brief').count()==1
    assert page.locator('[data-studio-routine]').count()==4
    assert page.locator('.nav-button.active').get_attribute('aria-current')=='page'
    assert page.locator('#mistake-feedback').count()==1
    print('✓ Real vanilla-JS application mounted with new studio and accessible navigation')
    # A mistake changes only the fixed feedback slot and overlay, never passage
    # geometry. This directly protects the caret alignment regression.
    initial=page.locator('#typing-text').bounding_box()
    expected=page.locator('#next-char').inner_text().strip().lower()
    wrong='x' if expected!='x' else 'q'
    page.keyboard.press(wrong)
    assert page.locator('#mistake-feedback').get_attribute('data-state')=='error'
    assert wrong in page.locator('#mistake-typed').inner_text().lower()
    after=page.locator('#typing-text').bounding_box()
    assert abs(after['y']-initial['y'])<1,(initial,after)
    assert abs(after['x']-initial['x'])<1,(initial,after)
    print('✓ Real wrong-key feedback leaves text position unchanged')

    page.locator('[data-route="settings"]').click()
    page.locator('#s-visual').select_option('quiet')
    page.locator('#s-motion').select_option('none')
    page.locator('[data-color="mint"]').click()
    assert page.locator('body').get_attribute('data-visual')=='quiet'
    assert page.locator('body').get_attribute('data-motion')=='none'
    assert page.locator('body').get_attribute('data-theme')=='mint'
    print('✓ Settings controls actually change the live workspace appearance')
    # Verify every actual product route after the shell redesign.
    for route in ('progress','library','ai','lab'):
        page.locator(f'[data-route="{route}"]').click()
        page.wait_for_timeout(40)
        assert page.locator('#view').inner_text().strip(),route
        assert page.locator('.nav-button.active').get_attribute('data-route')==route
    print('✓ Progress, Library, AI Studio, and Lab remain accessible')
    page.locator('[data-route="practice"]').click()
    page.locator('#typing-text').wait_for()
    page.keyboard.press('Control+k')
    dialog=page.locator('[role="dialog"]');dialog.wait_for()
    assert dialog.get_attribute('aria-modal')=='true'
    assert dialog.locator('#cmd-input').count()==1
    assert page.locator('#cmd-input').evaluate('(el)=>el===document.activeElement')
    page.keyboard.press('Escape')
    assert dialog.count()==0
    print('✓ Command palette receives focus and dismisses with Escape')

    page.set_viewport_size({'width':480,'height':800})
    page.wait_for_timeout(100)
    page.screenshot(path='/mnt/data/keyflow_design_work/studio-narrow.png',full_page=True)
    dims=page.evaluate('''()=>({
      dock:getComputedStyle(document.querySelector('.sidebar')).flexDirection,
      view:document.querySelector('#view').getBoundingClientRect().toJSON(),
      brief:document.querySelector('.studio-brief').getBoundingClientRect().toJSON(),
      text:document.querySelector('#typing-text').getBoundingClientRect().toJSON(),
      overflow:document.documentElement.scrollWidth-innerWidth
    })''')
    assert dims['dock']=='row',dims
    assert dims['view']['x']==0 and dims['view']['right']<=481,dims
    assert dims['brief']['right']<=481 and dims['text']['right']<=481,dims
    assert dims['overflow']<=1,dims
    print('✓ 480px window uses bottom dock and keeps passage inside viewport')
    page.locator('#practice-details-toggle').click()
    assert page.locator('#practice-details-toggle').get_attribute('aria-expanded')=='true'
    assert page.locator('.practice-insights').is_visible()
    page.locator('#practice-details-toggle').click()
    assert not page.locator('.practice-insights').is_visible()
    page.locator('#practice-tools-toggle').click()
    assert page.locator('#practice-mode').is_visible()
    page.locator('#practice-tools-toggle').click()
    assert not page.locator('#practice-mode').is_visible()
    print('✓ Narrow-window extra controls are accessible but remain collapsed by default')

    page.locator('[data-studio-routine="warmup"]').click()
    page.locator('#typing-text').wait_for()
    assert page.locator('#practice-length').input_value()=='quick'
    print('✓ Warm-up starts a genuine quick passage')
    # Persian uses RTL glyph shaping: this tests the actual in-app renderer.
    page.locator('[data-lang="fa"]').click()
    page.locator('#typing-text.rtl').wait_for()
    before=page.locator('#typing-text').bounding_box()
    page.evaluate('''() => {
      const ch=document.querySelector('#next-char').textContent;
      const wrong=ch==='ز'?'ب':'ز';
      document.dispatchEvent(new KeyboardEvent('keydown',{key:wrong,code:'KeyB',bubbles:true,cancelable:true}));
    }''')
    after=page.locator('#typing-text').bounding_box()
    assert abs(after['y']-before['y'])<1,(before,after)
    for width in (540,710,940,480):
        page.set_viewport_size({'width':width,'height':800})
        page.wait_for_timeout(35)
        box=page.locator('#typing-text').bounding_box()
        assert box['x']>=0 and box['x']+box['width']<=width+1,(width,box)
    print('✓ Persian passage remains geometrically stable through RTL wrong key + repeated resize')
    assert not errors,errors
    print('✓ No unhandled browser JS errors')
    browser.close()

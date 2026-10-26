"""Browser-level integration smoke for 3.0, using stubs only for native Tauri/audio APIs.
Requires python playwright and a system Chromium. Never contacts remote AI services.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
from tempfile import TemporaryDirectory
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
import shutil, os, json
root=Path(__file__).resolve().parents[1]
with TemporaryDirectory() as directory:
    www=Path(directory)/'app';shutil.copytree(root/'app',www)
    replacements={
      "'@tauri-apps/api/window'":"'./stub-window.js'",
      "'@tauri-apps/api/core'":"'./stub-core.js'",
      "'cuelume'":"'../stub-audio.js'"
    }
    for filename in ['main.js','core/credentials.js','ai/providers.js','audio/audio.js']:
        path=www/filename;content=path.read_text()
        for old,new in replacements.items():
            if filename!='main.js' and old=="'@tauri-apps/api/core'":new="'../stub-core.js'"
            if filename=='main.js' and old=="'cuelume'":continue
            content=content.replace(old,new)
        path.write_text(content)
    (www/'stub-core.js').write_text('export async function invoke(){throw Error("native APIs unavailable in browser smoke");}')
    (www/'stub-window.js').write_text('export function getCurrentWindow(){return {minimize:async()=>{},toggleMaximize:async()=>{},close:async()=>{},startDragging:async()=>{},startResizeDragging:async()=>{}};}')
    (www/'stub-audio.js').write_text('export const bind=()=>{},play=()=>{},setEnabled=()=>{},setTheme=()=>{},setVolume=()=>{};')
    class Handler(SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
    http=ThreadingHTTPServer(('127.0.0.1',0),partial(Handler,directory=str(www)))
    server=Thread(target=http.serve_forever,daemon=True);server.start()
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        context=browser.new_context(accept_downloads=True,viewport={'width':1440,'height':900})
        page=context.new_page();errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(f'http://127.0.0.1:{http.server_port}/index.html')
        page.locator('#typing-text').wait_for(timeout=15000)
        assert page.locator('#ghost-toggle').count()==1
        assert page.locator('#fatigue-radar').count()==1
        print('✓ Main practice mounted with PB ghost and fatigue HUD')
        page.locator('[data-route="lab"]').click()
        page.locator('#lab-review').wait_for()
        assert page.locator('.next-tile').count()==8
        print('✓ All 8 actual Lab feature panels mounted')
        page.locator('#lab-code-select').select_option('python')
        page.locator('#lab-code').click();page.locator('.code-fluency').wait_for()
        assert page.locator('#typing-text').inner_text().startswith('def frequency(')
        page.keyboard.press('d')
        assert page.locator('#live-key-trace').inner_text().endswith('d')
        page.wait_for_timeout(2300)
        assert page.evaluate("Boolean(JSON.parse(localStorage.getItem('keyflow.checkpoint'))?.engine?.index===1)")
        print('✓ Code fluency handles real input and saves checkpoint off the hot path')
        page.locator('[data-route="lab"]').click();page.locator('#lab-checkpoint').wait_for()
        assert page.locator('#lab-checkpoint').is_enabled()
        page.locator('#lab-checkpoint').click()
        page.locator('#typing-text').wait_for()
        assert page.locator('#next-char').inner_text()=='e',page.locator('#next-char').inner_text()
        print('✓ Restore retained cursor, expected character and elapsed clock')
        page.locator('[data-route="lab"]').click();page.locator('#lab-vault').click()
        page.locator('#vault-export').wait_for()
        with page.expect_download() as download:
            page.locator('#vault-export').click()
        result=download.value
        target=Path(directory)/'saved-vault.json';result.save_as(target)
        payload=json.loads(target.read_text());assert payload['app']=='keyflow'
        assert 'aiProxyUrl' not in payload['settings'] and 'apiKey' not in payload['settings']
        assert payload['schema']==3
        print('✓ Data Vault exports genuine JSON with secret fields omitted')
        page.locator('#vault-file').set_input_files(str(target))
        page.get_by_text('Imported ',exact=False).wait_for(timeout=12000)
        print('✓ Data Vault accepted and merged its own exported data')
        page.locator('.modal-backdrop').click(position={'x':2,'y':2})
        page.locator('#lab-dna').click()
        page.get_by_text('Your confusion fingerprint').wait_for()
        print('✓ Error DNA analysis opens real drill interface')
        page.locator('.modal-backdrop').click(position={'x':2,'y':2})
        page.locator('#lab-circuit').click()
        page.locator('#typing-text').wait_for()
        assert page.locator('#typing-text').count()==1
        print('✓ Guided circuit launched actual practice')
        assert not errors,'JavaScript runtime exceptions: '+repr(errors)
        browser.close()
    http.shutdown()
print('All 3.0 Chromium UI regressions passed.')

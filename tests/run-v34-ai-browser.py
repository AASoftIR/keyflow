"""End-to-end browser mock for AI->commit->Practice Now->no typing.
No real API credentials or external network. Includes a minimal IndexedDB
implementation to exercise the genuine storage transaction and UI callbacks.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1];app=root/'app'
files={f'app/{p.relative_to(app).as_posix()}':p.read_text() for p in app.rglob('*.js')}
files.update({
 '@tauri-apps/api/window': 'export function getCurrentWindow(){return {minimize:async()=>{},toggleMaximize:async()=>{},close:async()=>{},startDragging:async()=>{},startResizeDragging:async()=>{}}}',
 '@tauri-apps/api/core':'export async function invoke(){return {}}',
 'cuelume':'export const bind=()=>{};export const play=()=>{};export const setEnabled=()=>{};export const setTheme=()=>{};export const setVolume=()=>{};'
})
# A coherent non-duplicated mock passage, deliberately far from built-ins.
paragraph=('The observatory archivist opened a handwritten notebook on a bright morning. '
 'Each page described a different measurement, and every observation was checked carefully. '
 'After reviewing the small telescope, the team compared the newest results with an older drawing. '
 'They discovered that careful notes helped them explain a pattern that had seemed confusing. '
 'At sunset, the archivist prepared a clear report so the next day visitors could learn from the work.')
assert 320<=len(paragraph)<=620,len(paragraph)
files['app/ai/providers.js']=f'''
export const PROVIDERS={{openrouter:{{id:'openrouter',name:'Mock OpenRouter',requiresKey:false,freeLabel:'Offline test',description:'Mock text model',fields:[]}}}};
export async function listProviderModels(){{return [{{id:'mock/text',name:'Mock text model'}}]}};
export function pickRecommendedModel(models){{return models[0]||null}}
export async function testAiTransport(){{return {{ok:true}}}}
export function fallbackModels(){{return []}}
export async function providerChat(){{return {{text:JSON.stringify({{title:'Original observatory report',text:{paragraph!r},language:'en',level:3,tags:['observatory']}})}}}}
export function classifyAiFailure(e){{return {{kind:'content',advice:String(e?.message||e)}}}}
'''
html=(app/'index.html').read_text()
html=html.replace('<link rel="stylesheet" href="/styles.css" />',f'<style>{(app/"styles.css").read_text()}</style>')
html=html.replace('<link rel="stylesheet" href="/studio.css" />',f'<style>{(app/"studio.css").read_text()}</style>')
html=html.replace('<script type="module" src="/main.js"></script>','')
polyfill=r'''() => {
 Object.defineProperty(window.crypto,'randomUUID',{configurable:true,value:()=> '12345678-1234-4567-89ab-'+Math.random().toString(16).slice(2).padEnd(12,'0').slice(0,12)});
 const values=new Map();
 Object.defineProperty(window,'localStorage',{configurable:true,value:{
  getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)
 }});
 const dataStores=new Map();
 const meta=new Map();
 const request=(callback)=>{const req={result:null,error:null,onsuccess:null,onerror:null,transaction:null};queueMicrotask(()=>{
  try{req.result=callback();req.onsuccess?.({target:req});}catch(e){req.error=e;req.onerror?.({target:req});}
 });return req;};
 const makeStore=(name,tx)=>({
  indexNames:{contains:n=>meta.get(name)?.indexes.has(n)||false},
  createIndex(n){meta.get(name).indexes.add(n);},
  put(record){const key=record[meta.get(name).keyPath];const req=request(()=>{dataStores.get(name).set(key,structuredClone(record));return key});
   queueMicrotask(()=>queueMicrotask(()=>tx.oncomplete?.({target:tx})));return req;},
  delete(key){const req=request(()=>dataStores.get(name).delete(key));queueMicrotask(()=>queueMicrotask(()=>tx.oncomplete?.({target:tx})));return req;},
  get(key){return request(()=>structuredClone(dataStores.get(name).get(key)??null))},
  getAll(){return request(()=>[...dataStores.get(name).values()].map(x=>structuredClone(x)))},
  index(n){return {openCursor:()=>cursorRequest(name,tx)}},
  openCursor:()=>cursorRequest(name,tx)
 });
 const cursorRequest=(name,tx)=>{
  const req={result:null,onsuccess:null,onerror:null,transaction:tx};
  const entries=[...dataStores.get(name).values()].reverse();let index=0;
  const next=()=>queueMicrotask(()=>{const value=entries[index++];req.result=value?{value,continue:next}:null;req.onsuccess?.({target:req});});
  next();return req;
 };
 const db={
  objectStoreNames:{contains:name=>dataStores.has(name)},
  createObjectStore(name,{keyPath}={}){dataStores.set(name,new Map());meta.set(name,{keyPath:keyPath||'id',indexes:new Set()});return makeStore(name,{})},
  transaction(names,mode){const tx={oncomplete:null,onerror:null,onabort:null,abort(){tx.onabort?.({target:tx})},objectStore:name=>makeStore(name,tx)};return tx;},
  close(){}
 };
 Object.defineProperty(window,'indexedDB',{configurable:true,value:{open(){const req={result:db,onsuccess:null,onerror:null,onupgradeneeded:null,transaction:{objectStore:name=>makeStore(name,{})}};
  queueMicrotask(()=>{if(!dataStores.size)req.onupgradeneeded?.({target:req});req.onsuccess?.({target:req})});return req;}}});
 window.__keyflowFakeData=dataStores;
 window.__keyflowFakeLocal=values;
}'''
module_loader=r'''async files => {
 const urls=new Map(),inFlight=new Set();
 const make=id=>{
  if(urls.has(id))return urls.get(id);
  if(inFlight.has(id))throw Error('Circular blob dependency '+id);
  if(!(id in files))throw Error('Missing module '+id);
  inFlight.add(id);
  const src=files[id].replace(/(\bfrom\s*['"])([^'"]+)(['"])/g,(_match,pre,dep,post)=>{
   const target=dep.startsWith('.')?new URL(dep,'https://test.invalid/'+id).pathname.slice(1):dep;
   return pre+make(target)+post;
  });
  const url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));urls.set(id,url);inFlight.delete(id);return url;
 };
 await import(make('app/main.js'));
}'''
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':1280,'height':840})
 errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
 page.set_content(html,wait_until='domcontentloaded');page.evaluate(polyfill)
 page.evaluate(module_loader,files)
 page.locator('#typing-text').wait_for(timeout=18000)
 page.locator('[data-route="ai"]').click()
 page.locator('#gen-length').select_option('short')
 page.locator('#gen-preset').select_option('speed')
 page.locator('#gen-lang').select_option('en')
 page.locator('#ai-model').fill('mock/text')
 page.locator('#generate').click()
 try:page.locator('#draft-practice').wait_for(timeout=6000)
 except Exception:
  print('DEBUG gen-status:',page.locator('#gen-status').inner_text())
  print('DEBUG ai-result:',page.locator('#ai-result').inner_text()[:1000])
  print('DEBUG errors:',errors)
  raise
 assert page.locator('#draft-practice').is_enabled(),page.locator('#gen-status').inner_text()
 info=page.evaluate('''()=>({records:[...window.__keyflowFakeData.get('texts').values()].map(x=>({id:x.id,source:x.source,level:x.level})),pending:JSON.parse(window.__keyflowFakeLocal.get('keyflow.ai.pending.v1')||'null')})''')
 assert len(info['records'])==1,info
 assert info['records'][0]['id']==info['pending']['id'],info
 assert 'apiKey' not in info['pending'],info
 print('✓ AI Generate commits actual text via IndexedDB transaction before enabling Practice Now')
 page.locator('#draft-practice').click()
 page.locator('#typing-text').wait_for(timeout=10000)
 assert page.locator('.ai-recovery-status').count()==1
 assert page.locator('#typing-text').inner_text().strip().startswith('The observatory'),page.locator('#typing-text').inner_text()
 assert page.evaluate('''()=>!!window.__keyflowFakeLocal.get('keyflow.ai.pending.v1')''')
 print('✓ Practice Now routes to saved passage; no keys pressed; pending pointer survives')
 # Simulate closing the app without completing: new route, refresh selection;
 # pending is selected by the normal no-fresh recovery rather than consumed.
 page.locator('[data-route="ai"]').click()
 page.locator('[data-route="practice"]').click()
 page.locator('#typing-text').wait_for()
 assert page.evaluate('''()=>!!window.__keyflowFakeLocal.get('keyflow.ai.pending.v1')''')
 print('✓ Merely viewing a passage does not count as completed in a second navigation')
 # Destroy the document and mount a genuinely new instance of the whole
 # application (the mock localStorage + IndexedDB objects survive the reload).
 page.set_content(html,wait_until='domcontentloaded')
 page.evaluate(module_loader,files)
 page.locator('#typing-text').wait_for(timeout=12000)
 assert page.locator('#typing-text').inner_text().strip().startswith('The observatory'),page.locator('#typing-text').inner_text()[:100]
 assert page.locator('.ai-recovery-status').count()==1
 assert page.evaluate('''()=>window.__keyflowFakeData.get('texts').size===1''')
 print('✓ Cold app remount restores same untyped AI passage from persistent snapshot, not a false exhausted-library message')
 assert not errors,errors
 print('✓ End-to-end mock AI / saved-DB / Practice Now browser scenario passed')
 browser.close()

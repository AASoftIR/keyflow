const DB_NAME='keyflow-next';
const DB_VERSION=2;
let dbPromise;

function openDb() {
  if (!('indexedDB' in globalThis)) return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,DB_VERSION);
    request.onupgradeneeded=()=>{
      const db=request.result;
      let sessionStore;
      if(!db.objectStoreNames.contains('sessions')){
        sessionStore=db.createObjectStore('sessions',{keyPath:'id'});
      } else {
        sessionStore=request.transaction.objectStore('sessions');
      }
      if(!sessionStore.indexNames.contains('startedAt')) sessionStore.createIndex('startedAt','startedAt');
      if(!sessionStore.indexNames.contains('language')) sessionStore.createIndex('language','language');
      if(!sessionStore.indexNames.contains('languageStartedAt')) sessionStore.createIndex('languageStartedAt',['language','startedAt']);
      if(!db.objectStoreNames.contains('texts')){
        const store=db.createObjectStore('texts',{keyPath:'id'});
        store.createIndex('language','language');
        store.createIndex('createdAt','createdAt');
      }
    };
    request.onsuccess=()=>{
      const db=request.result;
      db.onversionchange=()=>db.close();
      resolve(db);
    };
    request.onerror=()=>reject(request.error || new Error('IndexedDB opening failed'));
    request.onblocked=()=>reject(new Error('Keyflow database is blocked by another open window. Close the other window and retry.'));
  }).catch(error=>{ dbPromise=null; throw error; });
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const db=await openDb();
  if(!db) return fn(null);
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(storeName,mode);
    const store=transaction.objectStore(storeName);
    let result;
    try { result=fn(store); } catch(e){ transaction.abort(); reject(e); return; }
    transaction.oncomplete=()=>resolve(result);
    transaction.onerror=()=>reject(transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort=()=>reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

export async function saveSession(session){
  return tx('sessions','readwrite',store=>{ if(store) store.put(session); return session; });
}

export async function getSessions(){
  const db=await openDb();
  if(!db) return [];
  return new Promise((resolve,reject)=>{
    const r=db.transaction('sessions','readonly').objectStore('sessions').getAll();
    r.onsuccess=()=>resolve(r.result.sort((a,b)=>a.startedAt-b.startedAt));
    r.onerror=()=>reject(r.error);
  });
}


export async function getRecentSessions({language=null,limit=160,since=0}={}){
  const db=await openDb();
  if(!db) return [];
  const safeLimit=Math.max(1,Math.min(5000,Number(limit)||160));
  return new Promise((resolve,reject)=>{
    const store=db.transaction('sessions','readonly').objectStore('sessions');
    const index=language ? store.index('languageStartedAt') : store.index('startedAt');
    const lower=Math.max(0,Number(since)||0);
    const range=language
      ? IDBKeyRange.bound([language,lower],[language,Number.MAX_SAFE_INTEGER])
      : IDBKeyRange.lowerBound(lower);
    const rows=[];
    const request=index.openCursor(range,'prev');
    request.onsuccess=()=>{
      const cursor=request.result;
      if(!cursor || rows.length>=safeLimit){ resolve(rows.reverse()); return; }
      rows.push(cursor.value);
      cursor.continue();
    };
    request.onerror=()=>reject(request.error || new Error('Session cursor failed'));
    request.transaction.onabort=()=>reject(request.transaction.error || new Error('Session cursor aborted'));
  });
}

export async function saveText(text){
  return tx('texts','readwrite',store=>{ if(store) store.put(text); return text; });
}

export async function getCustomTexts(){
  const db=await openDb();
  if(!db) return [];
  return new Promise((resolve,reject)=>{
    const r=db.transaction('texts','readonly').objectStore('texts').getAll();
    r.onsuccess=()=>resolve(r.result.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)));
    r.onerror=()=>reject(r.error);
  });
}

export async function deleteText(id){
  return tx('texts','readwrite',store=>{ if(store) store.delete(id); });
}

export function loadJson(key,fallback){
  try{ const raw=localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }catch{return fallback;}
}
export function saveJson(key,value){ localStorage.setItem(key,JSON.stringify(value)); }

const SETTINGS_SCHEMA=9;

export const DEFAULT_SETTINGS={
  settingsSchema:SETTINGS_SCHEMA,
  language:'en',
  englishLayout:'en-us',
  persianLayout:'fa-standard',
  allowPersianDiacritics:false,
  normalizePersianLetters:true,
  strictAccuracy:false,
  pauseWhenUnfocused:true,
  soundEnabled:true,
  keySounds:true,
  soundVolume:0.34,
  soundProfile:'soft',
  reduceMotion:false,
  performanceMode:'ultra',
  autoLevel:true,
  showWeakKeyHeatmap:true,
  dailyMinutes:15,
  englishTargetWpm:55,
  persianTargetWpm:40,
  recentWindow:28,
  sessionLength:'long',
  focusMode:false,
  followCursor:true,
  textScale:1,
  idlePauseSeconds:45,
  provider:'openrouter',
  aiDeepReview:true,
  aiProxyEnabled:false,
  aiProxyUrl:'socks5h://127.0.0.1:10808',
  aiAutoFallback:true,
  modelByProvider:{},
  calibration:{'en-us':{},'fa-standard':{},'fa-windows':{}}
};

export function loadSettings(){
  const raw=loadJson('keyflow.settings',{});
  const stored=raw && typeof raw==='object' && !Array.isArray(raw) ? raw : {};
  const settings={...DEFAULT_SETTINGS,...stored};
  const cal=stored.calibration && typeof stored.calibration==='object' && !Array.isArray(stored.calibration) ? stored.calibration : {};
  settings.calibration={...DEFAULT_SETTINGS.calibration,...cal};
  for(const id of ['en-us','fa-standard','fa-windows']){
    if(!settings.calibration[id] || typeof settings.calibration[id]!=='object' || Array.isArray(settings.calibration[id])) settings.calibration[id]={};
  }
  if(!['en','fa'].includes(settings.language))settings.language='en';
  settings.followCursor=stored.followCursor!==false;
  settings.textScale=Number.isFinite(Number(settings.textScale))?Math.max(.8,Math.min(1.55,Math.round(settings.textScale*20)/20)):1;
  settings.idlePauseSeconds=[0,30,45,60,90].includes(Number(settings.idlePauseSeconds))?Number(settings.idlePauseSeconds):45;
  if(!['standard','long','endurance'].includes(settings.sessionLength))settings.sessionLength='long';
  if(!['mechanical','soft','minimal','playful'].includes(settings.soundProfile))settings.soundProfile='soft';
  settings.soundVolume=Math.max(0,Math.min(.8,Number(settings.soundVolume)||0));
  const oldSchema=Number(stored.settingsSchema)||0;
  if(oldSchema<SETTINGS_SCHEMA){
    settings.settingsSchema=SETTINGS_SCHEMA;
    // Preserve explicit on/off choices, but migrate the old aggressive stock
    // mechanical mix to the calmer Cuelume defaults introduced in 2.4.
    if(oldSchema<3){ settings.soundEnabled=true; settings.keySounds=true; }
    if(!Number.isFinite(Number(stored.soundVolume))) settings.soundVolume=0.34;
    if(oldSchema<8 && (!stored.soundProfile || stored.soundProfile==='mechanical' || Number(stored.soundVolume)>=0.70)) {
      settings.soundProfile='soft'; settings.soundVolume=Math.min(0.34,Number.isFinite(Number(stored.soundVolume))?Number(stored.soundVolume):0.34);
    }
    if(!['mechanical','soft','minimal','playful'].includes(settings.soundProfile)) settings.soundProfile='soft';
    if(!['standard','long','endurance'].includes(settings.sessionLength)) settings.sessionLength='long';
    saveJson('keyflow.settings',settings);
  }
  return settings;
}
export function saveSettings(settings){ saveJson('keyflow.settings',settings); }

export function getSeenState(){const raw=loadJson('keyflow.seen',{});return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};}
export function saveSeenState(state){ saveJson('keyflow.seen',state); }

export function loadProgression(){const raw=loadJson('keyflow.progression',{en:{},fa:{}});return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{en:{},fa:{}};}
export function saveProgression(value){ saveJson('keyflow.progression',value); }

export function saveProviderConfig(providerId,config){
  const raw=loadJson('keyflow.providers',{});
  const all=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  const {apiKey,...safe}=config;
  all[providerId]=safe;
  saveJson('keyflow.providers',all);
  if(apiKey) sessionStorage.setItem(`keyflow.key.${providerId}`,apiKey);
  else sessionStorage.removeItem(`keyflow.key.${providerId}`);
}
export function loadProviderConfig(providerId){
  const raw=loadJson('keyflow.providers',{});
  const all=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{};
  return {...(all[providerId]||{}),apiKey:sessionStorage.getItem(`keyflow.key.${providerId}`)||''};
}
export function clearProviderKey(providerId){ sessionStorage.removeItem(`keyflow.key.${providerId}`); }

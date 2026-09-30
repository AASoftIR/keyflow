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
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  return dbPromise;
}

async function tx(storeName, mode, fn) {
  const db=await openDb();
  if(!db) return fn(null);
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(storeName,mode);
    const store=transaction.objectStore(storeName);
    let result;
    try { result=fn(store); } catch(e){ reject(e); return; }
    transaction.oncomplete=()=>resolve(result);
    transaction.onerror=()=>reject(transaction.error);
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
    request.onerror=()=>reject(request.error);
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

const SETTINGS_SCHEMA=6;

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
  soundVolume:0.82,
  soundProfile:'mechanical',
  reduceMotion:false,
  performanceMode:'ultra',
  autoLevel:true,
  showWeakKeyHeatmap:true,
  dailyMinutes:15,
  englishTargetWpm:55,
  persianTargetWpm:40,
  recentWindow:12,
  focusMode:false,
  provider:'openrouter',
  aiDeepReview:true,
  modelByProvider:{},
  calibration:{'en-us':{},'fa-standard':{},'fa-windows':{}}
};

export function loadSettings(){
  const stored=loadJson('keyflow.settings',{});
  const settings={...DEFAULT_SETTINGS,...stored};
  const oldSchema=Number(stored.settingsSchema)||0;
  if(oldSchema<SETTINGS_SCHEMA){
    settings.settingsSchema=SETTINGS_SCHEMA;
    // Preserve explicit on/off choices from 2.1.9+, but lift the old quiet
    // stock volume so the coach is clearly audible on WebKitGTK.
    if(oldSchema<3){ settings.soundEnabled=true; settings.keySounds=true; }
    if(!Number.isFinite(Number(stored.soundVolume))) settings.soundVolume=0.82;
    if(!['mechanical','soft','minimal','playful'].includes(stored.soundProfile)) settings.soundProfile='mechanical';
    saveJson('keyflow.settings',settings);
  }
  return settings;
}
export function saveSettings(settings){ saveJson('keyflow.settings',settings); }

export function getSeenState(){ return loadJson('keyflow.seen',{}); }
export function saveSeenState(state){ saveJson('keyflow.seen',state); }

export function saveProviderConfig(providerId,config){
  const all=loadJson('keyflow.providers',{});
  const {apiKey,...safe}=config;
  all[providerId]=safe;
  saveJson('keyflow.providers',all);
  if(apiKey) sessionStorage.setItem(`keyflow.key.${providerId}`,apiKey);
}
export function loadProviderConfig(providerId){
  const all=loadJson('keyflow.providers',{});
  return {...(all[providerId]||{}),apiKey:sessionStorage.getItem(`keyflow.key.${providerId}`)||''};
}
export function clearProviderKey(providerId){ sessionStorage.removeItem(`keyflow.key.${providerId}`); }

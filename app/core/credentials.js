import {invoke} from '@tauri-apps/api/core';
const native=()=>typeof window!=='undefined' && !!window.__TAURI_INTERNALS__;
const cache=new Map();
const safeId=id=>/^[a-z0-9_-]{1,48}$/i.test(id);
export function credentialStorageMode(){return native()?'KWallet / Secret Service (persistent)':'browser session only';}
export async function getCredential(id){
  if(!safeId(id))throw new Error('Invalid provider');
  if(cache.has(id))return cache.get(id);
  const value=native() ? await invoke('credential_get',{provider:id}) : (globalThis.sessionStorage?.getItem(`keyflow.key.${id}`)||'');
  cache.set(id,value||'');return value||'';
}
export async function setCredential(id,secret){
  if(!safeId(id))throw new Error('Invalid provider');
  if(!secret)throw new Error('Cannot save an empty credential. Use Clear key.');
  if(native())await invoke('credential_set',{provider:id,secret});
  else globalThis.sessionStorage?.setItem(`keyflow.key.${id}`,secret);
  cache.set(id,secret);return credentialStorageMode();
}
export async function removeCredential(id){
  if(!safeId(id))throw new Error('Invalid provider');
  if(native())await invoke('credential_clear',{provider:id});
  else globalThis.sessionStorage?.removeItem(`keyflow.key.${id}`);
  cache.delete(id);
}

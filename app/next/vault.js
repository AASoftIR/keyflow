import {DEFAULT_SETTINGS} from '../core/storage.js';
export const BACKUP_SCHEMA=3;
export const VAULT_STORAGE_KEYS=['keyflow.seen','keyflow.saved-passages','keyflow.progression','keyflow.review','keyflow.circuit','keyflow.checkpoint'];
export function safeSettings(input){
  const result={};
  for(const key of Object.keys(DEFAULT_SETTINGS)){
    if(['aiProxyUrl'].includes(key))continue; // proxies may embed passwords
    if(Object.hasOwn(input||{},key))result[key]=input[key];
  }
  return result;
}
export function createBackup({settings,sessions,texts,local}){
  const preferences={};for(const key of VAULT_STORAGE_KEYS)if(Object.hasOwn(local||{},key))preferences[key]=local[key];
  return {app:'keyflow',schema:BACKUP_SCHEMA,exportedAt:new Date().toISOString(),settings:safeSettings(settings),sessions,texts,preferences,omitted:['API keys / wallet credentials','provider connection settings','proxy URL']};
}
export function validateBackup(payload){
  if(!payload || payload.app!=='keyflow'||payload.schema!==BACKUP_SCHEMA)throw Error('Unsupported KeyFlow backup format. Use a KeyFlow v3 Data Vault export.');
  if(!Array.isArray(payload.sessions)||!Array.isArray(payload.texts))throw Error('Backup is missing sessions or texts.');
  if(payload.sessions.length>50000||payload.texts.length>10000)throw Error('Backup exceeds import safety limits.');
  for(const [items,kind] of [[payload.sessions,'session'],[payload.texts,'text']]){
    if(items.some(x=>!x||typeof x!=='object'||typeof x.id!=='string'||!x.id||x.id.length>180))throw Error(`Invalid ${kind} record.`);
  }
  return {settings:safeSettings(payload.settings),sessions:payload.sessions,texts:payload.texts,preferences:payload.preferences||{}};
}

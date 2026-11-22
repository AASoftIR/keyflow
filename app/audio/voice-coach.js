/** Optional, on-device speech guidance. Never send user text to a network
 * service: a voice must explicitly advertise localService=true. Not all
 * WebKitGTK installations ship a local synthesizer, so no voice is a normal
 * and fully supported state. This module does no work during initialization. */
const MODES=new Set(['off','mistakes','milestones','all']);
let config={mode:'off',voiceId:'',rate:1,volume:.55};
let lastSpoken=new Map(),pending=0,active=false;

function synthesis(){return globalThis.speechSynthesis||null;}
export function localVoices(){
  try{return (synthesis()?.getVoices?.()||[]).filter(v=>v?.localService===true && typeof v.voiceURI==='string');}
  catch{return [];}
}
export function voiceStatus(){
  const voices=localVoices();
  return {supported:!!synthesis()&&typeof globalThis.SpeechSynthesisUtterance==='function',localCount:voices.length,
    available:voices.length>0,mode:config.mode};
}
export function configureVoiceCoach(options={}){
  const next={mode:options.mode,voiceId:options.voiceId,rate:options.rate,volume:options.volume};
  const mode=MODES.has(next.mode)?next.mode:'off';
  if(mode==='off')stopVoiceCoach();
  config={mode,voiceId:typeof next.voiceId==='string'?next.voiceId.slice(0,256):'',
    rate:Number.isFinite(Number(next.rate))?Math.max(.7,Math.min(1.35,Number(next.rate))):1,
    volume:Number.isFinite(Number(next.volume))?Math.max(0,Math.min(1,Number(next.volume))):.55};
  return voiceStatus();
}
function allowed(kind){return config.mode==='all'||config.mode===kind||kind==='complete'&&config.mode==='milestones';}
export function stopVoiceCoach(){
  if(pending){clearTimeout(pending);pending=0;}
  if(active){try{synthesis()?.cancel?.();}catch{}active=false;}
}
/** Schedule speech away from the keyboard event. Errors are intentionally
 * swallowed: accessibility audio must never stall or crash typing. */
export function announceVoice(kind,phrase,{force=false,language=''}={}){
  if(!force&&!allowed(kind))return false;
  const synth=synthesis(),voices=localVoices();
  if(!synth||!voices.length||typeof globalThis.SpeechSynthesisUtterance!=='function')return false;
  const now=Date.now(),cooldown=kind==='mistakes'?4500:kind==='milestones'?1800:500;
  if(!force&&now-(lastSpoken.get(kind)||0)<cooldown)return false;
  const text=String(phrase||'').trim().slice(0,90);if(!text)return false;
  const preferredLanguage=String(language).toLowerCase().split('-')[0];
  const voice=voices.find(v=>v.voiceURI===config.voiceId)||(preferredLanguage?voices.find(v=>String(v.lang||'').toLowerCase().startsWith(preferredLanguage)):null)||voices[0];
  lastSpoken.set(kind,now);
  if(pending)clearTimeout(pending);
  pending=setTimeout(()=>{
    pending=0;
    try{
      if(active)synth.cancel();
      const utterance=new globalThis.SpeechSynthesisUtterance(text);
      utterance.voice=voice;utterance.lang=voice.lang||'en-US';utterance.rate=config.rate;utterance.volume=config.volume;
      utterance.onend=()=>{active=false;};utterance.onerror=()=>{active=false;};
      active=true;synth.speak(utterance);
    }catch{active=false;}
  },90);
  return true;
}
export function resetVoiceCooldowns(){lastSpoken=new Map();}

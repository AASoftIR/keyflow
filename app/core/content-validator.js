import { sanitizePracticeText, scriptStats, PERSIAN_DIACRITICS_RE } from './normalization.js';
import { keyboardSafe } from './layouts.js';

export function validatePracticeContent(raw,{language='en',layoutId,calibration={},allowDiacritics=false,minLength=90,maxLength=2200}={}){
  const text=sanitizePracticeText(raw,{language,allowDiacritics});
  const issues=[];
  if(text.length<minLength) issues.push(`Text is too short (${text.length}/${minLength}).`);
  if(text.length>maxLength) issues.push(`Text is too long (${text.length}/${maxLength}).`);
  const scripts=scriptStats(text);
  if(language==='fa' && scripts.letters>8 && scripts.persianRatio<0.96) issues.push(`Persian purity is ${(scripts.persianRatio*100).toFixed(1)}%; expected at least 96%.`);
  if(language==='en' && scripts.letters>8 && scripts.latinRatio<0.98) issues.push(`English purity is ${(scripts.latinRatio*100).toFixed(1)}%; expected at least 98%.`);
  if(language==='fa' && !allowDiacritics && new RegExp(PERSIAN_DIACRITICS_RE.source,'u').test(text)) issues.push('Persian diacritics are disabled but the text still contains them.');
  const unsupported=layoutId ? keyboardSafe(text,layoutId,calibration) : [];
  if(unsupported.length) issues.push(`Unmapped characters for this keyboard: ${unsupported.slice(0,12).join(' ')}`);
  const repeated=(text.match(/(.{12,40})\1{2,}/u)||[])[1];
  if(repeated) issues.push('The text contains a suspicious repeated phrase.');
  const sentences=text.split(/[.!؟?]+/u).map(x=>x.trim()).filter(Boolean);
  if(sentences.some(s=>s.length>420)) issues.push('At least one sentence is too long for a clean typing drill.');
  return {ok:issues.length===0,text,issues,unsupported,scripts,health:Math.max(0,100-issues.length*18-unsupported.length*2)};
}

export function parseGeneratedJson(value){
  if(typeof value==='object' && value) return value;
  const raw=String(value||'').trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  try{return JSON.parse(raw);}catch{}
  const start=raw.indexOf('{'), end=raw.lastIndexOf('}');
  if(start>=0 && end>start){ try{return JSON.parse(raw.slice(start,end+1));}catch{} }
  throw new Error('The model did not return valid JSON.');
}

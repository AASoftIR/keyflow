/** Durable, credential-free AI practice inbox.
 * A generated passage is never treated as completed simply because it was
 * previewed, saved, opened, or abandoned. The pending snapshot is intentionally
 * small so an interrupted app start can recover it before IndexedDB opens.
 */
export const PENDING_AI_KEY='keyflow.ai.pending.v1';
const MAX_CHARS=8000;
const MAX_AGE_MS=1000*60*60*24*90;

export function normalizeAiDraft(raw){
  if(!raw || typeof raw!=='object' || raw.source!=='ai')return null;
  const id=String(raw.id||'').trim();
  const language=raw.language==='fa'?'fa':raw.language==='en'?'en':null;
  const text=String(raw.text||'').trim();
  if(!/^ai-[a-zA-Z0-9-]{8,90}$/.test(id) || !language || text.length<20 || text.length>MAX_CHARS)return null;
  const level=Math.max(1,Math.min(5,Math.round(Number(raw.level)||3)));
  return {id,source:'ai',language,level,text,title:String(raw.title||'AI practice').slice(0,160),
    createdAt:Number(raw.createdAt)||Date.now(),provider:String(raw.provider||'').slice(0,50),
    model:String(raw.model||'').slice(0,180),tags:Array.isArray(raw.tags)?raw.tags.filter(x=>typeof x==='string').slice(0,8):['ai']};
}

export function getPendingAiDraft(storage=globalThis.localStorage,{now=Date.now()}={}){
  try{
    const raw=storage?.getItem(PENDING_AI_KEY);if(!raw)return null;
    const value=normalizeAiDraft(JSON.parse(raw));
    if(!value || value.createdAt>now+86400000 || now-value.createdAt>MAX_AGE_MS)return null;
    return value;
  }catch{return null;}
}
export function stagePendingAiDraft(draft,storage=globalThis.localStorage){
  const safe=normalizeAiDraft(draft);
  if(!safe)throw new Error('The generated passage is invalid and cannot be saved.');
  try{storage.setItem(PENDING_AI_KEY,JSON.stringify(safe));}
  catch(error){throw new Error('Could not save the pending AI passage for restart recovery: '+error.message);}
  return safe;
}
export function discardPendingAiDraft(storage=globalThis.localStorage){
  try{storage.removeItem(PENDING_AI_KEY);return true;}catch{return false;}
}
/** Clear only for the matching fully completed passage after session persistence.
 * Sprint endings, previews, partial attempts and unrelated passages retain it. */
export function clearPendingAiDraftOnCompletion(session,storage=globalThis.localStorage){
  const pending=getPendingAiDraft(storage);if(!pending)return false;
  if(session?.completionReason!=='passage' || Number(session?.completedChars)<Number(session?.textLength))return false;
  if(String(session?.textId)!==pending.id && !(session?.sourceIds||[]).includes(pending.id))return false;
  return discardPendingAiDraft(storage);
}
/** Persist in the database FIRST. Never navigate to practice after a failed
 * write. A small local snapshot is used to prioritize an unfinished passage
 * on cold start, and the Library remains the source of saved text records. */
export async function persistAiDraft(draft,{save,storage=globalThis.localStorage}={}){
  const safe=normalizeAiDraft(draft);
  if(!safe)throw new Error('AI passage is invalid.');
  if(typeof save!=='function')throw new Error('Text storage is not configured.');
  await save({...draft,...safe});
  // The full passage already lives in IndexedDB. If localStorage is disabled,
  // return an explicit warning instead of claiming restart recovery exists.
  let queued=true,warning='';
  try{stagePendingAiDraft(safe,storage);}catch(error){queued=false;warning=error.message;}
  return {draft:{...draft,...safe},queued,warning};
}

import { providerChat } from './providers.js';
import { parseGeneratedJson, validatePracticeContent } from '../core/content-validator.js';
import { sanitizePracticeText } from '../core/normalization.js';

const lengthRanges={
  short:{label:'350-500',min:320,max:620},
  medium:{label:'600-900',min:540,max:1050},
  long:{label:'950-1400',min:850,max:1600},
  endurance:{label:'1500-2200',min:1350,max:2400}
};

const formatInstruction={
  story:'Write a coherent short story with a clear beginning, development, and ending.',
  practical:'Write useful practical prose with connected ideas and concrete examples.',
  dialogue:'Write a natural dialogue with short speaker turns, but avoid exotic punctuation.',
  essay:'Write a compact explanatory essay with one central idea and logical progression.'
};

function tokenize(text){return String(text||'').toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu,' ').split(/\s+/).filter(Boolean);}
function ngrams(tokens,n=3){const set=new Set();for(let i=0;i+n<=tokens.length;i++)set.add(tokens.slice(i,i+n).join(' '));return set;}
export function similarityScore(a,b){
  const A=ngrams(tokenize(a)),B=ngrams(tokenize(b));
  if(!A.size||!B.size)return 0;let overlap=0;for(const x of A)if(B.has(x))overlap++;
  return overlap/Math.max(1,Math.min(A.size,B.size));
}

export function buildGenerationPrompt({language='en',level=3,length='medium',topic='',weakCharacters=[],allowDiacritics=false,layoutId,format='practical'}){
  const range=lengthRanges[length]||lengthRanges.medium;
  const weak=weakCharacters.filter(Boolean).slice(0,12).join(' ');
  const common=`Return exactly one JSON object with keys: title, text, language, level, tags. No Markdown fences. The text is for touch-typing practice, not a language lesson. Target length: ${range.label} characters; do not stop early. Difficulty level: ${level}/5. Topic: ${topic||'useful everyday life'}. ${formatInstruction[format]||formatInstruction.practical} ${weak?`Naturally increase useful occurrences of these weak characters or transitions without making the prose strange: ${weak}.`:''} Avoid repeating the same sentence structure or paragraph from common typing-test corpora.`;
  if(language==='fa'){
    return `${common}\nWrite entirely in modern, natural Persian (fa-IR). Use correct Persian verbs, tense agreement, natural نیم فاصله, coherent meaning, and a beginning-to-end idea that makes sense. Do not insert English words, transliterations, Arabic prose, random named entities, or nonsense just to hit weak characters. Use Persian ی and ک, not Arabic ي and ك. ${allowDiacritics?'Diacritics may be used sparingly only when linguistically necessary.':'Do not use فتحه، کسره، ضمه، تنوین، تشدید or other Arabic diacritics.'} Use ordinary punctuation that a Persian keyboard can type. Avoid fake facts. Preserve causality and verb tense consistently. language must be "fa".`;
  }
  return `${common}\nWrite entirely in natural contemporary English. Keep grammar, tense, subject-verb agreement, and story continuity correct. Do not inject Persian/Arabic words or random symbols. Avoid awkward word salad created only to repeat weak keys. Use normal keyboard punctuation. Avoid fake factual claims; if the topic is factual, keep it general and accurate. language must be "en".`;
}

export function parseAiDraft(raw){
  try{return parseGeneratedJson(raw);}catch(error){
    const value=String(raw||'').trim().replace(/^```(?:text|markdown)?\s*/i,'').replace(/```$/,'').trim();
    if(value.length<100)throw error;
    const lines=value.split(/\r?\n/).filter(Boolean);
    const hasHeading=/^(?:title|عنوان)\s*[:：-]\s*/i.test(lines[0]||'');
    const title=hasHeading?lines.shift().replace(/^(?:title|عنوان)\s*[:：-]\s*/i,'').trim():'AI practice text';
    const text=lines.join('\n').replace(/^(?:text|متن)\s*[:：-]\s*/i,'').trim();
    if(!text)throw error;
    return {title,text};
  }
}

function messagesForPrompt(prompt){
  return [
    {role:'system',content:'You create high-quality, long-form typing-practice passages. Semantic coherence, natural language, length compliance, and diversity are mandatory. Follow the requested JSON schema exactly.'},
    {role:'user',content:prompt}
  ];
}

function duplicateAgainst(candidate,references=[]){
  let best=0;
  for(const ref of references.slice(-80)) best=Math.max(best,similarityScore(candidate,typeof ref==='string'?ref:ref?.text||''));
  return best;
}

async function deepReviewCandidate(providerId,config,model,candidate,options,calibration,signal=null){
  if(options.deepReview===false)return candidate;
  if(signal?.aborted)throw Object.assign(new Error('AI generation cancelled.'),{code:'ABORTED'});
  const range=lengthRanges[options.length]||lengthRanges.medium;
  const languageLabel=options.language==='fa'?'Persian (fa-IR)':'English';
  const messages=[
    {role:'system',content:`You are a strict ${languageLabel} copy editor for a touch-typing trainer. Fix grammar, verb agreement, tense continuity, unnatural word choice, contradictions, repetition, and broken story causality. Preserve length: never shorten below ${range.min} characters. Return JSON only with the same keys.`},
    {role:'user',content:`Review this draft as real prose, not as token output. Preserve its topic and approximate length. Remove foreign-language intrusions and meaningless sentences. ${options.language==='fa'?'Use Persian ی and ک and natural modern Iranian Persian.':'Use natural contemporary English.'} Return one corrected JSON object only:\n${JSON.stringify({title:candidate.title,text:candidate.text,language:candidate.language,level:candidate.level,tags:candidate.tags})}`}
  ];
  try{
    const response=await providerChat(providerId,config,model,messages,{retries:0,maxTokens:options.aiTokenBudget,reasoningMode:options.aiReasoningMode,signal});
    if(signal?.aborted)throw Object.assign(new Error('AI generation cancelled.'),{code:'ABORTED'});
    const parsed=parseAiDraft(response.text);if(!parsed?.text)return candidate;
    const clean=sanitizePracticeText(parsed.text,{language:options.language,allowDiacritics:options.allowDiacritics});
    const validation=validatePracticeContent(clean,{language:options.language,layoutId:options.layoutId,calibration,allowDiacritics:options.allowDiacritics,minLength:range.min,maxLength:range.max});
    const duplicate=duplicateAgainst(validation.text,options.avoidTexts||[]);
    if(!validation.ok||duplicate>.55)return candidate;
    return {...candidate,title:String(parsed.title||candidate.title).trim(),text:validation.text,tags:Array.isArray(parsed.tags)?parsed.tags.slice(0,8):candidate.tags,health:validation.health,validation,deepReviewed:true,duplicateScore:duplicate};
  }catch(error){if(signal?.aborted||error?.code==='ABORTED')throw Object.assign(new Error('AI generation cancelled.'),{code:'ABORTED'});return candidate;}
}

export function buildPortablePrompt(options){
  return `You are a professional writing assistant. ${buildGenerationPrompt(options)}\nEnsure coherent sentences and a complete narrative. If you cannot return JSON, return a title line followed by the practice text. Do not truncate. The user will paste your output into Keyflow's Library.`;
}

/** Bounded generation planner. Unlike the old 3 × 3 loop, this issues at most
 * maxRequests model calls before optional copyediting, and records what failed.
 * A reasoning-only `finish=length` gets a single specific recovery attempt. */
export async function generatePracticeText({providerId,config,model,fallbackModels=[],options,calibration={},chat=providerChat,onEvent=()=>{},signal=null}){
  const prompt=buildGenerationPrompt(options),range=lengthRanges[options.length]||lengthRanges.medium;
  const baseTokens=Math.max(2048,Math.min(16000,Number(options.aiTokenBudget)||8192));
  const baseReasoning=options.aiReasoningMode||'low';
  const preset=['speed','balanced','quality'].includes(options.aiPreset)?options.aiPreset:'balanced';
  const maxRequests={speed:2,balanced:4,quality:6}[preset];
  const models=[model,...fallbackModels].filter((x,i,a)=>x&&a.indexOf(x)===i).slice(0,3);
  const trace=[];let calls=0,lastError;
  // An upstream error may echo headers or prompts; never show the credential
  // in diagnostics, even if a proxy mistakenly reflects it in an error body.
  const scrub=value=>{const raw=String(value??'');const key=String(config?.apiKey||'');return (key?raw.split(key).join('[REDACTED]'):raw).slice(0,180);};
  const emit=event=>{try{onEvent({...event,requests:calls,maxRequests});}catch{}};
  for(const activeModel of models){
    let messages=messagesForPrompt(prompt);
    let emptyRecovery=false,qualityRepair=false;
    for(let attempt=0;attempt<2 && calls<maxRequests;attempt++){
      if(signal?.aborted)throw Object.assign(new Error('AI generation cancelled.'),{code:'ABORTED'});
      const tokenBudget=emptyRecovery?Math.min(16000,Math.max(baseTokens+2048,Math.ceil(baseTokens*1.5))):baseTokens;
      const reasoningMode=emptyRecovery?(baseReasoning==='none'?'none':'minimal'):baseReasoning;
      calls++;
      emit({phase:'request',model:activeModel,attempt:attempt+1});
      const started=performance.now();
      try{
        const response=await chat(providerId,config,activeModel,messages,{retries:0,maxTokens:tokenBudget,reasoningMode,signal});
        if(signal?.aborted)throw Object.assign(new Error('AI generation cancelled.'),{code:'ABORTED'});
        const parsed=parseAiDraft(response.text);
        if(!parsed?.text)throw new Error('Generation response is missing a text field.');
        const clean=sanitizePracticeText(parsed.text,{language:options.language,allowDiacritics:options.allowDiacritics});
        const validation=validatePracticeContent(clean,{language:options.language,layoutId:options.layoutId,calibration,
          allowDiacritics:options.allowDiacritics,minLength:range.min,maxLength:range.max});
        const languageOk=String(parsed.language||options.language).toLowerCase().startsWith(options.language);
        if(!languageOk)validation.issues.unshift(`Wrong language label: ${parsed.language}.`);
        const duplicate=duplicateAgainst(validation.text,options.avoidTexts||[]);
        if(duplicate>.55)validation.issues.unshift(`Duplicate content (${Math.round(duplicate*100)}% overlap).`);
        if(validation.ok && !validation.issues.length){
          const candidate={id:`ai-${crypto.randomUUID()}`,title:String(parsed.title||'AI practice').trim(),text:validation.text,
            language:options.language,level:Number(options.level)||3,tags:Array.isArray(parsed.tags)?parsed.tags.slice(0,8):['AI'],
            source:'ai',createdAt:Date.now(),provider:providerId,model:activeModel,health:validation.health,validation,
            deepReviewed:false,duplicateScore:duplicate,diagnostics:{requests:calls,trace:[...trace]}};
          emit({phase:'validated',model:activeModel,health:candidate.health});
          // Deep copyediting can cost another full completion and is disabled
          // in Speed mode. Failure to review must not discard a valid passage.
          return preset==='speed'?candidate:deepReviewCandidate(providerId,config,activeModel,candidate,
            {...options,deepReview:options.deepReview!==false && preset==='quality'},calibration,signal);
        }
        lastError=new Error(validation.issues.join('; ')||'Quality checks did not pass.');
        trace.push({model:activeModel,kind:'quality',durationMs:Math.round(performance.now()-started),message:scrub(lastError.message)});
        emit({phase:'quality-repair',model:activeModel,issues:validation.issues.slice(0,3)});
        if(qualityRepair)break;
        qualityRepair=true;
        messages=[...messages,{role:'assistant',content:response.text.slice(0,12000)},
          {role:'user',content:`Repair this passage. Keep length between ${range.min} and ${range.max} characters. Fix: ${validation.issues.slice(0,6).join('; ')}. Return one JSON object only.`}];
      }catch(error){
        lastError=error;
        const kind=error.code==='EMPTY_COMPLETION'?'empty':Number(error.status)===401||Number(error.status)===402||Number(error.status)===403?'account':
          Number(error.status)>=400?'http':'content';
        trace.push({model:activeModel,kind,durationMs:Math.round(performance.now()-started),message:scrub(error.message)});
        emit({phase:'failure',model:activeModel,kind,detail:scrub(error.message).slice(0,150)});
        if(error?.code==='ABORTED'||signal?.aborted)throw Object.assign(new Error('AI generation cancelled.'),{code:'ABORTED'});
        if([401,402,403].includes(Number(error.status))){const account=new Error(`AI account problem (HTTP ${error.status}): ${scrub(error.message)}`);account.status=error.status;account.diagnostics={requests:calls,maxRequests,trace:[...trace]};throw account;}
        if(error.code==='EMPTY_COMPLETION'&&error.finishReason==='length'&&!emptyRecovery){emptyRecovery=true;continue;}
        // API errors are not repaired with more prose; switch model.
        if(Number(error.status)>=400 || error.code==='EMPTY_COMPLETION')break;
        if(qualityRepair)break;
        qualityRepair=true;
        messages=[...messages,{role:'user',content:`The previous reply was not a valid passage: ${scrub(error.message)}. Return full-length JSON with a readable text field.`}];
      }
    }
  }
  const details=trace.map(x=>`${x.model} [${x.kind}]: ${x.message}`).slice(-4).join(' | ');
  const error=new Error(`AI generation failed after ${calls}/${maxRequests} bounded requests. ${details||lastError?.message||'No usable response'}`);
  error.diagnostics={requests:calls,maxRequests,trace};
  throw error;
}

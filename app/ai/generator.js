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

async function deepReviewCandidate(providerId,config,model,candidate,options,calibration){
  if(options.deepReview===false)return candidate;
  const range=lengthRanges[options.length]||lengthRanges.medium;
  const languageLabel=options.language==='fa'?'Persian (fa-IR)':'English';
  const messages=[
    {role:'system',content:`You are a strict ${languageLabel} copy editor for a touch-typing trainer. Fix grammar, verb agreement, tense continuity, unnatural word choice, contradictions, repetition, and broken story causality. Preserve length: never shorten below ${range.min} characters. Return JSON only with the same keys.`},
    {role:'user',content:`Review this draft as real prose, not as token output. Preserve its topic and approximate length. Remove foreign-language intrusions and meaningless sentences. ${options.language==='fa'?'Use Persian ی and ک and natural modern Iranian Persian.':'Use natural contemporary English.'} Return one corrected JSON object only:\n${JSON.stringify({title:candidate.title,text:candidate.text,language:candidate.language,level:candidate.level,tags:candidate.tags})}`}
  ];
  try{
    const response=await providerChat(providerId,config,model,messages,{retries:1});
    const parsed=parseGeneratedJson(response.text);if(!parsed?.text)return candidate;
    const clean=sanitizePracticeText(parsed.text,{language:options.language,allowDiacritics:options.allowDiacritics});
    const validation=validatePracticeContent(clean,{language:options.language,layoutId:options.layoutId,calibration,allowDiacritics:options.allowDiacritics,minLength:range.min,maxLength:range.max});
    const duplicate=duplicateAgainst(validation.text,options.avoidTexts||[]);
    if(!validation.ok||duplicate>.55)return candidate;
    return {...candidate,title:String(parsed.title||candidate.title).trim(),text:validation.text,tags:Array.isArray(parsed.tags)?parsed.tags.slice(0,8):candidate.tags,health:validation.health,validation,deepReviewed:true,duplicateScore:duplicate};
  }catch{return candidate;}
}

export async function generatePracticeText({providerId,config,model,fallbackModels=[],options,calibration={},chat=providerChat}){
  const prompt=buildGenerationPrompt(options);const range=lengthRanges[options.length]||lengthRanges.medium;
  let lastError;const models=[model,...fallbackModels].filter((x,i,a)=>x&&a.indexOf(x)===i).slice(0,3);
  for(const activeModel of models){
    let messages=messagesForPrompt(prompt);
    for(let attempt=1;attempt<=2;attempt++){
      try{
        const response=await chat(providerId,config,activeModel,messages,{retries:2});
        const parsed=parseGeneratedJson(response.text);if(!parsed?.text)throw new Error('JSON is missing the text field.');
        const clean=sanitizePracticeText(parsed.text,{language:options.language,allowDiacritics:options.allowDiacritics});
        const validation=validatePracticeContent(clean,{language:options.language,layoutId:options.layoutId,calibration,allowDiacritics:options.allowDiacritics,minLength:range.min,maxLength:range.max});
        const languageOk=String(parsed.language||options.language).toLowerCase().startsWith(options.language);
        if(!languageOk)validation.issues.unshift(`Model labeled the result as ${parsed.language}, expected ${options.language}.`);
        const duplicate=duplicateAgainst(validation.text,options.avoidTexts||[]);
        if(duplicate>.55)validation.issues.unshift(`Draft is too similar to an existing passage (${Math.round(duplicate*100)}% phrase overlap).`);
        if(validation.issues.length===0 && validation.ok){
          const candidate={id:`ai-${crypto.randomUUID()}`,title:String(parsed.title||'AI practice').trim(),text:validation.text,language:options.language,level:Number(parsed.level)||Number(options.level),tags:Array.isArray(parsed.tags)?parsed.tags.slice(0,8):['AI'],source:'ai',createdAt:Date.now(),provider:providerId,model:activeModel,health:validation.health,validation,deepReviewed:false,duplicateScore:duplicate};
          return deepReviewCandidate(providerId,config,activeModel,candidate,options,calibration);
        }
        lastError=new Error(validation.issues.join(' '));
        messages=[...messages,{role:'assistant',content:response.text},{role:'user',content:`Repair the JSON. Keep the same topic, satisfy the requested length, and fix every issue below. Return JSON only:\n- ${validation.issues.join('\n- ')}\nDo not explain the repair.`}];
      }catch(error){
        lastError=error;
        if(error?.status===401||error?.status===403||error?.status===404)break;
        messages=[...messages,{role:'user',content:`The last attempt failed validation or parsing: ${String(error.message).slice(0,320)}. Return a fresh valid JSON object only, at the full requested length.`}];
      }
    }
  }
  throw new Error(`AI content failed after model fallback and quality repair: ${lastError?.message||'unknown error'}`);
}

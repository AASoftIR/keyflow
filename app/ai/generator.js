import { providerChat } from './providers.js';
import { parseGeneratedJson, validatePracticeContent } from '../core/content-validator.js';
import { sanitizePracticeText } from '../core/normalization.js';

const lengths={short:'120-220',medium:'260-420',long:'500-760'};

export function buildGenerationPrompt({language='en',level=3,length='medium',topic='',weakCharacters=[],allowDiacritics=false,layoutId}){
  const weak=weakCharacters.filter(Boolean).slice(0,12).join(' ');
  const common=`Return exactly one JSON object with keys: title, text, language, level, tags. No Markdown fences. The text is for touch-typing practice, not a language lesson. Target length: ${lengths[length]||lengths.medium} characters. Difficulty level: ${level}/5. Topic: ${topic||'useful everyday life'}. ${weak?`Naturally increase useful occurrences of these weak characters or transitions without making the prose strange: ${weak}.`:''}`;
  if(language==='fa'){
    return `${common}\nWrite entirely in modern, natural Persian (fa-IR). Use correct Persian verbs, tense agreement, نیم فاصله only where natural, coherent meaning, and a beginning-to-end idea that makes sense. Do not insert English words, transliterations, Arabic prose, random named entities, or nonsense just to hit weak characters. Use Persian ی and ک, not Arabic ي and ك. ${allowDiacritics?'Diacritics may be used sparingly only when linguistically necessary.':'Do not use فتحه، کسره، ضمه، تنوین، تشدید or other Arabic diacritics.'} Use ordinary punctuation that a Persian keyboard can type. Avoid fake facts. If writing a story, preserve characters, causality, and verb tense consistently. language must be "fa".`;
  }
  return `${common}\nWrite entirely in natural contemporary English. Keep grammar, tense, subject-verb agreement, and story continuity correct. Do not inject Persian/Arabic words or random symbols. Avoid awkward word salad created only to repeat weak keys. Use normal keyboard punctuation. Avoid fake factual claims; if the topic is factual, keep it general and accurate. language must be "en".`;
}

function messagesForPrompt(prompt){
  return [
    {role:'system',content:'You create high-quality typing-practice passages. Semantic coherence and natural language are mandatory. Follow the requested JSON schema exactly.'},
    {role:'user',content:prompt}
  ];
}

async function deepReviewCandidate(providerId,config,model,candidate,options,calibration){
  if(options.deepReview===false) return candidate;
  const languageLabel=options.language==='fa'?'Persian (fa-IR)':'English';
  const messages=[
    {role:'system',content:`You are a strict ${languageLabel} copy editor for a touch-typing trainer. Fix grammar, verb agreement, tense continuity, unnatural word choice, contradictions, and broken story causality. Do not make the prose more ornate. Return JSON only with the same keys.`},
    {role:'user',content:`Review this draft as real prose, not as token output. Preserve its topic and approximate length. Remove foreign-language intrusions and meaningless sentences. ${options.language==='fa'?'Use Persian ی and ک and natural modern Iranian Persian.':'Use natural contemporary English.'} Return one corrected JSON object only:
${JSON.stringify({title:candidate.title,text:candidate.text,language:candidate.language,level:candidate.level,tags:candidate.tags})}`}
  ];
  try{
    const response=await providerChat(providerId,config,model,messages);
    const parsed=parseGeneratedJson(response.text);
    if(!parsed?.text) return candidate;
    const clean=sanitizePracticeText(parsed.text,{language:options.language,allowDiacritics:options.allowDiacritics});
    const validation=validatePracticeContent(clean,{language:options.language,layoutId:options.layoutId,calibration,allowDiacritics:options.allowDiacritics,minLength:70,maxLength:1600});
    if(!validation.ok) return candidate;
    return {...candidate,title:String(parsed.title||candidate.title).trim(),text:validation.text,tags:Array.isArray(parsed.tags)?parsed.tags.slice(0,8):candidate.tags,health:validation.health,validation,deepReviewed:true};
  }catch{
    return candidate;
  }
}

export async function generatePracticeText({providerId,config,model,options,calibration={}}){
  const prompt=buildGenerationPrompt(options);
  let lastError;
  let messages=messagesForPrompt(prompt);
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const response=await providerChat(providerId,config,model,messages);
      const parsed=parseGeneratedJson(response.text);
      if(!parsed?.text) throw new Error('JSON is missing the text field.');
      const clean=sanitizePracticeText(parsed.text,{language:options.language,allowDiacritics:options.allowDiacritics});
      const validation=validatePracticeContent(clean,{
        language:options.language,layoutId:options.layoutId,calibration,allowDiacritics:options.allowDiacritics,minLength:70,maxLength:1600
      });
      const languageOk=String(parsed.language||options.language).toLowerCase().startsWith(options.language);
      if(!languageOk) validation.issues.unshift(`Model labeled the result as ${parsed.language}, expected ${options.language}.`);
      // Unknown punctuation can be legitimate on a profile but unsafe for a drill. Make the model repair it.
      if(validation.ok || (validation.issues.length===1 && validation.unsupported.length<=1)){
        const candidate={
          id:`ai-${crypto.randomUUID()}`,title:String(parsed.title||'AI practice').trim(),text:validation.text,
          language:options.language,level:Number(parsed.level)||Number(options.level),tags:Array.isArray(parsed.tags)?parsed.tags.slice(0,8):['AI'],
          source:'ai',createdAt:Date.now(),provider:providerId,model,health:validation.health,validation,deepReviewed:false
        };
        return deepReviewCandidate(providerId,config,model,candidate,options,calibration);
      }
      lastError=new Error(validation.issues.join(' '));
      messages=[...messages,{role:'assistant',content:response.text},{role:'user',content:`Repair the JSON. Keep the same topic but fix every issue below and return JSON only:\n- ${validation.issues.join('\n- ')}\nDo not explain the repair.`}];
    }catch(error){
      lastError=error;
      if(error?.status===401 || error?.status===403) break;
      messages=[...messages,{role:'user',content:`The last attempt failed validation or parsing: ${error.message}. Return a fresh valid JSON object only.`}];
    }
  }
  throw new Error(`AI content failed quality checks after 3 attempts: ${lastError?.message||'unknown error'}`);
}

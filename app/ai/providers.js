import { invoke } from '@tauri-apps/api/core';

const hasTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

async function httpJson(url,{method='GET',headers={},body=null,timeoutMs=45000,proxyUrl=''}={}){
  let status, raw, responseHeaders={};
  if(hasTauri()){
    const response=await invoke('http_request',{input:{url,method,headers,body:body==null?null:JSON.stringify(body),proxyUrl:proxyUrl||null,timeoutMs}});
    status=response.status; raw=response.body; responseHeaders=response.headers||{};
  } else {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{
      const res=await fetch(url,{method,headers,body:body==null?undefined:JSON.stringify(body),signal:controller.signal});
      status=res.status; raw=await res.text(); responseHeaders=Object.fromEntries(res.headers.entries());
    } finally { clearTimeout(timer); }
  }
  let data;
  try{data=raw?JSON.parse(raw):{};}catch{
    if(/^\s*(?:event:|data:)/m.test(raw||'')){
      let output='';
      for(const line of String(raw).split(/\r?\n/)){
        if(!line.startsWith('data:'))continue;
        const value=line.slice(5).trim();if(value==='[DONE]')continue;
        try{const part=JSON.parse(value);
          output+=part?.choices?.[0]?.delta?.content||part?.choices?.[0]?.text||part?.delta||part?.output_text||'';
        }catch{}
      }
      data={choices:[{message:{content:output}}]};
    }else data={raw};
  }
  if(status<200 || status>=300){
    const detail=data?.error?.message || data?.message || data?.errors?.[0]?.message || data?.raw || `HTTP ${status}`;
    const hint=/^https:\/\/inference\.dahl\.global\//i.test(url)
      ? (status===402?'Dahl key has no allocated tokens. Go to Dahl /account and allocate tokens to this key. ':status===401?'Dahl API key missing, invalid or expired. Check the saved key in Dahl /account. ':status===400 && /model/i.test(String(detail))?'Dahl model not offered. Refresh the live model catalog and select an available ID. ':'') : '';
    const err=new Error(`${hint}${detail}`); err.status=status; err.data=data; throw err;
  }
  return {data,status,headers:responseHeaders};
}

const bearer = key => key ? {Authorization:`Bearer ${key}`} : {};
const jsonHeaders = key => ({'Content-Type':'application/json',...bearer(key)});
const normalizeBase = value => String(value||'').replace(/\/+$/,'');
export function joinApiUrl(base,path){
  const root=normalizeBase(base);
  const p=String(path||'').trim();
  if(!root || !/^https?:\/\//i.test(root)) throw new Error('API base must be http(s).');
  if(/^https?:\/\//i.test(p)) throw new Error('Use a relative API path, not a second absolute URL.');
  return `${root}/${p.replace(/^\/+/, '')}`;
}

function modelItems(payload){
  const raw=payload?.data ?? payload?.result ?? payload?.models ?? payload;
  const list=Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  return list.map(item=>{
    if(typeof item==='string') return {id:item,name:item,raw:item};
    const id=item.id || item.name || item.model || item.model_id;
    return id ? {id:String(id),name:String(item.display_name||item.name||id),raw:item} : null;
  }).filter(Boolean);
}

// Providers have divergent but documentable non-stream response envelopes.
// Never mistake model discovery for an actual, usable text completion.
export function extractCompletionText(payload){
  const fragments=[];
  const push=value=>{
    if(typeof value==='string'&&value.trim())fragments.push(value);
    else if(Array.isArray(value))for(const item of value)push(item);
    else if(value && typeof value==='object'){
      if(typeof value.text==='string')push(value.text);
      else if(typeof value.content==='string'||Array.isArray(value.content))push(value.content);
      else if(typeof value.output_text==='string')push(value.output_text);
      else if(value.type==='text' && typeof value.value==='string')push(value.value);
      else if(value.type==='output_text' && typeof value.value==='string')push(value.value);
      else if(value.parts)push(value.parts);
    }
  };
  // OpenAI Chat, old completions, Responses API, Gemini native, Workers AI.
  if(Array.isArray(payload?.choices))for(const choice of payload.choices){
    push(choice?.message?.content);push(choice?.message?.refusal);push(choice?.text);push(choice?.delta?.content);
  }
  if(!fragments.length){push(payload?.data?.choices?.[0]?.message?.content);push(payload?.data?.output_text);push(payload?.output_text);push(payload?.output);push(payload?.candidates?.map(c=>c.content?.parts));push(payload?.result?.response);push(payload?.result?.text);push(payload?.response);push(payload?.text);push(payload?.content);}
  const text=fragments.join('\n').trim();
  if(text)return text;
  const finish=payload?.choices?.[0]?.finish_reason||payload?.status||payload?.candidates?.[0]?.finishReason||'unknown';
  const tokens=payload?.usage?.completion_tokens??payload?.usage?.output_tokens??'unknown';
  const reasoningTokens=payload?.usage?.completion_tokens_details?.reasoning_tokens??payload?.usage?.output_tokens_details?.reasoning_tokens;
  const reasoningInfo=Number.isFinite(Number(reasoningTokens))?`; reasoning tokens=${reasoningTokens}`:'';
  const advice=finish==='length'
    ? 'The generation budget ran out before readable text was produced. Use a lower reasoning setting, a larger limit, or a text/instruct model.'
    : 'The model did not supply readable content. Try a different text-generation model.';
  const error=new Error(`Model returned no visible text (finish=${finish}; output tokens=${tokens}${reasoningInfo}). ${advice}`);
  error.code='EMPTY_COMPLETION';error.finishReason=finish;error.reasoningTokens=reasoningTokens;error.outputTokens=tokens;throw error;
}

async function openAiModels(base,key,path='/models',extraHeaders={},transport={}){
  const {data}=await httpJson(joinApiUrl(base,path),{headers:{...bearer(key),...extraHeaders},proxyUrl:transport.proxyUrl||'',timeoutMs:transport.timeoutMs||45000});
  return modelItems(data);
}

/** Bounded adaptation to documented OpenAI-compatible API parameter changes.
 * Retry only on explicit schema rejection, never on 401/403/429 or empty outputs.
 * This prevents mistaking credential, quota, or model capability failures for
 * transport compatibility problems. */
async function postCompatibleChat(url,headers,body,{proxyUrl='',timeoutMs=90000}={}){
  let current={...body};
  for(let attempt=0;attempt<5;attempt++){
    try{return await httpJson(url,{method:'POST',headers,body:current,proxyUrl,timeoutMs});}
    catch(error){
      if(![400,422].includes(Number(error?.status)))throw error;
      const reason=String(error.message||'').toLowerCase();
      if(/reasoning|thinking|effort/.test(reason)&&Object.hasOwn(current,'reasoning') && /(?:not supported|unsupported|unrecognized|unknown|invalid|not allowed|must be|cannot|not available)/.test(reason)){
        const {reasoning,...withoutReasoning}=current;current=withoutReasoning;continue;
      }
      if(/temperature|sampling parameter|sampling value/.test(reason)&&Object.hasOwn(current,'temperature')){
        const {temperature,...withoutSampling}=current;current=withoutSampling;continue;
      }
      if(/max_completion_tokens/.test(reason)&&Object.hasOwn(current,'max_tokens')){
        const {max_tokens,...rest}=current;current={...rest,max_completion_tokens:max_tokens};continue;
      }
      if(/max_tokens/.test(reason)&&Object.hasOwn(current,'max_completion_tokens')){
        const {max_completion_tokens,...rest}=current;current={...rest,max_tokens:max_completion_tokens};continue;
      }
      throw error;
    }
  }
  throw new Error('Provider rejected the completion parameters after compatibility retries.');
}

async function openAiChat(base,key,model,messages,{chatPath='/chat/completions',extraHeaders={},bodyExtra={},proxyUrl='',timeoutMs=90000,maxTokens=4800,temperature=.55,tokenParam='max_tokens',omitTemperature=false,reasoningMode='default'}={}){
  const budget=Number.isFinite(Number(maxTokens))?Math.max(256,Math.min(16000,Math.floor(Number(maxTokens)))):4800;
  const reasoning=reasoningMode!=='default' && ['none','minimal','low','medium'].includes(reasoningMode) && model!=='openrouter/free'
    ? {reasoning:{effort:reasoningMode}}:{};
  const body={model,messages,stream:false,...(omitTemperature?{}:{temperature}),[tokenParam]:budget,...reasoning,...bodyExtra};
  const {data}=await postCompatibleChat(joinApiUrl(base,chatPath),{...jsonHeaders(key),...extraHeaders},body,{proxyUrl,timeoutMs});
  return {text:extractCompletionText(data),raw:data};
}


export function isTextCapableModel(model){
  const id=String(model?.id||'').toLowerCase(),raw=model?.raw||{};
  if(!id||/embed|rerank|whisper|tts|speech|audio-only|image-gen|image-generation|moderation|guard|transcribe|veo|flux/i.test(id))return false;
  const modalities=raw?.architecture?.output_modalities||raw?.output_modalities;
  if(Array.isArray(modalities) && !modalities.includes('text'))return false;
  const supported=raw?.supported_parameters;
  if(Array.isArray(supported)&&supported.length && !supported.includes('max_tokens') && !supported.includes('max_completion_tokens')){
    // Some routers omit parameter metadata; only reject explicit non-text tasks.
    if(raw?.architecture?.modality && !String(raw.architecture.modality).includes('text'))return false;
  }
  return true;
}

export const PROVIDERS={
  openrouter:{
    id:'openrouter',name:'OpenRouter · free models',freeLabel:'Free router + :free models',
    description:'Discovers live models and keeps only zero-price/free variants. openrouter/free is always available as the automatic free router.',
    fields:[],
    async listModels(config){
      const models=await openAiModels('https://openrouter.ai/api/v1',config.apiKey,'/models',{'HTTP-Referer':'https://keyflow.local','X-Title':'Keyflow'},config);
      const free=models.filter(m=>isTextCapableModel(m) && (m.id==='openrouter/free' || m.id.endsWith(':free') || (Number(m.raw?.pricing?.prompt??1)===0 && Number(m.raw?.pricing?.completion??1)===0)));
      if(!free.some(x=>x.id==='openrouter/free')) free.unshift({id:'openrouter/free',name:'OpenRouter Free Router',raw:{}});
      return free;
    },
    async chat(config,model,messages,options={}){return openAiChat('https://openrouter.ai/api/v1',config.apiKey,model,messages,{extraHeaders:{'HTTP-Referer':'https://keyflow.local','X-Title':'Keyflow'},proxyUrl:config.proxyUrl,timeoutMs:config.timeoutMs,tokenParam:'max_completion_tokens',omitTemperature:true,maxTokens:options.maxTokens??8192,reasoningMode:options.reasoningMode??'low'});}
  },
  dahl:{
    id:'dahl',name:'Dahl Inference · MiniMax / DeepSeek',freeLabel:'Allocated Dahl token balance required',
    description:'Public live model catalog; requests use your own bearer key with tokens allocated at inference.dahl.global/account. Start with MiniMax M2.7 when available.',
    fields:[],
    async listModels(config){
      // The live catalog is public. Never gate discovery on saved credentials.
      return (await openAiModels('https://inference.dahl.global/v1','', '/models',{},config))
        .filter(isTextCapableModel);
    },
    async chat(config,model,messages,options={}){
      if(!config.apiKey)throw new Error('Dahl API key required. Allocate tokens to the key at inference.dahl.global/account before generating.');
      // Dahl documents model/messages in the OpenAI-compatible Chat API.
      // Avoid sending OpenRouter-specific reasoning controls or temperature.
      return openAiChat('https://inference.dahl.global/v1',config.apiKey,model,messages,{
        proxyUrl:config.proxyUrl,timeoutMs:config.timeoutMs,omitTemperature:true,
        maxTokens:options.maxTokens??8192,tokenParam:'max_tokens'
      });
    }
  },
  groq:{
    id:'groq',name:'GroqCloud',freeLabel:'Free-plan rate limits',
    description:'Uses Groq\'s live /models endpoint instead of hard-coding retired model IDs.',fields:[],
    listModels:config=>openAiModels('https://api.groq.com/openai/v1',config.apiKey,'/models',{},config),
    chat:(config,model,messages)=>openAiChat('https://api.groq.com/openai/v1',config.apiKey,model,messages,{proxyUrl:config.proxyUrl,timeoutMs:config.timeoutMs})
  },
  gemini:{
    id:'gemini',name:'Google Gemini',freeLabel:'AI Studio free tier where available',
    description:'OpenAI-compatible Gemini endpoint with live model discovery.',fields:[],
    async listModels(config){
      const models=await openAiModels('https://generativelanguage.googleapis.com/v1beta/openai',config.apiKey,'/models',{},config);
      return models.filter(m=>/^gemini-/i.test(m.id) && !/embedding|image|veo|tts/i.test(m.id));
    },
    chat:(config,model,messages)=>openAiChat('https://generativelanguage.googleapis.com/v1beta/openai',config.apiKey,model,messages,{proxyUrl:config.proxyUrl,timeoutMs:config.timeoutMs,omitTemperature:true})
  },
  mistral:{
    id:'mistral',name:'Mistral',freeLabel:'Experiment/free allowance depends on account',
    description:'Discovers only chat-capable models returned for your account.',fields:[],
    async listModels(config){
      const models=await openAiModels('https://api.mistral.ai/v1',config.apiKey,'/models',{},config);
      return models.filter(m=>m.raw?.capabilities?.completion_chat !== false && !m.raw?.archived);
    },
    chat:(config,model,messages)=>openAiChat('https://api.mistral.ai/v1',config.apiKey,model,messages,{proxyUrl:config.proxyUrl,timeoutMs:config.timeoutMs})
  },
  cerebras:{
    id:'cerebras',name:'Cerebras Inference',freeLabel:'Free developer tier where enabled',
    description:'Public model discovery works even before a key is entered; generation uses your key.',fields:[],
    async listModels(config){
      try{
        const {data}=await httpJson('https://api.cerebras.ai/public/v1/models',{proxyUrl:config.proxyUrl||'',timeoutMs:config.timeoutMs||45000});
        return modelItems(data).filter(m=>!m.raw?.deprecated);
      }catch{return openAiModels('https://api.cerebras.ai/v1',config.apiKey,'/models',{},config);}
    },
    chat:(config,model,messages)=>openAiChat('https://api.cerebras.ai/v1',config.apiKey,model,messages,{proxyUrl:config.proxyUrl,timeoutMs:config.timeoutMs})
  },
  nvidia:{
    id:'nvidia',name:'NVIDIA NIM / API Catalog',freeLabel:'Free Endpoint catalog',
    description:'Uses NVIDIA\'s OpenAI-compatible API. The catalog changes frequently, so Keyflow always asks /models first.',fields:[],
    listModels:config=>openAiModels('https://integrate.api.nvidia.com/v1',config.apiKey,'/models',{},config),
    chat:(config,model,messages)=>openAiChat('https://integrate.api.nvidia.com/v1',config.apiKey,model,messages,{proxyUrl:config.proxyUrl,timeoutMs:config.timeoutMs})
  },
  cloudflare:{
    id:'cloudflare',name:'Cloudflare Workers AI',freeLabel:'10,000 Neurons/day free allocation',
    description:'Requires account ID plus a Workers AI token. Paid-only/deprecated models are hidden when metadata exposes that state.',
    fields:[{key:'accountId',label:'Cloudflare account ID',placeholder:'32-character account ID'}],
    async listModels(config){
      if(!config.accountId) throw new Error('Cloudflare account ID is required.');
      const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/ai/models/search?per_page=100&hide_experimental=true&include_deprecated=false`;
      const {data}=await httpJson(url,{headers:bearer(config.apiKey),proxyUrl:config.proxyUrl||'',timeoutMs:config.timeoutMs||45000});
      return modelItems(data).filter(m=>{
        const task=String(m.raw?.task?.name||m.raw?.task||'').toLowerCase();
        const name=String(m.id).toLowerCase();
        return (!task || task.includes('text') || task.includes('chat')) && !/embed|whisper|image|flux|rerank|speech|tts/.test(name);
      });
    },
    async chat(config,model,messages){
      if(!config.accountId) throw new Error('Cloudflare account ID is required.');
      return openAiChat(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/ai/v1`,config.apiKey,model,messages,{bodyExtra:{options:{rejectIfBusy:true}},proxyUrl:config.proxyUrl,timeoutMs:config.timeoutMs});
    }
  },
  custom:{
    id:'custom',name:'Custom OpenAI-compatible API',freeLabel:'Your endpoint',requiresKey:false,
    description:'For any OpenAI-compatible server or proxy. Configure paths and optional headers; models are never hard-coded.',
    fields:[
      {key:'baseUrl',label:'Base URL',placeholder:'https://example.com/v1'},
      {key:'modelsPath',label:'Models path',placeholder:'/models'},
      {key:'chatPath',label:'Chat path',placeholder:'/chat/completions'},
      {key:'authHeader',label:'Auth header',placeholder:'Authorization'},
      {key:'authPrefix',label:'Auth prefix',placeholder:'Bearer '},
      {key:'extraHeaders',label:'Extra headers JSON',placeholder:'{"X-App":"Keyflow"}'},
      {key:'responsePath',label:'Response text path (optional)',placeholder:'choices.0.message.content'}
    ],
    async listModels(config){
      if(!config.baseUrl) throw new Error('Custom API base URL is required.');
      const headers=customHeaders(config);
      const {data}=await httpJson(joinApiUrl(config.baseUrl,config.modelsPath||'/models'),{headers,proxyUrl:config.proxyUrl||'',timeoutMs:config.timeoutMs||45000});
      return modelItems(data);
    },
    async chat(config,model,messages){
      if(!config.baseUrl) throw new Error('Custom API base URL is required.');
      const headers={'Content-Type':'application/json',...customHeaders(config)};
      const {data}=await postCompatibleChat(joinApiUrl(config.baseUrl,config.chatPath||'/chat/completions'),headers,
        {model,messages,temperature:.55,max_tokens:4800,stream:false},
        {proxyUrl:config.proxyUrl||'',timeoutMs:config.timeoutMs||90000});
      const selected=readPath(data,config.responsePath);
      return {text:selected==null?extractCompletionText(data):extractCompletionText({output:selected}),raw:data};
    }
  }
};

function customHeaders(config){
  let extra={};
  if(config.extraHeaders){try{extra=JSON.parse(config.extraHeaders);}catch{throw new Error('Extra headers must be valid JSON.');}}
  if(config.apiKey){
    const header=config.authHeader||'Authorization';
    extra[header]=`${config.authPrefix ?? 'Bearer '}${config.apiKey}`;
  }
  return extra;
}

function readPath(obj,path){
  if(!path) return null;
  return String(path).split('.').reduce((v,key)=>v?.[key],obj) ?? null;
}

const cache=new Map();
export async function listProviderModels(providerId,config,{force=false}={}){
  const provider=PROVIDERS[providerId];
  if(!provider) throw new Error('Unknown provider.');
  // Different credentials may expose different model catalogs. Keep account-specific
  // caches separate without persisting keys. This key exists only in RAM.
  const key=providerId+':'+JSON.stringify(config);
  const hit=cache.get(key);
  if(!force && hit && Date.now()-hit.at<10*60*1000) return hit.models;
  const models=await provider.listModels(config);
  const unique=[...new Map(models.filter(isTextCapableModel).map(m=>[m.id,m])).values()].sort((a,b)=>a.name.localeCompare(b.name));
  cache.set(key,{at:Date.now(),models:unique});
  return unique;
}

const RETRYABLE=new Set([408,409,425,429,500,502,503,504]);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function providerChat(providerId,config,model,messages,{retries=2,maxTokens,reasoningMode}={}){
  const provider=PROVIDERS[providerId];
  if(!provider) throw new Error('Unknown provider.');
  if(!model) throw new Error('Select a live model first.');
  let lastError;
  for(let attempt=0;attempt<=retries;attempt++){
    try{return await provider.chat(config,model,messages,{maxTokens,reasoningMode});}catch(error){
      lastError=error;
      if(!RETRYABLE.has(Number(error?.status)) || attempt>=retries) break;
      await sleep(350*Math.pow(2,attempt));
    }
  }
  throw lastError;
}

export async function testAiTransport({proxyUrl=''}={}){
  const started=performance.now();
  const {data}=await httpJson('https://openrouter.ai/api/v1/models',{proxyUrl,timeoutMs:15000});
  const count=modelItems(data).length;
  return {ok:true,latencyMs:performance.now()-started,models:count,modelCount:count,proxy:proxyUrl||'direct'};
}

/** Prefer direct, chat/instruct-oriented models for writing. A free routing alias can
 * select a reasoning-heavy model behind the scenes, so rank it below a known
 * direct, non-thinking text model. Discovery cannot guarantee generation. */
export function modelTextScore(model){
  if(!isTextCapableModel(model))return -1e9;
  const id=String(model?.id||'').toLowerCase(),raw=model?.raw||{};
  if(!id)return -1e9;
  let score=0;
  if(/:free\b$/.test(id))score+=60;
  if(/flash|instant|fast|turbo|lite/.test(id))score+=28;
  if(/minimax-m2\.7/.test(id))score+=85;
  if(/instruct|chat/.test(id))score+=32;
  if(/mini|small|8b|7b|3b/.test(id))score+=15;
  if(/preview|experimental|exp\b/.test(id))score-=7;
  if(/(?:reasoning|thinking|deepseek-r1|\br1\b|qwq|o1-|o3-)/.test(id))score-=100;
  if(id==='openrouter/free')score-=45;
  if(/70b|120b|405b/.test(id))score-=12;
  if(Number(raw?.context_length||raw?.context_window||0)>=16000)score+=4;
  return score;
}

export function fallbackModels(models=[],selected='',limit=2){
  return [...models].filter(m=>m.id!==selected&&isTextCapableModel(m))
    .sort((a,b)=>modelTextScore(b)-modelTextScore(a)||String(a.id).localeCompare(String(b.id)))
    .slice(0,limit).map(m=>m.id);
}

export function pickRecommendedModel(models=[]){
  return [...models].filter(isTextCapableModel)
    .sort((a,b)=>modelTextScore(b)-modelTextScore(a)||String(a.id).localeCompare(String(b.id)))[0]||null;
}

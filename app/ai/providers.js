import { invoke } from '@tauri-apps/api/core';

const hasTauri = () => typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;

async function httpJson(url,{method='GET',headers={},body=null,timeoutMs=45000}={}){
  let status, raw, responseHeaders={};
  if(hasTauri()){
    const response=await invoke('http_request',{input:{url,method,headers,body:body==null?null:JSON.stringify(body)}});
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
  try{data=raw?JSON.parse(raw):{};}catch{data={raw};}
  if(status<200 || status>=300){
    const detail=data?.error?.message || data?.message || data?.errors?.[0]?.message || data?.raw || `HTTP ${status}`;
    const err=new Error(`${detail}`); err.status=status; err.data=data; throw err;
  }
  return {data,status,headers:responseHeaders};
}

const bearer = key => key ? {Authorization:`Bearer ${key}`} : {};
const jsonHeaders = key => ({'Content-Type':'application/json',...bearer(key)});
const normalizeBase = value => String(value||'').replace(/\/+$/,'');

function modelItems(payload){
  const raw=payload?.data ?? payload?.result ?? payload?.models ?? payload;
  const list=Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : [];
  return list.map(item=>{
    if(typeof item==='string') return {id:item,name:item,raw:item};
    const id=item.id || item.name || item.model || item.model_id;
    return id ? {id:String(id),name:String(item.display_name||item.name||id),raw:item} : null;
  }).filter(Boolean);
}

function openAiText(payload){
  const content=payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text ?? payload?.output_text;
  if(Array.isArray(content)) return content.map(x=>x?.text||x?.content||'').join('');
  if(typeof content==='string') return content;
  if(typeof payload?.text==='string') return payload.text;
  throw new Error('The provider returned no readable text completion.');
}

async function openAiModels(base,key,path='/models',extraHeaders={}){
  const {data}=await httpJson(`${normalizeBase(base)}${path.startsWith('/')?'':'/'}${path}`,{headers:{...bearer(key),...extraHeaders}});
  return modelItems(data);
}

async function openAiChat(base,key,model,messages,{chatPath='/chat/completions',extraHeaders={},bodyExtra={}}={}){
  const {data}=await httpJson(`${normalizeBase(base)}${chatPath.startsWith('/')?'':'/'}${chatPath}`,{
    method:'POST',headers:{...jsonHeaders(key),...extraHeaders},
    body:{model,messages,temperature:.72,max_tokens:1400,...bodyExtra}
  });
  return {text:openAiText(data),raw:data};
}

export const PROVIDERS={
  openrouter:{
    id:'openrouter',name:'OpenRouter · free models',freeLabel:'Free router + :free models',
    description:'Discovers live models and keeps only zero-price/free variants. openrouter/free is always available as the automatic free router.',
    fields:[],
    async listModels(config){
      const models=await openAiModels('https://openrouter.ai/api/v1',config.apiKey,'/models',{'HTTP-Referer':'https://keyflow.local','X-Title':'Keyflow'});
      const free=models.filter(m=>m.id==='openrouter/free' || m.id.endsWith(':free') || (Number(m.raw?.pricing?.prompt??1)===0 && Number(m.raw?.pricing?.completion??1)===0));
      if(!free.some(x=>x.id==='openrouter/free')) free.unshift({id:'openrouter/free',name:'OpenRouter Free Router',raw:{}});
      return free;
    },
    async chat(config,model,messages){return openAiChat('https://openrouter.ai/api/v1',config.apiKey,model,messages,{extraHeaders:{'HTTP-Referer':'https://keyflow.local','X-Title':'Keyflow'}});}
  },
  groq:{
    id:'groq',name:'GroqCloud',freeLabel:'Free-plan rate limits',
    description:'Uses Groq\'s live /models endpoint instead of hard-coding retired model IDs.',fields:[],
    listModels:config=>openAiModels('https://api.groq.com/openai/v1',config.apiKey),
    chat:(config,model,messages)=>openAiChat('https://api.groq.com/openai/v1',config.apiKey,model,messages)
  },
  gemini:{
    id:'gemini',name:'Google Gemini',freeLabel:'AI Studio free tier where available',
    description:'OpenAI-compatible Gemini endpoint with live model discovery.',fields:[],
    async listModels(config){
      const models=await openAiModels('https://generativelanguage.googleapis.com/v1beta/openai',config.apiKey);
      return models.filter(m=>/^gemini-/i.test(m.id) && !/embedding|image|veo|tts/i.test(m.id));
    },
    chat:(config,model,messages)=>openAiChat('https://generativelanguage.googleapis.com/v1beta/openai',config.apiKey,model,messages)
  },
  mistral:{
    id:'mistral',name:'Mistral',freeLabel:'Experiment/free allowance depends on account',
    description:'Discovers only chat-capable models returned for your account.',fields:[],
    async listModels(config){
      const models=await openAiModels('https://api.mistral.ai/v1',config.apiKey);
      return models.filter(m=>m.raw?.capabilities?.completion_chat !== false && !m.raw?.archived);
    },
    chat:(config,model,messages)=>openAiChat('https://api.mistral.ai/v1',config.apiKey,model,messages)
  },
  cerebras:{
    id:'cerebras',name:'Cerebras Inference',freeLabel:'Free developer tier where enabled',
    description:'Public model discovery works even before a key is entered; generation uses your key.',fields:[],
    async listModels(config){
      try{
        const {data}=await httpJson('https://api.cerebras.ai/public/v1/models');
        return modelItems(data).filter(m=>!m.raw?.deprecated);
      }catch{return openAiModels('https://api.cerebras.ai/v1',config.apiKey);}
    },
    chat:(config,model,messages)=>openAiChat('https://api.cerebras.ai/v1',config.apiKey,model,messages)
  },
  nvidia:{
    id:'nvidia',name:'NVIDIA NIM / API Catalog',freeLabel:'Free Endpoint catalog',
    description:'Uses NVIDIA\'s OpenAI-compatible API. The catalog changes frequently, so Keyflow always asks /models first.',fields:[],
    listModels:config=>openAiModels('https://integrate.api.nvidia.com/v1',config.apiKey),
    chat:(config,model,messages)=>openAiChat('https://integrate.api.nvidia.com/v1',config.apiKey,model,messages)
  },
  cloudflare:{
    id:'cloudflare',name:'Cloudflare Workers AI',freeLabel:'10,000 Neurons/day free allocation',
    description:'Requires account ID plus a Workers AI token. Paid-only/deprecated models are hidden when metadata exposes that state.',
    fields:[{key:'accountId',label:'Cloudflare account ID',placeholder:'32-character account ID'}],
    async listModels(config){
      if(!config.accountId) throw new Error('Cloudflare account ID is required.');
      const url=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/ai/models/search?per_page=100&hide_experimental=true&include_deprecated=false`;
      const {data}=await httpJson(url,{headers:bearer(config.apiKey)});
      return modelItems(data).filter(m=>{
        const task=String(m.raw?.task?.name||m.raw?.task||'').toLowerCase();
        const name=String(m.id).toLowerCase();
        return (!task || task.includes('text') || task.includes('chat')) && !/embed|whisper|image|flux|rerank|speech|tts/.test(name);
      });
    },
    async chat(config,model,messages){
      if(!config.accountId) throw new Error('Cloudflare account ID is required.');
      return openAiChat(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/ai/v1`,config.apiKey,model,messages,{bodyExtra:{options:{rejectIfBusy:true}}});
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
      const {data}=await httpJson(`${normalizeBase(config.baseUrl)}${config.modelsPath||'/models'}`,{headers});
      return modelItems(data);
    },
    async chat(config,model,messages){
      if(!config.baseUrl) throw new Error('Custom API base URL is required.');
      const headers={'Content-Type':'application/json',...customHeaders(config)};
      const {data}=await httpJson(`${normalizeBase(config.baseUrl)}${config.chatPath||'/chat/completions'}`,{
        method:'POST',headers,body:{model,messages,temperature:.72,max_tokens:1400}
      });
      return {text:readPath(data,config.responsePath)||openAiText(data),raw:data};
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
  const key=providerId+':'+JSON.stringify({...config,apiKey:config.apiKey?'*':''});
  const hit=cache.get(key);
  if(!force && hit && Date.now()-hit.at<10*60*1000) return hit.models;
  const models=await provider.listModels(config);
  const unique=[...new Map(models.map(m=>[m.id,m])).values()].sort((a,b)=>a.name.localeCompare(b.name));
  cache.set(key,{at:Date.now(),models:unique});
  return unique;
}

export async function providerChat(providerId,config,model,messages){
  const provider=PROVIDERS[providerId];
  if(!provider) throw new Error('Unknown provider.');
  if(!model) throw new Error('Select a live model first.');
  return provider.chat(config,model,messages);
}


export function pickRecommendedModel(models=[]){
  const blocked=/embed|embedding|rerank|whisper|tts|speech|image|vision-only|moderation|guard/i;
  const score=m=>{
    const id=String(m?.id||'').toLowerCase();
    if(!id||blocked.test(id)) return -1e9;
    let s=0;
    if(/:free|\/free|free\b/.test(id)) s+=90;
    if(/flash|instant|fast|turbo/.test(id)) s+=35;
    if(/mini|small|8b|7b|3b/.test(id)) s+=20;
    if(/instruct|chat/.test(id)) s+=12;
    if(/preview|experimental|exp\b/.test(id)) s-=8;
    if(/70b|120b|405b/.test(id)) s-=12;
    const ctx=Number(m?.raw?.context_length||m?.raw?.context_window||0);
    if(ctx>=16000) s+=4;
    return s;
  };
  return [...models].sort((a,b)=>score(b)-score(a)||String(a.id).localeCompare(String(b.id)))[0]||null;
}

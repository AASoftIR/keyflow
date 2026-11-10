import {graphemes} from '../core/normalization.js';
export function errorDNA(sessions,{language=null,limit=12}={}){
  const confusions=new Map(),hesitations=new Map(),words=new Map();
  for(const s of sessions||[]){
    if(language && s.language!==language)continue;
    const chars=graphemes(s.text||'',s.language||'en');
    for(const e of s.events||[]){
      if(e.type!=='key')continue;
      const expected=String(e.expected||'');if(!expected)continue;
      const actual=String(e.key||'');
      if(!e.correct){
        const pair=expected+' → '+(actual===' '?'␠':actual==='\n'?'↵':actual);
        const row=confusions.get(pair)||{expected,actual,label:pair,count:0};row.count++;confusions.set(pair,row);
        const index=Math.max(0,Math.min(chars.length-1,Number(e.index)||0));
        let a=index,b=index;
        while(a>0 && !/\s/u.test(chars[a-1]))a--;
        while(b<chars.length-1 && !/\s/u.test(chars[b+1]))b++;
        const word=chars.slice(a,b+1).join('').trim();
        if(word && word.length<65)words.set(word,(words.get(word)||0)+1);
      }
      const delay=Number(e.interval)||0;
      if(delay>100&&delay<2000){const row=hesitations.get(expected)||{key:expected,count:0,total:0};row.count++;row.total+=delay;hesitations.set(expected,row);}
    }
  }
  return {confusions:[...confusions.values()].sort((a,b)=>b.count-a.count).slice(0,limit),
    slowKeys:[...hesitations.values()].filter(x=>x.count>=3).map(x=>({...x,averageMs:Math.round(x.total/x.count)})).sort((a,b)=>b.averageMs-a.averageMs).slice(0,limit),
    words:[...words].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([word,count])=>({word,count}))};
}
export function repairDrill(dna,language='en'){
  const words=dna?.words?.slice(0,8).map(x=>x.word).filter(Boolean)||[];
  const keys=dna?.confusions?.slice(0,5).map(x=>x.expected).filter(Boolean)||[];
  const material=words.length?words.join(language==='fa'?'، ':' · '):keys.join(' ');
  if(!material)return null;
  return Array(6).fill(material).join(language==='fa'?'؛ ':'; ')+'.';
}

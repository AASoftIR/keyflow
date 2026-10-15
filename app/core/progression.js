const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));

export const RANKS=[
  {rank:1,name:'Foundation',xp:0},
  {rank:2,name:'Home Row',xp:250},
  {rank:3,name:'Explorer',xp:650},
  {rank:4,name:'Steady',xp:1200},
  {rank:5,name:'Flow',xp:2000},
  {rank:6,name:'Precision',xp:3100},
  {rank:7,name:'Rapid',xp:4500},
  {rank:8,name:'Advanced',xp:6300},
  {rank:9,name:'Expert',xp:8500},
  {rank:10,name:'Master',xp:11200}
];

export function profileForLanguage(all,language){
  const base={language,xp:0,rank:1,rating:0,sessions:0,reliableSessions:0,lastGain:0,lastScore:0,updatedAt:0};
  return {...base,...(all?.[language]||{})};
}

export function rankForXp(xp=0){
  let found=RANKS[0];
  for(const rank of RANKS) if(xp>=rank.xp) found=rank;
  return found;
}

export function rankProgress(profile){
  const rank=rankForXp(profile?.xp||0);
  const next=RANKS.find(x=>x.rank===rank.rank+1)||rank;
  if(next.rank===rank.rank) return {rank,next,progress:1,remaining:0};
  const span=Math.max(1,next.xp-rank.xp);
  const progress=clamp(((profile?.xp||0)-rank.xp)/span,0,1);
  return {rank,next,progress,remaining:Math.max(0,next.xp-(profile?.xp||0))};
}

export function performanceScore(summary,targetWpm){
  if(!summary?.reliable) return 0;
  const accuracy=clamp((summary.accuracy-82)/18,0,1);
  const consistency=clamp((summary.consistency-35)/65,0,1);
  const pace=clamp((summary.wpm||0)/Math.max(10,targetWpm||40),0,1.25)/1.25;
  const corrections=clamp(1-(summary.correctionRate||0)/20,0,1);
  return Math.round((accuracy*.46+consistency*.24+pace*.22+corrections*.08)*100);
}

export function updateProgression(all,language,summary,targetWpm){
  const current=profileForLanguage(all,language);
  current.sessions+=1;
  current.updatedAt=Date.now();
  if(!summary?.reliable){ current.lastGain=0; current.lastScore=0; return {...all,[language]:current}; }
  current.reliableSessions+=1;
  const score=performanceScore(summary,targetWpm);
  const lengthFactor=clamp((summary.typed||0)/420,.55,2.2);
  const gain=Math.max(4,Math.round((8+score*.32)*lengthFactor));
  current.xp+=gain;
  current.rating=current.rating ? Math.round(current.rating*.82+score*.18) : score;
  current.lastGain=gain;
  current.lastScore=score;
  current.rank=rankForXp(current.xp).rank;
  return {...all,[language]:current};
}

export function recommendedDifficulty(profile,aggregate){
  const rank=rankForXp(profile?.xp||0).rank;
  let tier=rank<=2?1:rank<=4?2:rank<=6?3:rank<=8?4:5;
  if(aggregate?.sessions>=3){
    if(aggregate.accuracy<90 || aggregate.averageConsistency<52) tier-=1;
    else if(aggregate.accuracy>=97 && aggregate.averageConsistency>=82 && aggregate.recentAverageWpm>0) tier+=1;
  }
  return clamp(tier,1,5);
}

export function curriculumFor(aggregate,targetWpm,profile){
  const weak=aggregate?.weakPairs?.[0]?.pair || aggregate?.weakKeys?.[0]?.char || 'weak transitions';
  const rank=rankForXp(profile?.xp||0);
  const plan=[];
  if(!aggregate?.sessions || aggregate.sessions<3){
    plan.push({mode:'text',title:'Baseline passage',why:'Build enough clean timing data for personalization.'});
    plan.push({mode:'text',title:'Second baseline',why:'Separate one lucky run from a stable pattern.'});
    plan.push({mode:'rhythm',title:'Rhythm sample',why:'Measure transition consistency before speed work.'});
    return plan;
  }
  if(aggregate.accuracy<94) plan.push({mode:'weak',title:'Accuracy repair',why:`Target ${weak} and keep errors from becoming motor memory.`});
  else plan.push({mode:'rhythm',title:'Flow calibration',why:'Stabilize inter-key timing before pushing pace.'});
  if(aggregate.averageConsistency<76) plan.push({mode:'rhythm',title:'Transition rhythm',why:'Reduce timing variance and long pauses.'});
  else plan.push({mode:'text',title:'Controlled pace',why:`Hold clean form near ${Math.round(targetWpm*.9)}–${targetWpm} WPM.`});
  plan.push({mode:rank.rank>=7?'numbers':'text',title:rank.rank>=7?'Complex symbols':'Endurance passage',why:rank.rank>=7?'Add symbol-layer movement without sacrificing accuracy.':'Finish with a longer passage to test sustained flow.'});
  return plan.slice(0,3);
}

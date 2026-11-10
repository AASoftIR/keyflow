export function beginCircuit(passage,now=Date.now()){
  return {v:1,step:'baseline',startedAt:now,language:passage.language,passage:{...passage},baseline:null,repair:null,result:null};
}
export function advanceCircuit(state,session,repairText){
  if(!state||!session||state.step==='complete')return state;
  if(session.completionReason!=='passage'||session.summary?.reliable!==true)return state;
  const stats={sessionId:session.id,wpm:Number(session.summary.wpm)||0,accuracy:Number(session.summary.accuracy)||0};
  if(state.step==='baseline')return {...state,step:'repair',baseline:stats,repairText:repairText||state.passage.text};
  if(state.step==='repair')return {...state,step:'retest',repair:stats};
  if(state.step==='retest')return {...state,step:'complete',result:stats,finishedAt:Date.now()};
  return state;
}
export function circuitNextPassage(state){
  if(!state)return null;
  if(['baseline','retest'].includes(state.step))return {...state.passage};
  if(state.step==='repair')return {id:`circuit-repair-${state.startedAt}`,title:'Circuit · focused repair',language:state.language,source:'circuit',level:state.passage.level||3,text:state.repairText||state.passage.text,tags:['circuit','repair']};
  return null;
}

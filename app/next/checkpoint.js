export const CHECKPOINT_KEY='keyflow.checkpoint';
export function makeCheckpoint(passage,engine,now=Date.now()){
  return {v:1,savedAt:now,passage:{id:passage.id,title:passage.title,language:passage.language,level:passage.level,text:passage.text,source:passage.source,sourceParts:passage.sourceParts,sourceIds:passage.sourceIds},engine:engine.snapshot()};
}
export function validCheckpoint(value,now=Date.now()){
  return !!(value&&value.v===1&&typeof value.passage?.text==='string'&&value.passage.text.length>5&&value.passage.text.length<100000 && Number.isInteger(value.engine?.index) && value.engine.index>0&&value.engine.index<value.engine.statuses?.length&&value.engine.statuses.length<=100000&&now-value.savedAt<7*86400000&&now>=value.savedAt);
}

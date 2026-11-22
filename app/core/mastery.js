export const STAGE_TARGETS=Object.freeze({1:16,2:25,3:35,4:48,5:62});
/** A stage is earned only through three reliable, fully finished passages.
 * Temporary poor sessions never revoke stage. Manual difficulty still works. */
export function stageEvidence(sessions=[],language='en',stage=1,targetWpm=40){
  const relevant=sessions.filter(s=>s.language===language && Number(s.level||3)===stage && s.completionReason==='passage' && s.summary?.reliable!==false);
  const required=Math.max(12,Math.min(120,Math.round((targetWpm||40)*(.4+stage*.105))));
  const successful=relevant.filter(s=>s.summary?.accuracy>=96 && s.summary?.consistency>=65 && s.summary?.wpm>=required && (s.completedChars||0)>=Math.min(160,s.textLength||0));
  const unique=new Set(successful.map(s=>s.sourceIds?.[0]||s.textId||s.text).filter(Boolean));
  const passes=unique.size;
  return {stage,required,successes:passes,needed:Math.max(0,3-passes),unlocked:passes>=3,attempts:relevant.length};
}
export function nextEarnedStage(sessions,language,currentStage,targetWpm){
  const current=Math.max(1,Math.min(5,Number(currentStage)||1));
  return stageEvidence(sessions,language,current,targetWpm).unlocked?Math.min(5,current+1):current;
}

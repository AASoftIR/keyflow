/**
 * KeyFlow Studio visual + session primitives. Deliberately dependency-free:
 * no React hydration, WebGL, timers or layout reads in the typing hot path.
 */
export const VISUAL_STYLES=Object.freeze(['quiet','depth','glass']);
export const MOTION_STYLES=Object.freeze(['none','subtle','expressive']);

export function normalizeStudioSettings(raw={}){
  const visualStyle=VISUAL_STYLES.includes(raw.visualStyle)?raw.visualStyle:'depth';
  const motionStyle=MOTION_STYLES.includes(raw.motionStyle)?raw.motionStyle:'subtle';
  return {visualStyle,motionStyle};
}

export function effectiveMotion({motionStyle='subtle',reduceMotion=false,performanceMode='ultra',prefersReducedMotion=false}={}){
  if(reduceMotion||prefersReducedMotion||performanceMode==='ultra')return 'none';
  return MOTION_STYLES.includes(motionStyle)?motionStyle:'subtle';
}

export function estimatedPracticeMinutes(chars,wpm){
  const count=Math.max(0,Number(chars)||0);
  const speed=Math.max(10,Math.min(250,Number(wpm)||45));
  return Math.max(1,Math.ceil(count/(speed*5)));
}

export const STUDIO_PRESETS=Object.freeze({
  warmup:Object.freeze({label:'Warm-up',mode:'text',sessionLength:'quick',zenPractice:false}),
  precision:Object.freeze({label:'Precision repair',mode:'weak',sessionLength:'standard',zenPractice:false}),
  flow:Object.freeze({label:'Deep flow',mode:'text',sessionLength:'long',zenPractice:true}),
  code:Object.freeze({label:'Code fluency',mode:'text',source:'code'})
});

export function studioPreset(id){return STUDIO_PRESETS[id]||null;}

export function practiceProgress(index,total){
  const completed=Math.max(0,Number(index)||0),maximum=Math.max(0,Number(total)||0);
  if(!maximum)return 0;
  return Math.max(0,Math.min(100,Math.round(100*completed/maximum)));
}

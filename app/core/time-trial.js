import { graphemes } from './normalization.js';

export const TIME_TRIAL_MODES=Object.freeze(['off','steady','pro']);
export function normalizeTimeTrialMode(mode){return TIME_TRIAL_MODES.includes(mode)?mode:'off';}

/** Passage-specific allowance: a realistic intermediate or professional pace,
 * plus small physical-key costs and a difficulty multiplier. No typing history,
 * storage, DOM or network calls occur in this calculation. */
export function makeTimeTrialPlan(text,{language='en',level=3,mode='off'}={}){
  const profile=normalizeTimeTrialMode(mode);
  if(profile==='off')return null;
  const chars=graphemes(String(text||''),language);
  const difficulty=Math.max(1,Math.min(5,Number(level)||3));
  const baseWpm=profile==='pro'?(language==='fa'?65:80):(language==='fa'?36:45);
  let effort=chars.length;
  for(const char of chars){
    if(/[\d۰-۹]/u.test(char))effort+=0.5;
    else if(/[,:;!?؟؛،()\[\]{}"'«»@#$%&*_+=\\/\-]/u.test(char))effort+=0.65;
    else if(/[A-Z]/u.test(char))effort+=0.15;
    else if(char==='\u200c')effort+=0.6;
  }
  const multiplier=[0,0.95,1,1.08,1.17,1.28][difficulty];
  const allowanceSeconds=Math.max(20,Math.min(1800,Math.ceil((effort/5/baseWpm*60*multiplier+5)/5)*5));
  return {mode:profile,language,level:difficulty,characters:chars.length,effort:Math.round(effort),
    referenceWpm:baseWpm,allowanceMs:allowanceSeconds*1000};
}

export function timeTrialRemaining(activeMs,plan){
  if(!plan)return null;
  return Math.max(0,Math.ceil((plan.allowanceMs-Math.max(0,Number(activeMs)||0))/1000));
}

export function timeTrialResult(session,plan=session?.timeTrial){
  if(!plan)return null;
  const completed=Math.max(0,Math.min(Number(session?.completedChars)||0,Number(session?.textLength)||1));
  const total=Math.max(1,Number(session?.textLength)||1);
  const accuracy=Number(session?.summary?.accuracy)||0;
  const full=session?.completionReason==='passage' && completed>=total;
  const timeUsedMs=Number(session?.activeDurationMs)||0;
  const succeeded=full && timeUsedMs<=plan.allowanceMs+100;
  const completion=Math.round(completed/total*100);
  // Honest partial grades report both coverage and accuracy; a missed deadline
  // never becomes a completed passage or rewards an inflated speed estimate.
  const score=Math.round(completion*(accuracy/100));
  return {succeeded,completion,score,accuracy,remainingChars:total-completed,
    timeUsedMs,allowanceMs:plan.allowanceMs,mode:plan.mode};
}

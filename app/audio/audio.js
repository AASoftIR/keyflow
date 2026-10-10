import { bind, play, setEnabled, setTheme, setVolume } from 'cuelume';

let enabled=true;
let volume=0.34;
let keySounds=true;
let profile='soft';
let initialized=false;
let primed=false;
let cuesRequested=0;
let failures=0;
let lastError='';
let lastCue='';
let lastCueAt=0;
let lastTypeCueAt=0;

const PROFILES={
  soft:{theme:'default',key:.20,space:.24,error:.40,complete:.46,ui:.14,emphasis:'subtle'},
  mechanical:{theme:'mech',key:.16,space:.20,error:.36,complete:.43,ui:.12,emphasis:'subtle'},
  minimal:{theme:'press',key:.12,space:.16,error:.31,complete:.38,ui:.10,emphasis:'subtle'},
  playful:{theme:'bubble',key:.17,space:.22,error:.36,complete:.43,ui:.12,emphasis:'subtle'}
};
const clamp=(value,min=0,max=1)=>Math.min(max,Math.max(min,Number(value)||0));
const cfg=()=>PROFILES[profile]||PROFILES.soft;

function emitStatus(){if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('keyflow-audio-status',{detail:getAudioStatus()}));}
function configureCuelume(){
  try{
    setEnabled(enabled);setVolume(volume);setTheme(cfg().theme);
    if(!initialized&&typeof document!=='undefined'){bind(document);initialized=true;}
    lastError='';emitStatus();return true;
  }catch(error){failures++;lastError=error?.message||String(error);emitStatus();return false;}
}
function keyRole(character){if(character===' '||character==='\t')return'space';if(character==='\n')return'enter';return'printable';}
function requestCue(name,options={}){
  if(!enabled)return false;
  try{play(name,options);cuesRequested++;lastCue=name;lastCueAt=Date.now();lastError='';if(cuesRequested<=3||name==='error'||name==='success')emitStatus();return true;}
  catch(error){failures++;lastError=error?.message||String(error);emitStatus();return false;}
}

export function initAudio({soundEnabled=true,soundVolume=.34,keyClickSounds=true,soundProfile='soft'}={}){
  enabled=!!soundEnabled;volume=clamp(soundVolume);keySounds=!!keyClickSounds;profile=Object.hasOwn(PROFILES,soundProfile)?soundProfile:'soft';configureCuelume();return true;
}
export function warmAudioLater(options={}){initAudio(options);}
export function applyAudioSettings({soundEnabled,soundVolume,keyClickSounds,soundProfile=profile}){
  enabled=!!soundEnabled;if(Number.isFinite(Number(soundVolume)))volume=clamp(soundVolume);keySounds=!!keyClickSounds;profile=Object.hasOwn(PROFILES,soundProfile)?soundProfile:profile;configureCuelume();return true;
}
export function primeAudioFromGesture(){
  if(!initialized)configureCuelume();
  if(primed||!enabled)return;
  primed=true;
  // Cuelume creates its shared AudioContext lazily. A nearly inaudible tap on
  // the first pointer/key gesture pays that startup cost before a timed typing
  // session begins without producing an ear-catching startup sound.
  // Reserve the first-gesture activation for Cuelume only; no synthetic
  // sound is fired before a real keystroke / explicit sound-test click.
  // The first ordinary playFeedback() is the audible handshake.
}
export function playFeedback(kind,detail={}){
  if(!enabled)return false;const mix=cfg();
  if(kind==='key'){if(!keySounds)return false;const now=performance.now();if(lastTypeCueAt&&now-lastTypeCueAt<28)return false;lastTypeCueAt=now;return requestCue('type',{key:keyRole(detail.character),emphasis:mix.emphasis,volume:mix.key});}
  if(kind==='word'){if(!keySounds)return false;lastTypeCueAt=performance.now();return requestCue('type',{key:keyRole(detail.character||' '),emphasis:mix.emphasis,volume:mix.space});}
  if(kind==='delete'){if(!keySounds)return false;return requestCue('type',{key:'delete',emphasis:'subtle',volume:mix.key*.9});}
  if(kind==='error')return requestCue('error',{emphasis:'normal',volume:mix.error});
  if(kind==='complete')return requestCue('success',{emphasis:'normal',volume:mix.complete});
  if(kind==='ready')return requestCue('ready',{emphasis:'subtle',volume:mix.complete*.7});
  if(kind==='ui')return requestCue('tap',{input:'mouse',emphasis:'subtle',volume:mix.ui});
  return false;
}
export async function testAudio(){
  if(!enabled)return getAudioStatus();configureCuelume();const mix=cfg();
  requestCue('type',{key:'printable',emphasis:mix.emphasis,volume:mix.key});await new Promise(r=>setTimeout(r,130));
  requestCue('type',{key:'space',emphasis:mix.emphasis,volume:mix.space});await new Promise(r=>setTimeout(r,150));
  requestCue('error',{emphasis:'normal',volume:mix.error});await new Promise(r=>setTimeout(r,210));
  requestCue('success',{emphasis:'normal',volume:mix.complete});return getAudioStatus();
}
export function getAudioStatus(){return{backend:'cuelume',state:lastError?'failed':(cuesRequested?'sent':'ready'),enabled,keySounds,profile,theme:cfg().theme,volume,cuesRequested,failures,lastCue,lastCueAt,lastError,comfortMix:{...cfg()}};}

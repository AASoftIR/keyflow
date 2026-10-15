import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const calls=[];
globalThis.__cuelumeCalls=calls;
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event { constructor(type,init={}){ super(type); this.detail=init.detail; } };
}
globalThis.window=new EventTarget();
globalThis.document={};
if(!globalThis.performance) globalThis.performance={now:()=>Date.now()};

let source=await readFile(new URL('../app/audio/audio.js',import.meta.url),'utf8');
source=source.replace(
  /^import \{ bind, play, setEnabled, setTheme, setVolume \} from 'cuelume';/m,
  `const bind=(root)=>globalThis.__cuelumeCalls.push(['bind',root]);\nconst play=(name,options)=>globalThis.__cuelumeCalls.push(['play',name,options]);\nconst setEnabled=(value)=>globalThis.__cuelumeCalls.push(['setEnabled',value]);\nconst setTheme=(value)=>globalThis.__cuelumeCalls.push(['setTheme',value]);\nconst setVolume=(value)=>globalThis.__cuelumeCalls.push(['setVolume',value]);`
);
const url=`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const audio=await import(url);

audio.initAudio({soundEnabled:true,soundVolume:.34,keyClickSounds:true,soundProfile:'soft'});
assert.equal(audio.getAudioStatus().backend,'cuelume');
assert.equal(audio.getAudioStatus().theme,'default');
assert.ok(calls.some(c=>c[0]==='setTheme' && c[1]==='default'),'soft profile must select Cuelume default theme');
assert.ok(calls.some(c=>c[0]==='setVolume' && c[1]===.34),'comfort volume must be forwarded to Cuelume');

calls.length=0;
assert.equal(audio.playFeedback('key',{character:'a'}),true);
let last=calls.at(-1);
assert.equal(last[0],'play');assert.equal(last[1],'type');assert.equal(last[2].key,'printable');assert.equal(last[2].emphasis,'subtle');assert.ok(last[2].volume<=.20);

audio.playFeedback('word',{character:' '});
last=calls.at(-1);assert.equal(last[1],'type');assert.equal(last[2].key,'space');assert.ok(last[2].volume<=.24);
audio.playFeedback('delete',{character:'Backspace'});
last=calls.at(-1);assert.equal(last[1],'type');assert.equal(last[2].key,'delete');
audio.playFeedback('error',{character:'x'});
last=calls.at(-1);assert.equal(last[1],'error');assert.equal(last[2].emphasis,'normal');assert.ok(last[2].volume<=.40);
audio.playFeedback('complete');
last=calls.at(-1);assert.equal(last[1],'success');assert.ok(last[2].volume<=.46);
assert.ok(audio.getAudioStatus().cuesRequested>=5,'coach must count Cuelume cue requests');
console.log('✓ audio adapter smoke: calm Cuelume keys/space/delete/error/completion mapping');

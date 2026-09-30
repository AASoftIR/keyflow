import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const calls=[];
globalThis.__cuelumeCalls=calls;
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event { constructor(type,init={}){ super(type); this.detail=init.detail; } };
}
globalThis.window=new EventTarget();
globalThis.document={};

let source=await readFile(new URL('../app/audio/audio.js',import.meta.url),'utf8');
source=source.replace(
  /^import \{ bind, play, setEnabled, setTheme, setVolume \} from 'cuelume';/m,
  `const bind=(root)=>globalThis.__cuelumeCalls.push(['bind',root]);\nconst play=(name,options)=>globalThis.__cuelumeCalls.push(['play',name,options]);\nconst setEnabled=(value)=>globalThis.__cuelumeCalls.push(['setEnabled',value]);\nconst setTheme=(value)=>globalThis.__cuelumeCalls.push(['setTheme',value]);\nconst setVolume=(value)=>globalThis.__cuelumeCalls.push(['setVolume',value]);`
);
const url=`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const audio=await import(url);

audio.initAudio({soundEnabled:true,soundVolume:.82,keyClickSounds:true,soundProfile:'mechanical'});
assert.equal(audio.getAudioStatus().backend,'cuelume');
assert.equal(audio.getAudioStatus().theme,'mech');
assert.ok(calls.some(c=>c[0]==='setTheme' && c[1]==='mech'),'mechanical profile must select Cuelume mech theme');
assert.ok(calls.some(c=>c[0]==='setVolume' && c[1]===.82),'volume must be forwarded to Cuelume');

calls.length=0;
assert.equal(audio.playFeedback('key',{character:'a'}),true);
assert.deepEqual(calls.at(-1),['play','type',{key:'printable',emphasis:'normal'}]);
audio.playFeedback('word',{character:' '});
assert.deepEqual(calls.at(-1),['play','type',{key:'space',emphasis:'normal'}]);
audio.playFeedback('delete',{character:'Backspace'});
assert.deepEqual(calls.at(-1),['play','type',{key:'delete',emphasis:'normal'}]);
audio.playFeedback('error',{character:'x'});
assert.equal(calls.at(-1)[1],'error');
assert.equal(calls.at(-1)[2].emphasis,'strong');
audio.playFeedback('complete');
assert.equal(calls.at(-1)[1],'success');
assert.ok(audio.getAudioStatus().cuesRequested>=5,'coach must count Cuelume cue requests');
console.log('✓ audio adapter smoke: keys/space/delete/error/completion map to Cuelume cues');

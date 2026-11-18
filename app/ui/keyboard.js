import { PHYSICAL_ROWS, formatChord } from '../core/layouts.js';

const WIDE={Backspace:2,Tab:1.45,CapsLock:1.65,Enter:1.9,ShiftLeft:2.05,ShiftRight:2.35,ControlLeft:1.3,ControlRight:1.3,AltLeft:1.2,AltRight:1.2,Space:6.2};
const FINGER={
  KeyQ:'LP',KeyA:'LP',KeyZ:'LP',Digit1:'LP',
  KeyW:'LR',KeyS:'LR',KeyX:'LR',Digit2:'LR',
  KeyE:'LM',KeyD:'LM',KeyC:'LM',Digit3:'LM',
  KeyR:'LI',KeyF:'LI',KeyV:'LI',Digit4:'LI',KeyT:'LI',KeyG:'LI',KeyB:'LI',Digit5:'LI',
  KeyY:'RI',KeyH:'RI',KeyN:'RI',Digit6:'RI',KeyU:'RI',KeyJ:'RI',KeyM:'RI',Digit7:'RI',
  KeyI:'RM',KeyK:'RM',Comma:'RM',Digit8:'RM',
  KeyO:'RR',KeyL:'RR',Period:'RR',Digit9:'RR',
  KeyP:'RP',Semicolon:'RP',Quote:'RP',Slash:'RP',Digit0:'RP',Minus:'RP',Equal:'RP',BracketLeft:'RP',BracketRight:'RP',Backslash:'RP'
};

export class KeyboardView {
  constructor(container,mapper){
    this.container=container; this.mapper=mapper; this.activeCode=''; this.heatByCode=new Map();
    this.render();
  }
  setMapper(mapper){ this.mapper=mapper; this.render(); }
  render(){
    const frag=document.createDocumentFragment();
    for(const row of PHYSICAL_ROWS){
      const rowEl=document.createElement('div'); rowEl.className='keyboard-row';
      for(const code of row){
        const key=document.createElement('div'); key.className='keycap'; key.dataset.code=code;
        key.style.setProperty('--u',String(WIDE[code]||1));
        if(FINGER[code]) key.dataset.finger=FINGER[code];
        const top=document.createElement('span'); top.className='key-top'; top.textContent=this.mapper.displayForCode(code,true);
        const main=document.createElement('span'); main.className='key-main'; main.textContent=this.mapper.displayForCode(code,false);
        key.append(top,main); rowEl.append(key);
      }
      frag.append(rowEl);
    }
    this.container.replaceChildren(frag);
    this._applyHeatmap();
    if(this.activeCode) this.highlight({code:this.activeCode});
  }

  setHeatmap(weakKeys=[]){
    this.heatByCode.clear();
    const usable=(weakKeys||[]).filter(x=>x?.char && Number.isFinite(x.score) && x.hits>0);
    const max=Math.max(1,...usable.map(x=>x.score));
    for(const item of usable){
      const hint=this.mapper?.hintFor(item.char);
      if(!hint?.code) continue;
      const value=Math.max(0,Math.min(1,item.score/max));
      this.heatByCode.set(hint.code,Math.max(value,this.heatByCode.get(hint.code)||0));
    }
    this._applyHeatmap();
  }
  _applyHeatmap(){
    if(!this.container) return;
    this.container.querySelectorAll('.keycap').forEach(key=>{
      const heat=this.heatByCode.get(key.dataset.code)||0;
      key.classList.remove('heat-1','heat-2','heat-3','heat-4');
      if(heat>=.75) key.classList.add('heat-4');
      else if(heat>=.5) key.classList.add('heat-3');
      else if(heat>=.25) key.classList.add('heat-2');
      else if(heat>0) key.classList.add('heat-1');
    });
  }
  highlight(hint){
    if(this.activeCode) this.container.querySelector(`[data-code="${CSS.escape(this.activeCode)}"]`)?.classList.remove('next-key');
    this.activeCode=hint?.code||'';
    if(this.activeCode) this.container.querySelector(`[data-code="${CSS.escape(this.activeCode)}"]`)?.classList.add('next-key');
  }
  describe(hint){ return formatChord(hint); }
}

import { graphemes, normalizeForComparison } from './normalization.js';
import { calculateSessionSummary } from './stats.js';
import { cursorScrollTarget } from './viewport.js';

export const isEditableTarget = target => {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return ['input','textarea','button','select','option','a','summary'].includes(tag) || !!target.isContentEditable || !!target.closest?.('[role=button],[data-ignore-practice]');
};

const clamp = (v,min,max)=>Math.min(max,Math.max(min,v));
const newSessionId=()=>{
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
  if(globalThis.crypto?.getRandomValues){const buf=new Uint32Array(4);globalThis.crypto.getRandomValues(buf);return 'session-'+[...buf].map(x=>x.toString(16)).join('-');}
  return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const utf16Offsets = chars => {
  const offsets=new Array(chars.length+1);
  let at=0;
  for(let i=0;i<chars.length;i++){ offsets[i]=at; at+=chars[i].length; }
  offsets[chars.length]=at;
  return offsets;
};

const supportsCustomHighlights = () => typeof CSS!=='undefined' && !!CSS.highlights && typeof Highlight!=='undefined' && typeof document!=='undefined' && !!document.createRange;
export const shouldUseCustomHighlights = (language, available=supportsCustomHighlights()) => language!=='fa' && !!available;

class RollingWindow {
  constructor(limit=40){ this.limit=limit; this.values=[]; this.sum=0; this.sumSq=0; }
  clear(){ this.values.length=0; this.sum=0; this.sumSq=0; }
  push(value){
    if(!Number.isFinite(value)) return;
    this.values.push(value); this.sum+=value; this.sumSq+=value*value;
    if(this.values.length>this.limit){ const old=this.values.shift(); this.sum-=old; this.sumSq-=old*old; }
  }
  mean(){ return this.values.length?this.sum/this.values.length:0; }
  consistency(){
    const n=this.values.length;if(n<5)return 100;
    const avg=this.sum/n;if(!avg)return 100;
    const variance=Math.max(0,this.sumSq/n-avg*avg);
    return clamp(100-(Math.sqrt(variance)/avg)*55,0,100);
  }
  p95(){
    if(!this.values.length)return 0;
    const copy=[...this.values].sort((a,b)=>a-b);
    return copy[Math.min(copy.length-1,Math.floor(copy.length*.95))];
  }
}

export class TypingEngine extends EventTarget {
  constructor({ language='en', strictAccuracy=false, mapper, onFeedback=()=>{} }={}){
    super();
    this.language=language;
    this.strictAccuracy=strictAccuracy;
    this.mapper=mapper;
    this.onFeedback=onFeedback;
    this.active=false;
    this.paused=false;
    this._raf=0;
    this._scrollRaf=0;
    this._markerRaf=0;
    this._boundKey=e=>this._onKey(e);
    this.followCursor=true;
    this._manualWheel=()=>{if(!this.followCursor)return;this.followCursor=false;this.dispatchEvent(new CustomEvent('followchange',{detail:{enabled:false,source:'manual'}}));};
    // Reposition geometric markers whenever wrapping/zoom/fonts change.
    this._onContainerResize=()=>{this.scrollToCurrent();this._invalidateMarkers();};
    // The marker is a viewport-local, fixed overlay. Listen to ALL scroll
    // containers (including #view), not just the passage's own scroll.
    this._onAnyScroll=()=>this._queueMarkerPaint();
    this._intervalWindow=new RollingWindow(40);
    this._delayWindow=new RollingWindow(80);
    this.reset('');
  }

  reset(text, metadata={}){
    this.target=String(text||'');
    this.chars=graphemes(this.target,this.language);
    this.offsets=utf16Offsets(this.chars);
    this.statuses=new Uint8Array(this.chars.length);
    this.statusRanges=new Array(this.chars.length);
    this.metadata=metadata;
    this.index=0;
    this.startedAt=0;
    this.lastKeyAt=0;
    this.totalPausedMs=0;
    this.pausedAt=0;
    this.activeElapsedMs=0;
    this.activeSegmentStartedPerf=0;
    this.pauseStartedPerf=0;
    this.correct=0;
    this.errors=0;
    this.unresolvedErrors=0;
    this.currentStreak=0;
    this.bestStreak=0;
    this.backspaces=0;
    this.intervals=[];
    this.events=[];
    this.keyStats={};
    this.pairStats={};
    this.lastExpected='';
    this.finished=false;
    this.completionReason='passage';
    this._intervalWindow.clear();
    this._delayWindow.clear();
  }

  setText(text,metadata={}){
    const wasActive=this.active;
    this.stop();
    this.reset(text,metadata);
    this.render();
    if(this.container)this.container.scrollTop=0;
    if(wasActive) this.start();
    this.scrollToCurrent(true);
  }

  mount(container){
    if(this._resizeObserver){this._resizeObserver.disconnect();this._resizeObserver=null;}
    window.removeEventListener('scroll',this._onAnyScroll,true);
    window.removeEventListener('resize',this._onContainerResize);
    if(this.container){this.container.removeEventListener('wheel',this._manualWheel);this.container.removeEventListener('touchmove',this._manualWheel);}
    this.container=container;
    this.container.addEventListener('wheel',this._manualWheel,{passive:true});
    this.container.addEventListener('touchmove',this._manualWheel,{passive:true});
    // The capture listener includes programmatic and nested scrolling, and does
    // not perform any layout work until the next animation frame.
    window.addEventListener('scroll',this._onAnyScroll,true);
    window.addEventListener('resize',this._onContainerResize,{passive:true});
    this.render();
    this.start();
    if(typeof ResizeObserver!=='undefined'){
      this._resizeObserver=new ResizeObserver(this._onContainerResize);
      this._resizeObserver.observe(container);
      // Font changes can reflow the inner passage without changing viewport size.
      this._resizeObserver.observe(this.glyphLayer);
    }
    if(typeof document!=='undefined' && document.fonts?.ready){
      document.fonts.ready.then(()=>{if(this.active && this.container?.isConnected)this._onContainerResize();}).catch(()=>{});
    }
    this.scrollToCurrent();
  }

  setFollowCursor(enabled){
    this.followCursor=!!enabled;
    this.dispatchEvent(new CustomEvent('followchange',{detail:{enabled:this.followCursor,source:'button'}}));
    if(this.followCursor)this.scrollToCurrent(true);
  }

  scrollToCurrent(force=false){this._scheduleScroll(this.index,force);}

  browsePage(direction){
    if(!this.container)return;
    this.setFollowCursor(false);
    this.container.scrollTop=Math.max(0,Math.min(this.container.scrollHeight-this.container.clientHeight,this.container.scrollTop+Math.sign(direction)*this.container.clientHeight*.76));
    this._queueMarkerPaint();
  }

  render(){
    if(!this.container) return;
    cancelAnimationFrame(this._markerRaf);
    this._markerRaf=0;
    this._clearHighlights();
    if(this._resizeObserver && this.glyphLayer)this._resizeObserver.unobserve(this.glyphLayer);
    this.markerLayer?.remove();
    this.container.replaceChildren();
    this.container.lang=this.language==='fa'?'fa':'en';
    this.container.dir=this.language==='fa'?'rtl':'ltr';
    this.container.classList.toggle('shaped-persian',this.language==='fa');

    // The Persian glyph run remains one text node. The color markers live in
    // a VIEWPORT-LOCAL overlay attached directly to <body>, not inside the
    // scroll content. WebKitGTK can size/clip an absolute percentage-height
    // element using the scrollport rather than its scrollable content; that
    // was responsible for the caret collapsing to the viewport bottom.
    this.contentLayer=document.createElement('div');
    this.contentLayer.className='typing-content-layer';
    this.glyphLayer=document.createElement('div');
    this.glyphLayer.className='typing-glyph-layer';
    this.glyphLayer.lang=this.language==='fa'?'fa':'en';
    this.glyphLayer.dir=this.language==='fa'?'rtl':'ltr';
    this.textNode=document.createTextNode(this.target);
    this.glyphLayer.append(this.textNode);
    this.contentLayer.append(this.glyphLayer);
    this.container.append(this.contentLayer);
    this._resizeObserver?.observe(this.glyphLayer);

    this.markerLayer?.remove();
    this.markerLayer=document.createElement('div');
    this.markerLayer.className='typing-marker-layer typing-viewport-overlay';
    this.markerLayer.setAttribute('aria-hidden','true');
    document.body.append(this.markerLayer);

    // Chromium handles Custom Highlights without disturbing Latin shaping, but
    // WebKitGTK can reshape an Arabic joining cluster at a highlighted Range.
    // Persian therefore always uses the geometry-only marker renderer.
    this.useHighlights=shouldUseCustomHighlights(this.language);
    if(this.useHighlights){
      this.correctHighlight=new Highlight();
      this.wrongHighlight=new Highlight();
      this.currentHighlight=new Highlight();
      CSS.highlights.set('keyflow-correct',this.correctHighlight);
      CSS.highlights.set('keyflow-wrong',this.wrongHighlight);
      CSS.highlights.set('keyflow-current',this.currentHighlight);
      this.container.classList.remove('marker-fallback');
    }else{
      this.container.classList.add('marker-fallback');
    }
    this._syncCurrent(null,0);
  }

  _clearHighlights(){
    if(typeof CSS!=='undefined' && CSS.highlights){
      CSS.highlights.delete('keyflow-correct');
      CSS.highlights.delete('keyflow-wrong');
      CSS.highlights.delete('keyflow-current');
    }
    this.correctHighlight=null; this.wrongHighlight=null; this.currentHighlight=null;
  }

  _rangeFor(index){
    if(!this.textNode || index<0 || index>=this.chars.length) return null;
    const range=document.createRange();
    range.setStart(this.textNode,this.offsets[index]);
    range.setEnd(this.textNode,this.offsets[index+1]);
    return range;
  }

  _removeStatus(index){
    const hadStatus=this.statuses[index]!==0;
    if(this.statuses[index]===2)this.unresolvedErrors=Math.max(0,this.unresolvedErrors-1);
    const range=this.statusRanges?.[index];
    if(range && this.useHighlights){
      this.correctHighlight?.delete(range);
      this.wrongHighlight?.delete(range);
    }
    this.statusRanges[index]=null;
    this.statuses[index]=0;
    if(hadStatus){this.markerLayer?.querySelector(`[data-status-index="${index}"]`)?.remove(); if(!this.useHighlights && this.container)this._queueMarkerPaint();}
  }

  _invalidateMarkers(){
    // A layout reflow changes Range rectangles (especially across RTL lines).
    // Existing absolute positions must be dropped and measured on the next frame.
    this.markerLayer?.replaceChildren();
    this._queueMarkerPaint();
  }

  start(){
    if(this.active) return;
    this.active=true;
    document.addEventListener('keydown',this._boundKey,{capture:true,passive:false});
    this._tickTimer=setInterval(()=>{if(this.startedAt && !this.paused && !this.finished) this._emitProgress();},500);
    this.dispatchEvent(new CustomEvent('state',{detail:{active:true}}));
  }

  stop(){
    if(!this.active) return;
    this.active=false;
    clearInterval(this._tickTimer);
    this._tickTimer=null;
    document.removeEventListener('keydown',this._boundKey,{capture:true});
  }

  pause(reason='manual'){
    if(!this.active || this.finished || this.paused) return;
    const nowPerf=performance.now();
    this.paused=true;
    this.pausedAt=Date.now();
    this.pauseStartedPerf=nowPerf;
    // A window blur before the first typed key must never be subtracted from
    // a session that has not started yet. This was the root cause of the
    // million-WPM completion bug in older builds.
    if(this.startedAt && this.activeSegmentStartedPerf){
      this.activeElapsedMs += Math.max(0,nowPerf-this.activeSegmentStartedPerf);
      this.activeSegmentStartedPerf=0;
    }
    this.dispatchEvent(new CustomEvent('pause',{detail:{reason}}));
  }

  resume(){
    if(this.finished) return;
    if(this.pausedAt && this.startedAt) this.totalPausedMs += Math.max(0, Date.now()-this.pausedAt);
    this.pausedAt=0;
    this.pauseStartedPerf=0;
    this.paused=false;
    if(this.startedAt) this.activeSegmentStartedPerf=performance.now();
    // Ignore the first rhythm interval after a pause; waiting to resume is not
    // a finger-speed sample.
    this.lastKeyAt=0;
    this.dispatchEvent(new Event('resume'));
  }

  _activeDuration(nowPerf=performance.now()){
    if(!this.startedAt) return 0;
    return Math.max(0,this.activeElapsedMs + (!this.paused && this.activeSegmentStartedPerf ? nowPerf-this.activeSegmentStartedPerf : 0));
  }

  destroy(){
    this.stop();clearInterval(this._tickTimer);
    cancelAnimationFrame(this._raf);cancelAnimationFrame(this._scrollRaf);cancelAnimationFrame(this._markerRaf);
    this._resizeObserver?.disconnect();
    this.container?.removeEventListener('wheel',this._manualWheel);
    this.container?.removeEventListener('touchmove',this._manualWheel);
    if(typeof window!=='undefined'){
      window.removeEventListener('scroll',this._onAnyScroll,true);
      window.removeEventListener('resize',this._onContainerResize);
    }
    this.markerLayer?.remove();
    this.markerLayer=null;
    this._clearHighlights();
  }

  _onKey(event){
    if(!this.active || this.finished || this.paused || isEditableTarget(event.target)) return;
    if(event.isComposing || event.key==='Process' || event.repeat) return;
    if(event.metaKey) return;
    if(event.ctrlKey && !event.getModifierState?.('AltGraph')) return;
    if(event.altKey && !event.getModifierState?.('AltGraph')) return;

    if(event.key==='Escape') return;
    if(event.key==='Backspace'){
      event.preventDefault();
      this._backspace();
      return;
    }
    if(event.key==='Tab' || event.key==='Enter'){
      if(this.chars[this.index] !== '\n' && this.chars[this.index] !== '\t') return;
    }
    // Accept exactly one printable grapheme. Named keys (F1, Dead, Insert,
    // arrows, etc.) must never be consumed as typing attempts.
    if(event.key !== 'Enter' && event.key !== 'Tab' && graphemes(event.key,this.language).length!==1) return;
    if(event.key==='Dead' || /[\x00-\x1F\x7F]/u.test(event.key)) return;

    const raw = event.key === 'Enter' ? '\n' : event.key === 'Tab' ? '\t' : event.key;
    if(!raw) return;
    event.preventDefault();

    const now=performance.now();
    const eventStamp=Number(event.timeStamp);
    const inputDelay=Number.isFinite(eventStamp) && eventStamp>0 && eventStamp<=now+5 ? Math.max(0,now-eventStamp) : 0;
    if(inputDelay<2000) this._delayWindow.push(inputDelay);

    if(!this.startedAt){
      this.startedAt=Date.now();
      this.activeElapsedMs=0;
      this.activeSegmentStartedPerf=now;
      this.lastKeyAt=0;
    }
    const interval=this.lastKeyAt ? now-this.lastKeyAt : 0;
    this.lastKeyAt=now;
    if(interval>0 && interval<5000){ this.intervals.push(interval); this._intervalWindow.push(interval); }

    const expected=this.chars[this.index];
    if(expected == null) return;
    const actual=normalizeForComparison(raw,this.language);
    const expectedNorm=normalizeForComparison(expected,this.language);
    const correct=actual===expectedNorm;

    // Learn the user's real XKB mapping from the event itself. No localStorage,
    // database, network, model, or layout probing is done on this hot path.
    try{this.mapper?.observe(event,actual,this.language);}catch(error){console.warn('Keyboard mapping observation failed:',error);}

    this.events.push({
      type:'key', t:now, at:Date.now(), index:this.index,
      key:actual, expected:expectedNorm, code:event.code, correct, interval,
      inputDelay, shift:!!event.shiftKey, altGraph:event.getModifierState?.('AltGraph')||false
    });
    this.dispatchEvent(new CustomEvent('attempt',{detail:{index:this.index,total:this.chars.length,correct}}));
    this._recordKey(expectedNorm,correct,interval);
    if(this.lastExpected) this._recordPair(this.lastExpected+expectedNorm,correct,interval);
    this.lastExpected=expectedNorm;

    const current=this.index;
    if(correct){
      this.correct+=1;
      this.currentStreak+=1;
      this.bestStreak=Math.max(this.bestStreak,this.currentStreak);
      this.index+=1;
    } else {
      this.errors+=1;
      this.currentStreak=0;
      if(!this.strictAccuracy) this.index+=1;
    }
    this._mark(current,correct);
    const isBoundary=correct && (expectedNorm===' ' || expectedNorm==='\n' || expectedNorm==='\t');
    this._feedback(correct?(isBoundary?'word':'key'):'error',{character:expectedNorm,index:current});
    this._syncCurrent(current,this.index);
    this._emitProgress();

    if(this.index>=this.chars.length) this._finish();
  }

  _backspace(){
    if(this.index<=0) return;
    const previous=this.index-1;
    this.index=previous;
    this.backspaces+=1;
    this.currentStreak=0;
    this.lastExpected=previous>0?normalizeForComparison(this.chars[previous-1],this.language):'';
    this._removeStatus(previous);
    this.events.push({type:'backspace',at:Date.now(),index:previous});
    this._feedback('delete',{character:'Backspace',index:previous});
    this._syncCurrent(previous+1,previous);
    this._emitProgress();
  }

  _mark(index,correct){
    this._removeStatus(index);
    this.statuses[index]=correct?1:2;
    if(!correct)this.unresolvedErrors+=1;
    // Persian correct keys only need the progress rail; avoid allocating a
    // Range (and retaining its DOM references) for every correct character.
    if(correct && this.language==='fa')return;
    const range=this._rangeFor(index);
    if(!range) return;
    this.statusRanges[index]=range;
    if(this.useHighlights){
      (correct?this.correctHighlight:this.wrongHighlight)?.add(range);
    }else{
      // Persian safe renderer: correct keys are represented by the lightweight
      // progress rail instead of accumulating one positioned DOM node per
      // character.  Only mistakes need persistent geometry.  This cuts the
      // common correct-key path from two synchronous layout reads to one (the
      // moving current marker) and prevents long sessions from building
      // hundreds of marker elements.
      if(this.language==='fa' && correct) return;
      // Avoid layout reads in keydown. Paint only the most recent error marks;
      // old mistakes remain in session statistics even when their markers age out.
      if(!correct) this._queueMarkerPaint();
    }
  }

  _syncCurrent(previous,next){
    // Schedule scrolling FIRST so the following marker paint measures the
    // final scroll position in this frame; this prevents a one-frame flash
    // of the caret at the bottom edge of the viewport.
    if(this.followCursor)this._scheduleScroll(next);
    if(this.useHighlights){
      this.currentHighlight?.clear();
      const range=this._rangeFor(next);
      if(range) this.currentHighlight?.add(range);
    }else{
      this._queueMarkerPaint();
    }
    const expected=this.chars[next] ?? '';
    this.dispatchEvent(new CustomEvent('next',{detail:{index:next,character:expected,hint:this.mapper?.hintFor(expected,this.language)||null}}));
  }

  _queueMarkerPaint(){
    if(this.useHighlights || this._markerRaf || !this.container) return;
    this._markerRaf=requestAnimationFrame(()=>{
      this._markerRaf=0;
      if(!this.container?.isConnected || !this.markerLayer?.isConnected)return;
      // Always measure the caret and overlay in the SAME viewport coordinate
      // system, with NO scrollTop arithmetic, transform or percentage heights.
      // Range rects already incorporate all nested scroll offsets and RTL flow.
      const host=this.container.getBoundingClientRect();
      const overlay=this.markerLayer;
      overlay.style.left=`${host.left}px`;
      overlay.style.top=`${host.top}px`;
      overlay.style.width=`${host.width}px`;
      overlay.style.height=`${host.height}px`;
      overlay.style.display=host.width>0 && host.height>0?'block':'none';
      if(!host.width || !host.height)return;

      const paint=(index,kind)=>{
        const range=this._rangeFor(index);
        if(!range)return;
        const fragments=[...range.getClientRects()];
        const rect=fragments.find(r=>r.height>0 && r.width>0) || range.getBoundingClientRect();
        if(!rect || !Number.isFinite(rect.left) || !Number.isFinite(rect.top))return;
        // Do not paint an offscreen caret at the viewport bottom: it is better
        // to wait one frame for scrolling than to show a false position.
        if(rect.bottom<=host.top+1 || rect.top>=host.bottom-1 || rect.right<=host.left || rect.left>=host.right)return;
        const marker=document.createElement('span');
        marker.className=`typing-marker ${kind}`;
        marker.dataset[`${kind==='current'?'current':'status'}Index`]=String(index);
        const left=Math.max(0,rect.left-host.left);
        const top=Math.max(0,rect.top-host.top);
        marker.style.left=`${left}px`;
        marker.style.top=`${top}px`;
        marker.style.width=`${Math.min(host.width-left,Math.max(2,rect.width))}px`;
        marker.style.height=`${Math.min(host.height-top,Math.max(12,rect.height))}px`;
        overlay.append(marker);
      };
      // Always repaint markers after scrolling, including old mistakes. The
      // view contains <= 12 error nodes and one current caret.
      overlay.replaceChildren();
      if(this.language==='fa'){
        let added=0;
        for(let i=this.index-1;i>=0&&added<12;i--){
          if(this.statuses[i]===2){paint(i,'wrong');added++;}
        }
      }else{
        for(let i=Math.max(0,this.index-48);i<this.index;i++){
          if(this.statuses[i]===2)paint(i,'wrong');
        }
      }
      paint(this.index,'current');
    });
  }

  _scheduleScroll(index,force=false){
    if(!this.container || (!force && !this.followCursor))return;
    this._pendingScrollIndex=index;
    this._scrollForced ||= force;
    if(this._scrollRaf)return; // coalesce all keys in a single animation frame
    this._scrollRaf=requestAnimationFrame(()=>{
      this._scrollRaf=0;
      const forced=this._scrollForced;this._scrollForced=false;
      if(!this.container?.isConnected || (!forced && !this.followCursor))return;
      if(this.container.scrollHeight<=this.container.clientHeight+1)return;
      const current=Math.min(this.chars.length-1,Math.max(0,this.index));
      // At end, the last grapheme still has a nonempty range.
      const range=this._rangeFor(current);
      let caret=range?.getBoundingClientRect();
      if(!caret || (!caret.width && !caret.height)){
        const near=this._rangeFor(Math.max(0,current-1));
        caret=near?.getBoundingClientRect();
      }
      const host=this.container.getBoundingClientRect();
      if(!caret)return;
      const desired=cursorScrollTarget({
        scrollTop:this.container.scrollTop,
        scrollHeight:this.container.scrollHeight,
        clientHeight:this.container.clientHeight,
        viewTop:host.top,viewBottom:host.bottom,
        caretTop:caret.top,caretBottom:caret.bottom
      });
      if(Math.abs(desired-this.container.scrollTop)>.7){
        this.container.scrollTop=desired;
        if(!this.useHighlights)this._queueMarkerPaint();
      }
    });
  }

  _feedback(kind,detail={}){
    try{this.onFeedback(kind,detail);}catch(error){console.warn('Feedback engine failed without stopping typing:',error);}
  }

  finishSprint(){
    if(!this.active || this.finished || !this.startedAt || this.events.filter(x=>x.type==='key').length<2)return false;
    this.completionReason='sprint';
    this._finish();
    return true;
  }

  _recordKey(ch,correct,interval){
    const x=this.keyStats[ch] ||= {hits:0,errors:0,latencyTotal:0,latencyCount:0};
    x.hits+=1; if(!correct) x.errors+=1;
    if(interval>0&&interval<5000){x.latencyTotal+=interval;x.latencyCount+=1;}
  }

  _recordPair(pair,correct,interval){
    const x=this.pairStats[pair] ||= {hits:0,errors:0,latencyTotal:0,latencyCount:0};
    x.hits+=1; if(!correct) x.errors+=1;
    if(interval>0&&interval<5000){x.latencyTotal+=interval;x.latencyCount+=1;}
  }

  _emitProgress(){
    if(this._raf) return;
    this._raf=requestAnimationFrame(()=>{
      this._raf=0;
      const elapsed=Math.max(0,this._activeDuration(performance.now()));
      const minutes=elapsed>0?elapsed/60000:0;
      const typed=this.correct+this.errors;
      this.dispatchEvent(new CustomEvent('progress',{detail:{
        index:this.index,
        total:this.chars.length,
        correct:this.correct,
        errors:this.errors,
        currentStreak:this.currentStreak,
        bestStreak:this.bestStreak,
        backspaces:this.backspaces,
        // Keep the live headline quiet until there is enough active time to be
        // meaningful.  Net WPM uses the same uncorrected-error penalty as the
        // final session summary, while burst pace remains a separate metric.
        wpm:(minutes && typed>=12 && elapsed>=2500) ? Math.min(350,Math.max(0,((this.index/5)-this.unresolvedErrors)/minutes)) : 0,
        burstWpm:this._intervalWindow.mean()>0 ? Math.min(350,12000/this._intervalWindow.mean()) : 0,
        accuracy:typed ? this.correct/typed*100 : 100,
        consistency:this._intervalWindow.consistency(),
        inputDelayAvg:this._delayWindow.mean(),
        inputDelayP95:this._delayWindow.p95(),
        elapsed
      }}));
    });
  }

  _finish(){
    this.finished=true;
    this.stop();
    const endedAt=Date.now();
    const nowPerf=performance.now();
    const activeDurationMs=this._activeDuration(nowPerf);
    if(this.activeSegmentStartedPerf){
      this.activeElapsedMs=activeDurationMs;
      this.activeSegmentStartedPerf=0;
    }
    const session={
      id:newSessionId(),
      startedAt:this.startedAt||endedAt,
      endedAt,
      language:this.language,
      textId:this.metadata.id||null,
      title:this.metadata.title||'',
      completionReason:this.completionReason,
      text:this.target,
      textLength:this.chars.length,
      completedChars:this.index,
      events:this.events,
      intervals:this.intervals,
      keyStats:this.keyStats,
      pairStats:this.pairStats,
      bestCleanStreak:this.bestStreak,
      unresolvedErrors:this.statuses.reduce((n,value)=>n+(value===2?1:0),0),
      backspaces:this.backspaces,
      pausedMs:this.totalPausedMs,
      activeDurationMs,
      inputDelay:{avg:this._delayWindow.mean(),p95:this._delayWindow.p95()}
    };
    session.summary=calculateSessionSummary(session);
    this._feedback('complete');
    this.dispatchEvent(new CustomEvent('finish',{detail:session}));
  }
}

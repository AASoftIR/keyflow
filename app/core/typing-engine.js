import { graphemes, normalizeForComparison } from './normalization.js';
import { calculateSessionSummary } from './stats.js';
import { cursorScrollTarget } from './viewport.js';

export const isEditableTarget = target => {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return ['input','textarea','button','select','option','a','summary'].includes(tag) || !!target.isContentEditable || !!target.closest?.('[role=button],[data-ignore-practice]');
};

const clamp = (v,min,max)=>Math.min(max,Math.max(min,v));

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
    this._manualWheel=()=>{this.followCursor=false;this.dispatchEvent(new CustomEvent('followchange',{detail:{enabled:false,source:'manual'}}));};
    this._onContainerResize=()=>this.scrollToCurrent();
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
    this.currentStreak=0;
    this.bestStreak=0;
    this.backspaces=0;
    this.intervals=[];
    this.events=[];
    this.keyStats={};
    this.pairStats={};
    this.lastExpected='';
    this.finished=false;
    this._intervalWindow.clear();
    this._delayWindow.clear();
  }

  setText(text,metadata={}){
    const wasActive=this.active;
    this.stop();
    this.reset(text,metadata);
    this.render();
    if(wasActive) this.start();
  }

  mount(container){
    if(this.container){this.container.removeEventListener('wheel',this._manualWheel);this.container.removeEventListener('touchmove',this._manualWheel);}
    this.container=container;
    this.container.addEventListener('wheel',this._manualWheel,{passive:true});
    this.container.addEventListener('touchmove',this._manualWheel,{passive:true});
    this.render();
    this.start();
    if(typeof ResizeObserver!=='undefined'){
      this._resizeObserver=new ResizeObserver(()=>this.scrollToCurrent());
      this._resizeObserver.observe(container);
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
    this.container.replaceChildren();
    this.container.lang=this.language==='fa'?'fa':'en';
    this.container.dir=this.language==='fa'?'rtl':'ltr';
    this.container.classList.toggle('shaped-persian',this.language==='fa');

    // Persian/Arabic cursive shaping is extremely sensitive to paint-run
    // boundaries in WebKitGTK.  Keep the visible passage in ONE plain text node
    // inside one block and never use CSS Custom Highlights for Persian.  State
    // is painted by a separate geometric underlay, so the glyph run itself is
    // never recolored, split, transformed, or reshaped while typing.
    this.markerLayer=document.createElement('div');
    this.markerLayer.className='typing-marker-layer';
    this.markerLayer.setAttribute('aria-hidden','true');
    this.container.append(this.markerLayer);

    this.glyphLayer=document.createElement('div');
    this.glyphLayer.className='typing-glyph-layer';
    this.glyphLayer.lang=this.language==='fa'?'fa':'en';
    this.glyphLayer.dir=this.language==='fa'?'rtl':'ltr';
    this.textNode=document.createTextNode(this.target);
    this.glyphLayer.append(this.textNode);
    this.container.append(this.glyphLayer);

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
    const range=this.statusRanges?.[index];
    if(range && this.useHighlights){
      this.correctHighlight?.delete(range);
      this.wrongHighlight?.delete(range);
    }
    this.statusRanges[index]=null;
    this.statuses[index]=0;
    if(hadStatus) this.markerLayer?.querySelector(`[data-status-index="${index}"]`)?.remove();
  }

  _drawMarker(index,kind){
    if(!this.markerLayer) return;
    this.markerLayer.querySelector(`[data-${kind}-index]`)?.remove();
    const range=this._rangeFor(index);
    const rect=range?.getBoundingClientRect();
    const host=this.container.getBoundingClientRect();
    if(!rect || (!rect.width && !rect.height)) return;
    const marker=document.createElement('span');
    marker.className=`typing-marker ${kind}`;
    marker.dataset[`${kind}Index`]=String(index);
    marker.style.left=`${rect.left-host.left+this.container.scrollLeft}px`;
    marker.style.top=`${rect.top-host.top+this.container.scrollTop}px`;
    marker.style.width=`${Math.max(2,rect.width)}px`;
    marker.style.height=`${Math.max(18,rect.height)}px`;
    this.markerLayer.append(marker);
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
    if(event.key.length > 2 && event.key !== 'Enter') return;

    const raw = event.key === 'Enter' ? '\n' : event.key;
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
    this.mapper?.observe(event,actual,this.language);

    this.events.push({
      type:'key', t:now, at:Date.now(), index:this.index,
      key:actual, expected:expectedNorm, code:event.code, correct, interval,
      inputDelay, shift:!!event.shiftKey, altGraph:event.getModifierState?.('AltGraph')||false
    });
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
    if(!correct) this.onFeedback('error',{character:expectedNorm,index:current});
    else if(expectedNorm===' ' || expectedNorm==='\n' || expectedNorm==='\t') this.onFeedback('word',{character:expectedNorm,index:current});
    else this.onFeedback('key',{character:expectedNorm,index:current});
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
    this.onFeedback('delete',{character:'Backspace',index:previous});
    this._syncCurrent(previous+1,previous);
    this._emitProgress();
  }

  _mark(index,correct){
    this._removeStatus(index);
    this.statuses[index]=correct?1:2;
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
    if(this.useHighlights){
      this.currentHighlight?.clear();
      const range=this._rangeFor(next);
      if(range) this.currentHighlight?.add(range);
    }else{
      this._queueMarkerPaint();
    }
    // RTL lines have variable widths; character-count scroll thresholds were
    // fundamentally incorrect. Track the caret once per paint frame instead.
    if(this.followCursor)this._scheduleScroll(next);
    const expected=this.chars[next] ?? '';
    this.dispatchEvent(new CustomEvent('next',{detail:{index:next,character:expected,hint:this.mapper?.hintFor(expected,this.language)||null}}));
  }

  _queueMarkerPaint(){
    if(this.useHighlights || this._markerRaf || !this.container) return;
    this._markerRaf=requestAnimationFrame(()=>{
      this._markerRaf=0;
      if(!this.container?.isConnected)return;
      const host=this.container.getBoundingClientRect();
      const paint=(index,kind)=>{
        const rect=this._rangeFor(index)?.getBoundingClientRect();
        if(!rect || (!rect.width && !rect.height))return;
        const marker=document.createElement('span');
        marker.className=`typing-marker ${kind}`;
        marker.dataset[`${kind==='current'?'current':'status'}Index`]=String(index);
        marker.style.left=`${rect.left-host.left+this.container.scrollLeft}px`;
        marker.style.top=`${rect.top-host.top+this.container.scrollTop}px`;
        marker.style.width=`${Math.max(2,rect.width)}px`;
        marker.style.height=`${Math.max(18,rect.height)}px`;
        this.markerLayer?.append(marker);
      };
      this.markerLayer?.querySelector('[data-current-index]')?.remove();
      // Old errors are not interactive; keeping only 24 saves layout work.
      const marked=this.markerLayer?.querySelectorAll('[data-status-index]')||[];
      if(marked.length>24) for(const node of [...marked].slice(0,marked.length-24)) node.remove();
      for(let i=Math.max(0,this.index-2);i<this.index+1;i++){
        if(this.statuses[i]===2 && !this.markerLayer?.querySelector(`[data-status-index="${i}"]`)) paint(i,'wrong');
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
        wpm:(minutes && typed>=12 && elapsed>=2500) ? Math.min(350,Math.max(0,((typed/5)-this.errors)/minutes)) : 0,
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
      id:crypto.randomUUID(),
      startedAt:this.startedAt||endedAt,
      endedAt,
      language:this.language,
      textId:this.metadata.id||null,
      title:this.metadata.title||'',
      text:this.target,
      textLength:this.chars.length,
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
    this.onFeedback('complete');
    this.dispatchEvent(new CustomEvent('finish',{detail:session}));
  }
}

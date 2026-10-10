// Scrolling policy is deliberately DOM independent so it can be exercised in
// both Node and real Chromium/WebKit harnesses. All coordinates are CSS pixels.
export function cursorScrollTarget({scrollTop=0,scrollHeight=0,clientHeight=0,viewTop=0,viewBottom=0,caretTop=0,caretBottom=0}={}) {
  const current = Number.isFinite(scrollTop) ? scrollTop : 0;
  const max = Math.max(0,scrollHeight-clientHeight);
  if (!Number.isFinite(caretTop) || !Number.isFinite(caretBottom) || clientHeight <= 0 || max<=0) return Math.max(0,Math.min(max,current));
  const height = Math.max(1,viewBottom-viewTop);
  const upper = viewTop + height*.17;
  const lower = viewTop + height*.68;
  let next=current;
  if (caretBottom > lower) next += caretBottom - lower;
  else if (caretTop < upper) next += caretTop - upper;
  return Math.max(0,Math.min(max,next));
}

export function segmentForCursor(index,total,segmentSize=160) {
  const count=Math.max(1,Math.ceil(Math.max(0,total)/segmentSize));
  const section=Math.min(count,Math.max(1,Math.floor(Math.max(0,index)/segmentSize)+1));
  return {section,count,progress:total?Math.min(100,Math.round(index/total*100)):0};
}

export function typingFontScale(value) {
  const n=Number(value);
  return Number.isFinite(n)?Math.max(.8,Math.min(1.55,Math.round(n*20)/20)):1;
}

function sizeCanvas(canvas){
  const rect=canvas.getBoundingClientRect();
  const dpr=Math.min(devicePixelRatio||1,2);
  const w=Math.max(1,Math.floor(rect.width*dpr)), h=Math.max(1,Math.floor(rect.height*dpr));
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
  return {ctx:canvas.getContext('2d'),w,h,dpr};
}

export function drawLineChart(canvas,points,{valueKey='wpm',label='WPM'}={}){
  const {ctx,w,h,dpr}=sizeCanvas(canvas); ctx.clearRect(0,0,w,h);
  const pad={l:42*dpr,r:14*dpr,t:16*dpr,b:28*dpr};
  const innerW=w-pad.l-pad.r,innerH=h-pad.t-pad.b;
  const values=points.map(p=>Number(p[valueKey])||0);
  const max=Math.max(10,...values)*1.15,min=0;
  const css=getComputedStyle(canvas); const grid=css.getPropertyValue('--chart-grid').trim()||'#282828'; const line=css.getPropertyValue('--chart-line').trim()||'#f1f1f1'; const text=css.getPropertyValue('--chart-text').trim()||'#777';
  ctx.lineWidth=1*dpr;ctx.strokeStyle=grid;ctx.fillStyle=text;ctx.font=`${10*dpr}px system-ui`;
  for(let i=0;i<=4;i++){
    const y=pad.t+innerH*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();
    const v=max-(max-min)*i/4;ctx.fillText(String(Math.round(v)),4*dpr,y+3*dpr);
  }
  if(points.length<2){ctx.fillText(points.length?'One session so far':'Complete a session to draw this chart',pad.l,pad.t+innerH/2);return;}
  const x=i=>pad.l+innerW*i/(points.length-1); const y=v=>pad.t+innerH-(v-min)/(max-min)*innerH;
  ctx.strokeStyle=line;ctx.lineWidth=2*dpr;ctx.lineJoin='round';ctx.lineCap='round';ctx.beginPath();
  values.forEach((v,i)=>{const px=x(i),py=y(v);i?ctx.lineTo(px,py):ctx.moveTo(px,py);});ctx.stroke();
  ctx.fillStyle=text; const step=Math.max(1,Math.ceil(points.length/5));
  points.forEach((p,i)=>{if(i%step===0||i===points.length-1){const labelText=(p.date||'').slice(5);ctx.fillText(labelText,x(i)-12*dpr,h-7*dpr);}});
}

export function drawBars(canvas,items,{valueKey='value',labelKey='label'}={}){
  const {ctx,w,h,dpr}=sizeCanvas(canvas);ctx.clearRect(0,0,w,h);
  const css=getComputedStyle(canvas);const grid=css.getPropertyValue('--chart-grid').trim()||'#282828';const line=css.getPropertyValue('--chart-line').trim()||'#f1f1f1';const text=css.getPropertyValue('--chart-text').trim()||'#777';
  const max=Math.max(1,...items.map(x=>Number(x[valueKey])||0)); const gap=10*dpr; const left=90*dpr; const row=(h-18*dpr)/Math.max(1,items.length);
  ctx.font=`${10*dpr}px system-ui`;
  items.forEach((item,i)=>{
    const y=8*dpr+i*row; const barH=Math.max(5*dpr,row-8*dpr); const v=Number(item[valueKey])||0;
    ctx.fillStyle=text;ctx.fillText(String(item[labelKey]??''),4*dpr,y+barH*.75);
    ctx.fillStyle=grid;ctx.fillRect(left,y,w-left-10*dpr,barH);
    ctx.fillStyle=line;ctx.fillRect(left,y,(w-left-10*dpr)*(v/max),barH);
  });
}

export class FatigueRadar {
  constructor(){this.buffer=[];this.count=0;}
  observe({correct=true,interval=0}={}){
    this.buffer.push({correct:!!correct,interval:Number(interval)||0});this.count++;
    if(this.buffer.length>96)this.buffer.shift();
    return this.count%8===0?this.status():null;
  }
  status(){
    if(this.buffer.length<48)return {level:'building',message:'Learning your natural pace'};
    const before=this.buffer.slice(0,-24),recent=this.buffer.slice(-24);
    const errors=arr=>arr.filter(x=>!x.correct).length/arr.length;
    const pace=arr=>{const ms=arr.map(x=>x.interval).filter(x=>x>=60&&x<=1800).sort((a,b)=>a-b);return ms.length?ms[Math.floor(ms.length/2)]:0;};
    const oldError=errors(before),nowError=errors(recent),oldPace=pace(before),nowPace=pace(recent);
    const pressure=nowError>=.17 && nowError>oldError+.07;
    const slowing=oldPace>80 && nowPace>oldPace*1.55;
    if(pressure&&slowing)return {level:'high',message:'More errors and slower keys—consider a short break',errors:nowError};
    if(pressure||slowing)return {level:'medium',message:pressure?'Accuracy is slipping: ease the pace':'Keys are slowing: loosen your hands',errors:nowError};
    return {level:'good',message:'Pace and accuracy look steady',errors:nowError};
  }
}

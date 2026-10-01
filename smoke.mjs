import fs from 'node:fs';
import vm from 'node:vm';

const ids = ['status','statusBox','loading','price','ohlc','chg','hl','updated','chartNote','sig','score','meter','ema20','ema50','ema200','rsi','macd','bb','atr','stoch','adx','sma20','cci','will','obv','sourceInfo','chart','reload'];
const elements = new Map(ids.map(id => [id, {
  id, textContent:'', style:{display:'',width:''}, className:'',
  classList:{remove(){},add(){}}, addEventListener(){}, clientWidth:900, clientHeight:500,
  getContext(){ return { setTransform(){}, clearRect(){}, beginPath(){}, moveTo(){}, lineTo(){}, stroke(){}, fillRect(){}, fillText(){}, setLineDash(){},
    font:'', textAlign:'', strokeStyle:'', fillStyle:'', lineWidth:1 }; }
}]));
const buttons = Array.from({length:5}, (_,i)=>({addEventListener(){},dataset:{range:['1y','5y','1mo','5d','1d'][i],interval:['1d','1d','1h','15m','2m'][i]},classList:{remove(){},add(){}}}));
const document = {
  getElementById(id){ return elements.get(id); },
  querySelectorAll(sel){ return sel.includes('data-range') ? buttons : []; }
};
const window = {devicePixelRatio:1, addEventListener(){}};
const now = Date.now();
const points=[];
let price=4100;
for(let i=0;i<80;i++){
  const t=Math.floor((now-(80-i)*86400000)/1000);
  const o=price; const c=o+(i%3===0?8:-3); const h=Math.max(o,c)+5; const l=Math.min(o,c)-5;
  points.push({t,o,h,l,c,v:1000+i}); price=c;
}
const spot={spot_usd_oz:price+2, updated_at:new Date().toISOString(), data_state:{status:'fresh',as_of:new Date().toISOString(),source:'upstream',age_seconds:0}};
const chart={points, updated_at:new Date().toISOString(), data_state:{status:'fresh',as_of:new Date().toISOString(),source:'cache',age_seconds:0}};
const context={document,window,fetch:async url=>({ok:true,status:200,async json(){return String(url).includes('/spot')?spot:chart;}}),setInterval(){},Date,console};
vm.createContext(context);
const code=fs.readFileSync('/tmp/gold_audit/assets/app.js','utf8');
vm.runInContext(code,context);
await new Promise(r=>setTimeout(r,30));
const checks={price:elements.get('price').textContent,sig:elements.get('sig').textContent,score:elements.get('score').textContent,obv:elements.get('obv').textContent,status:elements.get('status').textContent};
for(const [k,v] of Object.entries(checks)) if(!v) throw new Error(`empty ${k}`);
console.log('runtime smoke: PASS', checks);

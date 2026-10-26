const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
let wsUrl=null;
for(let i=0;i<30;i++){try{const r=await fetch('http://127.0.0.1:9261/json/list');const l=await r.json();const p=l.find(x=>x.type==='page');if(p){wsUrl=p.webSocketDebuggerUrl;break;}}catch(e){}await sleep(300);}
const ws=new WebSocket(wsUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws'));setTimeout(()=>rej(new Error('t')),8000);});
let id=0;const pending=new Map();
ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
const send=(m,p)=>new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});
const ev=async(e)=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});return r.result&&r.result.result?r.result.result.value:null;};
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:2,mobile:true});
await sleep(500);
const DETECT=(W)=>`(() => {
  const vw = ${W};
  const res = { vw, docW: document.documentElement.scrollWidth, off: 0, clip: 0 };
  const inScrollable = (el) => { let p = el.parentElement; while (p && p !== document.body) { const cs = getComputedStyle(p); if ((cs.overflowX==='auto'||cs.overflowX==='scroll') && p.scrollWidth > p.clientWidth + 2) return true; if (cs.transform && cs.transform !== 'none') return true; p = p.parentElement; } return false; };
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    if (inScrollable(el)) continue;
    if (r.right > vw + 2 || r.left < -2) res.off++;
    if (!el.children.length && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) { if ((el.textContent||'').trim()) res.clip++; }
  }
  return JSON.stringify(res);
})()`;
console.log('BASELINE ' + await ev(DETECT(390)));
await ev("(function(){var d=document.createElement('div');d.id='__t';d.style.cssText='position:absolute;top:40px;left:0;width:510px;height:40px;background:red;';document.body.appendChild(d);return 1;})()");
await sleep(250);
console.log('AFTER_OVERFLOW ' + await ev(DETECT(390)));
await ev("(function(){var a=document.getElementById('__t');if(a)a.remove();return 1;})()");
await sleep(200);
console.log('AFTER_CLEAN ' + await ev(DETECT(390)));
process.exit(0);
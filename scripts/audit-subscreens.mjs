const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [[320,568],[390,844],[768,1024]];
const THEMES = ['light','dark'];
const SCREENS = [
  { name:'帮助与反馈', row:'帮助与反馈', expect:['反馈','帮助'] },
  { name:'关于应用',   row:'关于应用',   expect:['版本','关于'] },
  { name:'财务规划',   row:'财务规划',   expect:['规划','计划','贷款','复利'] },
  { name:'概览模式',   row:'概览模式',   expect:['概览','净资产','收支'] },
  { name:'AI 专区',    row:'AI 专区',    expect:['AI'] },
  { name:'记一笔',     plus:true,       expect:['记一笔','扫票'] },
];

const AUDIT = `(() => {
  const vw = __W__;
  const res = { vw, docW: document.documentElement.scrollWidth, active: null, off: [], clip: [], tab: null };
  // 当前激活的 tab 场景（TabSceneDisplayGate 有 testID）
  // 5 个 tab 场景同时挂载，非活跃的 display:none —— 必须取「可见」的那个
  const gates = Array.from(document.querySelectorAll('[data-testid^="tab-scene-"]'));
  const visible = gates.find((g) => { const st = getComputedStyle(g); return st.display !== 'none' && st.visibility !== 'hidden' && g.getBoundingClientRect().height > 50; });
  if (visible) res.active = visible.getAttribute('data-testid');
  const inScrollable = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body) {
      const cs = getComputedStyle(p);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 2) return true;
      if (cs.transform && cs.transform !== 'none') return true;
      p = p.parentElement;
    }
    return false;
  };
  const els = Array.from(document.querySelectorAll('*'));
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    if (inScrollable(el)) continue;
    if (r.right > vw + 2 || r.left < -2) {
      res.off.push({ tag: el.tagName, right: Math.round(r.right), left: Math.round(r.left), w: Math.round(r.width), t: (el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,30) });
    }
    if (!el.children.length && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 2) {
      const t = (el.textContent||'').trim().slice(0,30);
      if (t) res.clip.push({ t, sw: el.scrollWidth, cw: el.clientWidth, ovx: cs.overflowX, ell: cs.textOverflow });
    }
  }
  const plus = els.find((e) => { const a = (e.getAttribute && e.getAttribute('aria-label')) || ''; const r = e.getBoundingClientRect(); return /add|plus|记一笔|新增/i.test(a) && r.width > 30 && r.width < 110 && r.top > window.innerHeight * 0.6; });
  if (plus) { const r = plus.getBoundingClientRect(); res.tab = { delta: Math.round(r.left + r.width/2 - vw/2) }; }
  const dedupe = (arr, key) => { const s = new Set(); return arr.filter((o) => { const k = key(o); if (s.has(k)) return false; s.add(k); return true; }).slice(0, 8); };
  res.off = dedupe(res.off, (o) => o.tag + o.left + o.right + o.t);
  res.clip = dedupe(res.clip, (c) => c.t);
  return JSON.stringify(res);
})()`;





const lr = await fetch('http://localhost:8080/api/auth/login', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ email:'mingsoon249@gmail.com', password:'12345678' }) });
const lj = await lr.json();
const session = { tokens: { accessToken: lj.accessToken, refreshToken: lj.refreshToken, expiresAt: Date.now()+86400000 }, user: lj.user };
let wsUrl=null;
for (let i=0;i<40;i++){ try{ const r=await fetch('http://127.0.0.1:9261/json/list'); const l=await r.json(); const p=l.find(x=>x.type==='page'); if(p){wsUrl=p.webSocketDebuggerUrl;break;} }catch(e){} await sleep(300); }
const ws=new WebSocket(wsUrl);
await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=()=>rej(new Error('ws'));setTimeout(()=>rej(new Error('t')),8000);});
let id=0;const pending=new Map();
ws.onmessage=(ev)=>{const m=JSON.parse(ev.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
const send=(m,p)=>new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});
const ev=async(e)=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});return r.result&&r.result.result?r.result.result.value:null;};
await send('Page.enable');await send('Runtime.enable');

const clickXY=async(x,y)=>{await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await sleep(60);await send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});};
const mark=async()=>String(await ev('(document.body.innerText||"").replace(/\\s+/g," ").slice(0,90)'));
const clickTab=async(label)=>{
  const raw=await ev('(function(){var T='+JSON.stringify(label)+';var vh=window.innerHeight;var h=Array.from(document.querySelectorAll("*")).filter(function(e){return (e.innerText||"").trim()===T;}).filter(function(e){var b=e.getBoundingClientRect();return b.width>10&&b.height>10&&b.width<170&&b.top>vh*0.55;});if(!h.length)return "miss";var b=h[h.length-1].getBoundingClientRect();return JSON.stringify({x:Math.round(b.left+b.width/2),y:Math.round(b.top+b.height/2)});})()');
  if(raw==='miss')return false; const p=JSON.parse(raw); await clickXY(p.x,p.y); return true;
};
const clickRow=async(label)=>{
  // 1) 找到最近的滚动容器并滚到可见
  const st=await ev('(function(){var T='+JSON.stringify(label)+';var h=Array.from(document.querySelectorAll("*")).filter(function(e){return (e.innerText||"").trim()===T;});if(!h.length)return "miss";var e=h[h.length-1];var cur=e.parentElement;while(cur){var cs=getComputedStyle(cur);if((cs.overflowY==="auto"||cs.overflowY==="scroll")&&cur.scrollHeight>cur.clientHeight+4){var er=e.getBoundingClientRect(), cr=cur.getBoundingClientRect();cur.scrollTop+= (er.top - cr.top) - cr.height/2;return "scrolled";}cur=cur.parentElement;}return "noscroll";})()');
  if(st==='miss')return false;
  await sleep(450);
  const raw=await ev('(function(){var T='+JSON.stringify(label)+';var h=Array.from(document.querySelectorAll("*")).filter(function(e){return (e.innerText||"").trim()===T;});if(!h.length)return "miss";var e=h[h.length-1];var cur=e;for(var i=0;i<6&&cur;i++){var b=cur.getBoundingClientRect();if(b.height>=30&&b.height<=140&&b.width>120)break;cur=cur.parentElement;}var tg=cur||e;var b2=tg.getBoundingClientRect();if(b2.top<50||b2.bottom>window.innerHeight-90)return "out:"+Math.round(b2.top);return JSON.stringify({x:Math.round(b2.left+b2.width/2),y:Math.round(b2.top+b2.height/2)});})()');
  if(raw==='miss'||raw.startsWith('out:'))return false;
  const p=JSON.parse(raw); await clickXY(p.x,p.y); return true;
};
const goBack=async()=>{ await clickXY(38,44); await sleep(1000); };

const rows=[];
for(const theme of THEMES){
  for(const [w,h] of SIZES){
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:2,mobile:true});
    await ev('localStorage.setItem("@jizhang/themeMode","'+theme+'")');
    await send('Page.navigate',{url:'http://localhost:8082/?s='+theme+w+Date.now()});
    await sleep(15000);
    await ev('localStorage.setItem("@jizhang/apiSession",'+JSON.stringify(JSON.stringify(session))+')');
    await ev('localStorage.setItem("@jizhang/language","zh")');
    await send('Page.navigate',{url:'http://localhost:8082/?s2='+theme+w+Date.now()});
    await sleep(14000);

    const bg = await ev('getComputedStyle(document.body).backgroundColor');

    for(const sc of SCREENS){
      let navigated=false;
      if(sc.plus){ await clickTab('记一笔'); navigated=true; }
      else { await clickTab('设置'); await sleep(1200); navigated = await clickRow(sc.row); }
      await sleep(1600);
      const m = await mark();
      const landed = sc.expect.some((k)=>m.includes(k)) && !m.startsWith('设置 ');
      const raw = await ev(AUDIT.replace('__W__', String(w)));
      let d=null; try{ d=JSON.parse(raw); }catch(e){}
      rows.push({theme,size:w+'x'+h,screen:sc.name,bg,landed,marker:m,d});
      // 回设置（点返回，若失败则回 Tab）
      await goBack();
      await clickTab('设置'); await sleep(600);
    }
  }
}

console.log('\n=== 结果（landed=false 表示没真正进入该页，结论无效）===');
let bad=0, total=0, notLanded=0;
for(const r of rows){
  total++;
  const over = r.d ? r.d.docW > r.d.vw+1 : true;
  const issues = r.d ? (r.d.off.length + r.d.clip.length) : -1;
  if(!r.landed) notLanded++;
  if(!r.landed || over || issues !== 0){
    bad++;
    console.log(('⚠ ' + r.theme).padEnd(9) + r.size.padEnd(9) + r.screen.padEnd(10)
      + 'landed=' + (r.landed?'Y':'N') + ' docW=' + (r.d?r.d.docW:'-') + '/' + (r.d?r.d.vw:'-')
      + ' off=' + (r.d?r.d.off.length:'-') + ' clip=' + (r.d?r.d.clip.length:'-'));
    if(r.d && r.d.off.length) r.d.off.slice(0,3).forEach(o=>console.log('     OFF '+o.tag+' ['+o.left+','+o.right+'] "'+o.t+'"'));
    if(r.d && r.d.clip.length) r.d.clip.slice(0,3).forEach(c=>console.log('     CLIP "'+c.t+'" sw='+c.sw+' cw='+c.cw));
  }
}
console.log('');
console.log('总计 '+total+' 组｜未进入页面 '+notLanded+' 组｜有问题 '+bad+' 组');
console.log('主题 bg 抽样: ' + JSON.stringify(rows.slice(0,1).concat(rows.filter(r=>r.theme==='dark').slice(0,1)).map(r=>({theme:r.theme,bg:r.bg}))));
console.log('\n=== 每屏落点（前 60 字符）===');
for(const r of rows) console.log('  '+r.theme.padEnd(5)+r.size.padEnd(9)+r.screen.padEnd(10)+' | '+(r.landed?'✓ ':'✗ ')+r.marker.slice(0,56));
process.exit(0);

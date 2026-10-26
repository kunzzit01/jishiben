const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SIZES = [[320,568],[360,640],[375,667],[390,844],[393,873],[412,915],[430,932],[600,960],[768,1024]];
const TABS = [['home',['首页','Home']],['assets',['资产','Assets']],['stats',['统计','Stats']],['settings',['设置','设置项','Settings']]];
const COMBOS = [
  { lang: 'en', theme: 'light' },
  { lang: 'zh', theme: 'light' },
  { lang: 'en', theme: 'dark'  },
  { lang: 'zh', theme: 'dark'  },
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



const lr = await fetch('http://localhost:8080/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'mingsoon249@gmail.com', password: '12345678' }) });
const lj = await lr.json();
const session = { tokens: { accessToken: lj.accessToken, refreshToken: lj.refreshToken, expiresAt: Date.now() + 86400000 }, user: lj.user };

let wsUrl = null;
for (let i = 0; i < 40; i++) { try { const r = await fetch('http://127.0.0.1:9261/json/list'); const l = await r.json(); const p = l.find((x) => x.type === 'page'); if (p) { wsUrl = p.webSocketDebuggerUrl; break; } } catch (e) {} await sleep(300); }
if (!wsUrl) { console.log('NO_CDP'); process.exit(1); }
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); setTimeout(() => rej(new Error('t')), 8000); });
let id = 0; const pending = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (m, p) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
const evalJs = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); return r.result && r.result.result ? r.result.result.value : null; };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });

const tapTab = async (labels) => {
  const raw = await evalJs('(function(){var L=' + JSON.stringify(labels) + ';var els=Array.from(document.querySelectorAll("*"));var vh=window.innerHeight;for(const lb of L){var h=els.filter(function(e){var t=(e.textContent||"").trim();if(t!==lb)return false;var r=e.getBoundingClientRect();return r.width>10&&r.height>10&&r.width<160&&r.top>vh*0.55;});if(h.length){var r2=h[h.length-1].getBoundingClientRect();return JSON.stringify({x:Math.round(r2.left+r2.width/2),y:Math.round(r2.top+r2.height/2)});}}return "miss";})()');
  if (raw === 'miss') return 'miss';
  const p = JSON.parse(raw);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(70);
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  return 'ok';
};

const summary = [];
for (const combo of COMBOS) {
  // 注入语言/主题后重载
  await send('Page.navigate', { url: 'http://localhost:8082/?c=' + Date.now() });
  await sleep(15000);
  await evalJs('localStorage.setItem("@jizhang/apiSession", ' + JSON.stringify(JSON.stringify(session)) + ')');
  await evalJs('localStorage.setItem("@jizhang/language", ' + JSON.stringify(combo.lang) + ')');
  await evalJs('localStorage.setItem("@jizhang/themeMode", ' + JSON.stringify(combo.theme) + ')');
  await send('Page.navigate', { url: 'http://localhost:8082/?c2=' + Date.now() });
  await sleep(16000);
  const applied = await evalJs('(function(){var bg=getComputedStyle(document.body).backgroundColor;var txt=(document.body.innerText||"").slice(0,60);return JSON.stringify({bg:bg,txt:txt});})()');
  console.log('COMBO ' + combo.lang + '/' + combo.theme + ' applied=' + applied);

  for (const [w, h] of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await sleep(1000);
    for (const [name, labels] of TABS) {
      const tap = await tapTab(labels);
      await sleep(1300);
      const raw = await evalJs(AUDIT.replace('__W__', String(w)));
      let d = null; try { d = JSON.parse(raw); } catch (e) {}
      summary.push({ combo: combo.lang + '/' + combo.theme, size: w + 'x' + h, name, tap, d });
    }
  }
}

console.log('\n=== 全量汇总（仅打印有问题的组合）===');
let bad = 0, total = 0;
for (const r of summary) {
  total++;
  if (!r.d) { console.log('NO_DATA ' + r.combo + ' ' + r.size + ' ' + r.name); bad++; continue; }
  const over = r.d.docW > r.d.vw + 1;
  const tabBad = r.d.tab && Math.abs(r.d.tab.delta) > 1;
  if (over || r.d.off.length || r.d.clip.length || tabBad) {
    bad++;
    console.log('⚠ ' + r.combo + ' ' + r.size.padEnd(9) + r.name.padEnd(9) + 'docW=' + r.d.docW + '/' + r.d.vw + ' off=' + r.d.off.length + ' clip=' + r.d.clip.length + (tabBad ? ' plusΔ=' + r.d.tab.delta : ''));
    if (over) console.log('    PAGE 溢出 ' + r.d.docW + '>' + r.d.vw);
    r.d.off.slice(0, 3).forEach((o) => console.log('    OFF ' + o.tag + ' [' + o.left + ',' + o.right + '] "' + o.t + '"'));
    r.d.clip.slice(0, 3).forEach((c) => console.log('    CLIP "' + c.t + '" sw=' + c.sw + ' cw=' + c.cw));
  }
}
console.log('\n总计 ' + total + ' 组，有问题 ' + bad + ' 组');
process.exit(0);

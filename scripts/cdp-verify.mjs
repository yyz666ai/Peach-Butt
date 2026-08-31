#!/usr/bin/env node
// CDP 视觉验证：连接运行中的桃屁屁渲染页面，执行 DOM 断言并截图
// 用法: node scripts/cdp-verify.mjs <viewName> [--shot /path/out.png]
const viewName = process.argv[2] || 'unknown';
const shotIdx = process.argv.indexOf('--shot');
const shotPath = shotIdx > -1 ? process.argv[shotIdx + 1] : null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const targets = await res.json();
  const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
  if (!page) throw new Error('no page target found');
  console.log('[target]', page.url);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, err) => { ws.onopen = ok; ws.onerror = err; });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  // 让页面先跑一会儿，视频进入稳定播放
  await sleep(4000);

  // 1) DOM 断言：接管层背景、取消按钮、视频状态
  const domProbe = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => {
      const r = {};
      const takeover = document.querySelector('.takeover, [class*="takeover"]');
      r.takeoverExists = !!takeover;
      if (takeover) {
        const cs = getComputedStyle(takeover);
        r.takeoverBg = cs.backgroundColor;
        r.takeoverBgImage = cs.backgroundImage ? cs.backgroundImage.slice(0, 160) : '';
      }
      const cancel = document.querySelector('.takeover-cancel, [class*="cancel"]');
      r.cancelExists = !!cancel;
      if (cancel) {
        const cs = getComputedStyle(cancel);
        r.cancelText = cancel.textContent.trim().slice(0, 40);
        r.cancelVisible = cs.display !== 'none' && cs.visibility !== 'hidden' && cancel.offsetParent !== null;
        const rect = cancel.getBoundingClientRect();
        r.cancelRect = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) };
      }
      const videos = [...document.querySelectorAll('video')].map((v) => ({
        src: (v.currentSrc || v.src || '').split('/').pop().slice(0, 60),
        readyState: v.readyState,
        paused: v.paused,
        currentTime: +v.currentTime.toFixed(3),
        playbackRate: v.playbackRate,
        w: v.videoWidth, h: v.videoHeight,
        visible: !!(v.offsetWidth || v.offsetHeight),
      }));
      r.videos = videos;
      r.bodyBg = getComputedStyle(document.body).backgroundColor;
      return r;
    })()`,
  });
  console.log('[DOM]', JSON.stringify(domProbe.result?.result?.value, null, 2));

  // 2) 再等 2s，验证视频时间轴在推进（不是静图定格）
  await sleep(2000);
  const timeProbe = await send('Runtime.evaluate', {
    returnByValue: true,
    expression: `(() => [...document.querySelectorAll('video')].map((v) => +v.currentTime.toFixed(3)))()`,
  });
  const t2 = timeProbe.result?.result?.value || [];
  const t1 = (domProbe.result?.result?.value?.videos || []).map((v) => v.currentTime);
  console.log('[timeline]', 't1 =', JSON.stringify(t1), '-> t2 =', JSON.stringify(t2));
  const advancing = t2.some((t, i) => Math.abs(t - (t1[i] ?? 0)) > 0.3);
  console.log(advancing ? '[PASS] 至少一个视频时间轴在推进（无静图定格）' : '[WARN] 没有视频在推进（可能是循环回跳或暂停）');

  // 3) 截图
  if (shotPath) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));
    console.log('[shot] saved:', shotPath);
  }

  ws.close();
}

main().catch((e) => { console.error(e); process.exit(1); });

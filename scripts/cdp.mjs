// عميل CDP بسيط لتجارب وصل داخل Obsidian المفتوح بـ --remote-debugging-port=9222
// مأخوذ من scripts/cdp.mjs في مستودع خزف، مع اختيار النافذة بمسار الخزينة لا بعنوانها.
//
// الاستخدام:
//   node scripts/cdp.mjs eval "<js expression>"
//   node scripts/cdp.mjs shot out.png
//   node scripts/cdp.mjs close-vault          (يغلق نافذة خزينة التجربة فقط ويعلّمها مغلقة)
//
// دروس ت١ (Obsidian 1.14.4):
// - فتح خزينة غير مسجلة: رابط obsidian://open يُهمل إن وصل قبل جاهزية التطبيق؛ الأضمن من نافذة مفتوحة:
//   require('electron').ipcRenderer.sendSync('vault-open', <path>, false)
// - window.close() من الصفحة لا يغلق نافذة الخزينة. destroy() عبر @electron/remote يغلقها، وObsidian
//   يعلّم الخزينة مغلقة في obsidian.json لأن التطبيق ليس في حالة خروج.
// - الخروج من التطبيق المفتوح بمنفذ التصحيح قد يعلق بلا نوافذ؛ إن علق فأوقف العملية التي شغّلتها أنت فقط.
//
// المتغيرات: CDP_PORT (9222)، WASL_VAULT (مسار الخزينة؛ الافتراضي test-vault في المستودع)

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PORT = process.env.CDP_PORT || 9222;
const VAULT = process.env.WASL_VAULT || fileURLToPath(new URL("../test-vault", import.meta.url));

export async function connect(vault = VAULT) {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages = targets.filter((t) => t.type === "page" && /app:\/\/obsidian\.md\/index\.html/.test(t.url));
  for (const page of pages) {
    const s = await session(page.webSocketDebuggerUrl);
    const base = await s.eval("app?.vault?.adapter?.basePath ?? null");
    if (base === vault.replace(/\/$/, "")) return s;
    s.close();
  }
  throw new Error(`no Obsidian window for vault ${vault}; open pages: ${pages.length}`);
}

async function session(url) {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  return {
    send,
    async eval(expression) {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails));
      return r.result?.result?.value;
    },
    close: () => ws.close(),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...args] = process.argv.slice(2);
  const s = await connect();
  if (cmd === "eval") {
    console.log(JSON.stringify(await s.eval(args[0]), null, 1));
  } else if (cmd === "shot") {
    const r = await s.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(args[0], Buffer.from(r.result.data, "base64"));
    console.log("saved", args[0]);
  } else if (cmd === "close-vault") {
    await s.eval("setTimeout(() => require('@electron/remote').getCurrentWindow().destroy(), 50), 'closing'");
    console.log("closed");
  } else {
    console.error("unknown command", cmd);
  }
  s.close();
}

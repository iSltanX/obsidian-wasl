// ت١: ما الذي تلتقطه لوحة «الإشارات غير المربوطة» المدمجة في Obsidian من حالات خزينة التجربة؟
//
// يتطلب Obsidian مفتوحًا بـ --remote-debugging-port=9222 وخزينة test-vault مفتوحة فيه.
// الاستخدام: node scripts/t1-builtin.mjs  ← يطبع JSON بالنتائج إلى stdout

import { connect } from "./cdp.mjs";

const TARGETS = [
  "ملاحظات/الكتابة.md", "ملاحظات/الجسد.md", "ملاحظات/الإنسان.md", "ملاحظات/رؤية 2030.md",
  "ملاحظات/Python.md", "ملاحظات/الفينومينولوجيا.md", "ملاحظات/الكتابة الحسية.md",
  "ملاحظات/جود.md", "ملاحظات/حر.md", "ملاحظات/مال.md", "ملاحظات/علي.md", "ملاحظات/سلطان.md",
  "ملاحظات/سأل.md", "ملاحظات/عَلَم.md", "مجلد أ/المعنى.md",
];

const s = await connect();
const out = {};
for (const target of TARGETS) {
  out[target] = await s.eval(`(async () => {
    const f = app.vault.getAbstractFileByPath(${JSON.stringify(target)});
    if (!f) return { error: "missing" };
    await app.workspace.getLeaf(false).openFile(f);
    let leaf = app.workspace.getLeavesOfType("backlink")[0];
    if (!leaf) { await app.workspace.getRightLeaf(false).setViewState({ type: "backlink", active: true }); leaf = app.workspace.getLeavesOfType("backlink")[0]; }
    const b = leaf.view.backlink;
    b.setUnlinkedCollapsed(false, false);
    b.recomputeUnlinked(f);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let last = -1, stable = 0;
    for (let i = 0; i < 50 && stable < 4; i++) {
      await sleep(150);
      const n = b.unlinkedDom.resultDomLookup.size;
      stable = n === last && !b.unlinkedQueue?.running ? stable + 1 : 0;
      last = n;
    }
    const results = [];
    for (const [file, dom] of b.unlinkedDom.resultDomLookup) {
      const text = dom.content ?? (await app.vault.cachedRead(file));
      for (const [a, z] of dom.result.content) {
        results.push({ note: file.path, match: text.slice(a, z), before: text.slice(Math.max(0, a - 3), a), after: text.slice(z, z + 3) });
      }
    }
    return { aliases: b.unlinkedAliases, results };
  })()`);
}
s.close();
console.log(JSON.stringify(out, null, 1));

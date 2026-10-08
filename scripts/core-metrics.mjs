#!/usr/bin/env node
// قياس نواة المطابقة على مجموعات المثبتات المقفلة (الخطوة ١.٦).
//
//   npm run metrics                      → heldout.json و heldout-novel-style.json
//   node scripts/core-metrics.mjs dev    → أي مجموعة بالاسم (بلا .json)
//
// يطبع تقريرًا بصيغة Markdown: دقة واسترجاع كل طبقة، ثم الأمثلة التي أخطأت فيها النواة.
// لا يكتب شيئًا؛ النتيجة تُنقل يدويًا إلى docs/experiments/core-metrics.md مع تاريخها.

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const ar = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]).replace(".", "٫");
const pct = (a, b) => (b ? ar(((100 * a) / b).toFixed(1)) + "٪" : "—");

// النواة TypeScript؛ تُجمَّع في الذاكرة وتُستورد كوحدة
const bundle = await build({
  entryPoints: [REPO + "test/support/evaluate.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  target: "node20",
  logLevel: "silent",
});
const code = bundle.outputFiles[0].text;
const { evaluate, metrics } = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

const sets = process.argv.slice(2).length ? process.argv.slice(2) : ["heldout", "heldout-novel-style"];
for (const name of sets) {
  const fixtures = JSON.parse(readFileSync(`${REPO}test/fixtures/${name}.json`, "utf8"));
  const verdicts = fixtures.map(evaluate);
  const m = metrics(verdicts);
  const threshold = (layer, p) => (layer === 2 ? (p >= 0.7 ? "تجتاز (٧٠٪)" : "**دون ٧٠٪**") : p >= 0.95 ? "تجتاز (٩٥٪)" : "**دون ٩٥٪**");
  console.log(`### \`${name}.json\`: ${ar(fixtures.length)} مثالًا\n`);
  console.log("| الطبقة | اقتراحات | صحيحة | دقة | دقة صارمة | متوقعة | وُجدت بطبقتها | استرجاع | مقابل العتبة |");
  console.log("|---|---|---|---|---|---|---|---|---|");
  for (const r of m.rows) {
    const p = r.predicted ? r.correct / r.predicted : null;
    console.log(
      `| ${ar(r.layer)} | ${ar(r.predicted)} | ${ar(r.correct)} | ${pct(r.correct, r.predicted)} | ${pct(r.correctStrict, r.predicted)} | ${ar(r.expected)} | ${ar(r.found)} | ${pct(r.found, r.expected)} | ${p === null ? "—" : threshold(r.layer, p)} |`,
    );
  }
  const nulls = verdicts.filter((v) => v.expected === null);
  console.log(`\n- أمثلة «لا يُقترح»: ${ar(nulls.length)}، اقترحت النواة في ${ar(m.suggestedWrongly)} منها خطأً.`);
  console.log(`- أمثلة متوقَّع اقتراحها: ${ar(verdicts.length - nulls.length)}، فاتت النواة ${ar(m.missed)} منها.`);
  console.log(`- الحكم الكلي: ${ar(m.okAll)} من ${ar(verdicts.length)} صحيحة (${pct(m.okAll, verdicts.length)})، منها ${ar(m.strictAll)} بالحكم الصارم.`);
  const bad = verdicts.filter((v) => !v.ok);
  const soft = verdicts.filter((v) => v.ok && !v.strict);
  if (bad.length) {
    console.log("\n**أخطاء:**\n\n| المثال | متوقع | وُجد | المشكلة | الأسباب |\n|---|---|---|---|---|");
    for (const v of bad) {
      const f = fixtures.find((x) => x.id === v.id);
      console.log(`| ${v.id} «${f.doc.replace(/\n/g, " ⏎ ").replace(/\|/g, "\\|")}» → «${f.target.title}» | ${String(v.expected)} | ${String(v.predicted)} | ${v.problems.join("؛ ")} | ${v.mention ? v.mention.reasons.map((r) => r.code + (r.detail ? ":" + r.detail : "")).join(" ") : "—"} |`);
    }
  }
  if (soft.length) {
    console.log("\n**صحيحة عبر «مقبول» (لا بالطبقة المتوقعة أولًا):**\n");
    for (const v of soft) console.log(`- ${v.id}: متوقع ${String(v.expected)}، وُجد ${String(v.predicted)}`);
  }
  console.log("");
}

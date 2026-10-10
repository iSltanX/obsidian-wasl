/**
 * ملاحظة الإحصاءات (الخطوة ٤.١): جداول الطبقة والسبب والعلامة واليوم من `Stats`، وملحق JSON بالأرقام خامًا
 * ليقرأه تقرير التجربة. أرقام فقط، فلا يدخل الملاحظة اسم ملاحظة ولا نص. نقي بلا `obsidian`.
 */

import type { Strings } from "./i18n";
import { BUILTIN, OUTCOMES, verdict, type Counts, type Stats } from "./stats";

type Lang = Strings["lang"];

const TEXT = {
  ar: {
    title: "إحصاءات وصل",
    intro: "أرقام محلية من استعمالك، بلا أسماء ملاحظات ولا نصوص. الفترة: من {from} إلى {to}.",
    version: "الإصدار",
    gainHead: "المكسب فوق الميزة المدمجة",
    gain: "الروابط الباقية في الطبقتين ٠ و١: {n}. منها ما تجده الميزة المدمجة أيضًا: {b}. المكسب: {g} (العتبة: الثلث).",
    gainNone: "لا روابط باقية في الطبقتين ٠ و١ بعد.",
    layerHead: "حسب الطبقة",
    reasonHead: "حسب السبب",
    flagHead: "حسب العلامة",
    dayHead: "حسب اليوم",
    rawHead: "الأرقام الخام",
    layer: "الطبقة",
    reason: "السبب",
    flag: "العلامة",
    day: "اليوم",
    linked: "رُبط",
    undone: "تُراجع عنه",
    rejected: "رُفض",
    formIgnored: "صيغة متجاهَلة",
    restored: "استُعيد",
    cancelled: "أُلغيت معاينته",
    judged: "المحكوم",
    precision: "الدقة",
    target: "العتبة",
    cell: "مقبول / مرفوض",
    notes: [
      "**المحكوم** = رُبط + رُفض + صيغة متجاهَلة − استُعيد. **الدقة** = (رُبط − تُراجع عنه) ÷ المحكوم. ما تُرك دون حكم لا يدخل، والمعاينة الملغاة ليست حكمًا.",
      "«صيغة متجاهَلة» تُعدّ مرة واحدة مهما شملت من مواضع. الرابط المتراجَع عنه يُحسب خطأً. العتبات من خطة المشروع: ٩٥٪ للطبقتين ٠ و١، ٧٠٪ للطبقة ٢؛ النكرة الاختيارية بلا عتبة وتُقاس منفصلة.",
      "الأسباب والعلامات متعددة للموضع الواحد، فمجموعها أكبر من مجموع الطبقات.",
    ],
    layers: { "0": "٠ — تطابق", "1": "١ — سابقة أو «ال»", "1i": "١ — بلا «ال» (النكرة)", "2": "٢ — محتمل" } as Record<string, string>,
    reasons: {
      exact: "تطابق",
      prefix: "سابقة",
      "lam-lam": "لل",
      indefinite: "بلا «ال»",
      definite: "مع «ال»",
      "initial-hamza": "همزة مختلفة",
      "short-core": "اسم قصير",
      suffix: "ضمير متصل",
      alias: "اسم بديل",
      diacritics: "تشكيل",
      tatweel: "تطويل",
      invisible: "رموز خفية",
      "presentation-forms": "شكل حروف مختلف",
      digits: "أرقام بشكل آخر",
      "persian-letters": "حروف فارسية",
      case: "كبيرة/صغيرة",
      [BUILTIN]: "تجدها المدمجة أيضًا",
    } as Record<string, string>,
    flags: {
      quote: "داخل اقتباس",
      table: "داخل جدول",
      "already-linked": "مربوطة في موضع آخر",
      "ambiguous-target": "اسم مشترك",
      unvocalized: "بلا تشكيل (العنوان مشكول)",
    } as Record<string, string>,
  },
  en: {
    title: "Wasl statistics",
    intro: "Local numbers from your use, with no note names or text. Period: {from} to {to}.",
    version: "Version",
    gainHead: "Gain over the built-in feature",
    gain: "Links kept in layers 0 and 1: {n}. Also found by the built-in feature: {b}. Gain: {g} (threshold: one third).",
    gainNone: "No links kept in layers 0 and 1 yet.",
    layerHead: "By layer",
    reasonHead: "By reason",
    flagHead: "By flag",
    dayHead: "By day",
    rawHead: "Raw numbers",
    layer: "Layer",
    reason: "Reason",
    flag: "Flag",
    day: "Day",
    linked: "Linked",
    undone: "Undone",
    rejected: "Rejected",
    formIgnored: "Word ignored",
    restored: "Restored",
    cancelled: "Preview cancelled",
    judged: "Judged",
    precision: "Precision",
    target: "Threshold",
    cell: "accepted / rejected",
    notes: [
      "**Judged** = linked + rejected + word ignored − restored. **Precision** = (linked − undone) ÷ judged. Suggestions left without a verdict are not counted, and a cancelled preview is not a verdict.",
      "“Word ignored” counts once however many mentions it covers. A link that was undone counts as wrong. Thresholds come from the project plan: 95% for layers 0 and 1, 70% for layer 2; the optional indefinite form has none and is measured apart.",
      "A mention can carry several reasons and flags, so their totals exceed the layer totals.",
    ],
    layers: { "0": "0 — exact", "1": "1 — prefix or “al-”", "1i": "1 — without “al-” (indefinite)", "2": "2 — possible" } as Record<string, string>,
    reasons: {
      exact: "exact",
      prefix: "prefix",
      "lam-lam": "li + al",
      indefinite: "without “al-”",
      definite: "with “al-”",
      "initial-hamza": "different hamza",
      "short-core": "short name",
      suffix: "pronoun suffix",
      alias: "alias",
      diacritics: "diacritics",
      tatweel: "tatweel",
      invisible: "invisible characters",
      "presentation-forms": "presentation forms",
      digits: "other digit script",
      "persian-letters": "Persian letters",
      case: "letter case",
      [BUILTIN]: "also found by the built-in",
    } as Record<string, string>,
    flags: {
      quote: "in a quote",
      table: "in a table",
      "already-linked": "linked elsewhere",
      "ambiguous-target": "shared name",
      unvocalized: "unvocalized (title is vocalized)",
    } as Record<string, string>,
  },
} as const satisfies Record<Lang, unknown>;

/** العتبات من الخطة: الطبقتان ٠ و١ ‏٩٥٪ والطبقة ٢ ‏٧٠٪؛ النكرة الاختيارية بلا عتبة. */
const THRESHOLD: Readonly<Record<string, number>> = { "0": 0.95, "1": 0.95, "2": 0.7 };

const LAYER_ORDER = ["0", "1", "1i", "2"] as const;

export interface ExportInfo {
  /** الإصدار والتاريخ يمرّان من الخارج فتبقى الدالة نقية. */
  readonly version: string;
  readonly today: string;
}

function pct(s: Strings, p: number | null): string {
  if (p === null) return "—";
  return s.num(Math.round(p * 1000) / 10) + (s.lang === "ar" ? "٪" : "%");
}

function row(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

function table(head: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [row(head), row(head.map(() => "---")), ...rows.map(row)];
}

/** رأس الأعمدة العددية ثم الأرقام لصف واحد: رُبط، تُراجع، رُفض، صيغة، استُعيد، أُلغيت، المحكوم، الدقة. */
function countCells(s: Strings, c: Required<Counts>): string[] {
  const v = verdict(c);
  return [...OUTCOMES.map((o) => s.num(c[o])), s.num(v.judged), pct(s, v.precision)];
}

/** رُفض ضمنيًا في الجدول اليومي: ما رُفض أو تجوهلت صيغته أو تُراجع عنه، بعد طرح المسترجَع. */
function rejectedOf(c: Required<Counts>): number {
  return Math.max(0, c.rejected + c.formIgnored - c.restored) + Math.min(c.undone, c.linked);
}

export function renderStats(stats: Stats, s: Strings, info: ExportInfo): string {
  const lang: Lang = s.lang;
  const t = TEXT[lang];
  const days = stats.dayList;
  const first = days[0] ?? info.today;
  const last = days[days.length - 1] ?? info.today;
  const countHead = [...OUTCOMES.map((o) => t[o]), t.judged, t.precision];
  const out: string[] = ["---", "wasl: exact", "---", "", `# ${t.title}`, ""];
  out.push(
    `${t.intro.replace("{from}", first).replace("{to}", last)} ${t.version}: ${info.version}.`,
    "",
  );

  out.push(`## ${t.layerHead}`, "");
  const byLayer = stats.totals("layer");
  const layers: string[] = LAYER_ORDER.filter((k) => byLayer.has(k));
  for (const k of byLayer.keys()) if (!layers.includes(k)) layers.push(k);
  out.push(
    ...table(
      [t.layer, ...countHead, t.target],
      layers.map((k) => {
        const th = THRESHOLD[k];
        return [t.layers[k] ?? k, ...countCells(s, byLayer.get(k) as Required<Counts>), th === undefined ? "—" : pct(s, th)];
      }),
    ),
    "",
  );

  const kept = (c: Required<Counts> | undefined): number => (c ? Math.max(0, c.linked - c.undone) : 0);
  const keptAll = kept(byLayer.get("0")) + kept(byLayer.get("1"));
  const keptBuiltin = kept(stats.totals("reason").get(BUILTIN));
  out.push(`## ${t.gainHead}`, "");
  out.push(
    keptAll > 0 ? t.gain.replace("{n}", s.num(keptAll)).replace("{b}", s.num(Math.min(keptBuiltin, keptAll))).replace("{g}", pct(s, 1 - Math.min(keptBuiltin, keptAll) / keptAll)) : t.gainNone,
    "",
  );

  const dims = [
    ["reason", t.reasonHead, t.reason, t.reasons],
    ["flag", t.flagHead, t.flag, t.flags],
  ] as const;
  for (const [dim, head, col, names] of dims) {
    const totals = stats.totals(dim);
    if (!totals.size) continue;
    const known = Object.keys(names).filter((k) => totals.has(k));
    const rest = [...totals.keys()].filter((k) => !(k in names)).sort();
    out.push(`## ${head}`, "");
    out.push(...table([col, ...countHead], [...known, ...rest].map((k) => [names[k] ?? k, ...countCells(s, totals.get(k) as Required<Counts>)])), "");
  }

  if (days.length) {
    out.push(`## ${t.dayHead}`, "", `${t.cell}`, "");
    out.push(
      ...table(
        [t.day, ...LAYER_ORDER.map((k) => t.layers[k] ?? k)],
        days.map((d) => [
          d,
          ...LAYER_ORDER.map((k) => {
            const c = stats.layerOn(d, k);
            return c.linked + rejectedOf(c) === 0 ? "—" : `${s.num(Math.max(0, c.linked - c.undone))} / ${s.num(rejectedOf(c))}`;
          }),
        ]),
      ),
      "",
    );
  }

  for (const note of t.notes) out.push(`- ${note}`);
  out.push("", `## ${t.rawHead}`, "", "```json", JSON.stringify(stats.toJSON()), "```", "");
  return out.join("\n");
}

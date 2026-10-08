/**
 * تقييم مثبتات المطابقة: يحوّل كل مثال إلى ملاحظات وفهرس ومسح، ويحكم على النتيجة.
 * تستعمله اختبارات الضبط وأداة القياس على المجموعات المقفلة.
 */
import { buildIndex, type NoteInput } from "../../src/core/index";
import { findMentions, type Layer, type Mention } from "../../src/core/match";

export interface Fixture {
  id: string;
  kind: "match" | "context" | "vault";
  doc: string;
  target: { title: string; aliases: string[]; exactOnly: boolean; indefinite?: boolean; path: string };
  expect: { layer: Layer | null; surface?: string; acceptable?: (Layer | null)[]; flags?: string[] };
  source?: string;
  vault?: string[];
  why: string;
  studyRef?: number;
  origin?: string;
}

export interface Verdict {
  id: string;
  expected: Layer | null;
  predicted: Layer | null;
  /** الحكم الصارم: الطبقة المتوقعة نفسها والمقطع والأعلام. */
  strict: boolean;
  /** الحكم المتساهل: الطبقة ضمن المقبول أيضًا. */
  ok: boolean;
  problems: string[];
  mention?: Mention;
}

export function evaluate(f: Fixture): Verdict {
  const target: NoteInput = {
    path: f.target.path,
    title: f.target.title,
    aliases: f.target.aliases,
    exactOnly: f.target.exactOnly,
    indefinite: f.target.indefinite,
  };
  const others: NoteInput[] = (f.vault ?? [])
    .filter((p) => p !== f.target.path)
    .map((p) => ({ path: p, title: (p.split("/").pop() as string).replace(/\.md$/, ""), aliases: [] }));
  const index = buildIndex([target, ...others], [target.path]);
  const sourcePath = f.source ?? "__source__.md";
  const mentions = findMentions(f.doc, index, { sourcePath }).filter((m) => m.path === target.path);
  const problems: string[] = [];
  if (mentions.length > 1) problems.push(`عدد المواضع ${mentions.length}`);
  const mention = mentions[0];
  const predicted: Layer | null = mention ? mention.layer : null;
  const e = f.expect;
  const layerStrict = predicted === e.layer;
  const layerOk = layerStrict || (e.acceptable ?? []).includes(predicted);
  if (!layerOk) problems.push(`الطبقة: متوقع ${String(e.layer)}، وُجد ${String(predicted)}`);
  if (mention && e.layer !== null && e.surface !== undefined && mention.surface !== e.surface)
    problems.push(`المقطع: متوقع «${e.surface}»، وُجد «${mention.surface}»`);
  for (const flag of e.flags ?? []) {
    if (mention && !mention.flags.includes(flag as Mention["flags"][number])) problems.push(`علم مفقود: ${flag}`);
  }
  const surfaceAndFlagsOk = !problems.some((p) => p.startsWith("المقطع") || p.startsWith("علم"));
  return {
    id: f.id,
    expected: e.layer,
    predicted,
    strict: layerStrict && surfaceAndFlagsOk && mentions.length <= 1,
    ok: layerOk && surfaceAndFlagsOk && mentions.length <= 1,
    problems,
    ...(mention ? { mention } : {}),
  };
}

export interface LayerRow {
  layer: Layer;
  predicted: number;
  correct: number;
  correctStrict: number;
  expected: number;
  found: number;
}

/** دقة واسترجاع كل طبقة على مجموعة. */
export function metrics(verdicts: Verdict[]): { rows: LayerRow[]; suggestedWrongly: number; missed: number; strictAll: number; okAll: number } {
  const rows: LayerRow[] = ([0, 1, 2] as Layer[]).map((layer) => ({ layer, predicted: 0, correct: 0, correctStrict: 0, expected: 0, found: 0 }));
  let suggestedWrongly = 0;
  let missed = 0;
  for (const v of verdicts) {
    if (v.predicted !== null) {
      const r = rows[v.predicted] as LayerRow;
      r.predicted++;
      if (v.ok) r.correct++;
      if (v.strict) r.correctStrict++;
      if (v.expected === null && !v.ok) suggestedWrongly++;
    }
    if (v.expected !== null) {
      const r = rows[v.expected] as LayerRow;
      r.expected++;
      if (v.predicted === v.expected) r.found++;
      if (v.predicted === null) missed++;
    }
  }
  return { rows, suggestedWrongly, missed, strictAll: verdicts.filter((v) => v.strict).length, okAll: verdicts.filter((v) => v.ok).length };
}

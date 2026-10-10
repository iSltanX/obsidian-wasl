/**
 * عدّادات التجربة الشخصية (الخطوة ٤.١): ماذا فعل المستخدم بما اقترحه وصل، لكل يوم وطبقة وسبب وعلامة.
 * أرقام فقط: لا أسماء ملاحظات ولا مسارات ولا نصوص. تُحفظ محليًا في `data.json` ولا تُرسل إلى أي جهة.
 * نقي بلا `obsidian`.
 */

import type { Mention } from "../core/match";

/**
 * ما يُسجَّل:
 * - `linked`: رُبط الموضع. `undone`: تُراجع عن ربط سبق (يُحسب خطأً في الدقة).
 * - `rejected`: «تجاهل» لموضع بعينه. `formIgnored`: «لا تقترح هذه الكلمة»، مرة واحدة مهما شملت.
 * - `restored`: أُلغي تجاهل (رفض استُرجع)، فيُطرح من المرفوض. `cancelled`: أُلغيت المعاينة قبل الربط (تردد لا حكم).
 */
export type Outcome = "linked" | "undone" | "rejected" | "formIgnored" | "restored" | "cancelled";

export const OUTCOMES: readonly Outcome[] = ["linked", "undone", "rejected", "formIgnored", "restored", "cancelled"];

export type Counts = Partial<Record<Outcome, number>>;

/** الأبعاد الثلاثة التي يُعدّ بها كل حدث. */
export type Dimension = "layer" | "reason" | "flag";

export interface DayData {
  readonly layer: Readonly<Record<string, Counts>>;
  readonly reason: Readonly<Record<string, Counts>>;
  readonly flag: Readonly<Record<string, Counts>>;
}

export interface StatsData {
  readonly v: 1;
  readonly days: Readonly<Record<string, DayData>>;
}

/**
 * ما يُعدّ للموضع. الطبقة نص: «0» و«1» و«2»، وتُفصل النكرة الاختيارية عن الطبقة ١ في «1i»
 * لأن الخطة تقيسها منفصلة (القرار ٠٠٠١).
 */
export interface Tag {
  readonly layer: string;
  readonly reasons: readonly string[];
  readonly flags: readonly string[];
}

/**
 * سبب مصطنع: الموضع تلتقطه الميزة المدمجة أيضًا (الاسم حرفيًا، ولو باسم بديل أو بحالة أحرف مختلفة)، فلا مكسب فيه.
 * بدونه لا يُحسب المكسب (ت٠: نسبة الصحيح الذي تفوته المدمجة) من العدّادات.
 */
export const BUILTIN = "builtin";
const LITERAL_REASONS: ReadonlySet<string> = new Set(["exact", "alias", "case"]);

export function tagOf(m: Pick<Mention, "layer" | "reasons" | "flags">): Tag {
  const reasons = [...new Set(m.reasons.map((r) => r.code as string))];
  if (m.layer === 0 && reasons.length > 0 && reasons.every((c) => LITERAL_REASONS.has(c))) reasons.push(BUILTIN);
  const layer = m.layer === 1 && reasons.includes("indefinite") ? "1i" : String(m.layer);
  return { layer, reasons, flags: [...m.flags] };
}

/** اليوم المحلي `YYYY-MM-DD` بأرقام لاتينية؛ `moment` يكتبها هندية في لغة Obsidian العربية فلا يصلح هنا. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** أقصى عدد أيام محفوظة؛ الأقدم يُسقط. التجربة أسبوعان، فهذا سقف أمان لا غير. */
const MAX_DAYS = 400;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[A-Za-z0-9-]{1,32}$/;
const MAX_COUNT = 1e9;

type MutableCounts = Partial<Record<Outcome, number>>;
type MutableDay = { layer: Record<string, MutableCounts>; reason: Record<string, MutableCounts>; flag: Record<string, MutableCounts> };

function emptyDay(): MutableDay {
  return { layer: {}, reason: {}, flag: {} };
}

function bump(table: Record<string, MutableCounts>, key: string, outcome: Outcome, by = 1): void {
  const row = (table[key] ??= {});
  row[outcome] = (row[outcome] ?? 0) + by;
}

function readCounts(raw: unknown): MutableCounts {
  const out: MutableCounts = {};
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  for (const o of OUTCOMES) {
    const n = r[o];
    if (typeof n === "number" && Number.isInteger(n) && n > 0) out[o] = Math.min(n, MAX_COUNT);
  }
  return out;
}

function readTable(raw: unknown): Record<string, MutableCounts> {
  const out: Record<string, MutableCounts> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!KEY.test(key)) continue;
    const counts = readCounts(value);
    if (Object.keys(counts).length) out[key] = counts;
  }
  return out;
}

export class Stats {
  private days = new Map<string, MutableDay>();
  /** يزيد مع كل تغيير. */
  version = 0;

  /** يقرأ ما في `data.json` ويُسقط كل مدخل تالف وحده. */
  static read(raw: unknown): Stats {
    const stats = new Stats();
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const days = r.days && typeof r.days === "object" ? (r.days as Record<string, unknown>) : {};
    for (const [day, value] of Object.entries(days)) {
      if (!DAY.test(day)) continue;
      const d = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      const parsed: MutableDay = { layer: readTable(d.layer), reason: readTable(d.reason), flag: readTable(d.flag) };
      if (Object.keys(parsed.layer).length) stats.days.set(day, parsed);
    }
    stats.trim();
    return stats;
  }

  toJSON(): StatsData {
    const days: Record<string, DayData> = {};
    for (const day of [...this.days.keys()].sort()) days[day] = this.days.get(day) as MutableDay;
    return { v: 1, days };
  }

  get empty(): boolean {
    return this.days.size === 0;
  }

  /** يسجّل حدثًا واحدًا لموضع في يوم. */
  record(day: string, outcome: Outcome, tag: Tag): void {
    if (!DAY.test(day)) return;
    let d = this.days.get(day);
    if (!d) {
      d = emptyDay();
      this.days.set(day, d);
    }
    bump(d.layer, tag.layer, outcome);
    for (const code of tag.reasons) if (KEY.test(code)) bump(d.reason, code, outcome);
    for (const flag of tag.flags) if (KEY.test(flag)) bump(d.flag, flag, outcome);
    this.trim();
    this.version++;
  }

  /**
   * يدمج نسخة أخرى بأخذ الأكبر لكل عدّاد. العدّادات تزيد ولا تنقص، فنسخة قديمة من القرص لا تُنقِص ما في
   * الذاكرة، ونسخة أحدث من جهاز آخر تُؤخذ. يخسر الدمج ما جرى متزامنًا على جهازين فقط.
   */
  mergeMax(other: Stats): void {
    for (const [day, od] of other.days) {
      let d = this.days.get(day);
      if (!d) {
        d = emptyDay();
        this.days.set(day, d);
      }
      for (const dim of ["layer", "reason", "flag"] as const) {
        for (const [key, counts] of Object.entries(od[dim])) {
          const row = (d[dim][key] ??= {});
          for (const o of OUTCOMES) {
            const n = counts[o];
            if (n !== undefined && n > (row[o] ?? 0)) row[o] = n;
          }
        }
      }
    }
    this.trim();
    this.version++;
  }

  /** مجموع كل الأيام (أو أيام النطاق `from`…`to` شاملةً) لبُعد واحد. */
  totals(dim: Dimension, range: { from?: string; to?: string } = {}): Map<string, Required<Counts>> {
    const out = new Map<string, Required<Counts>>();
    for (const [day, d] of this.days) {
      if ((range.from && day < range.from) || (range.to && day > range.to)) continue;
      for (const [key, counts] of Object.entries(d[dim])) {
        let row = out.get(key);
        if (!row) {
          row = { linked: 0, undone: 0, rejected: 0, formIgnored: 0, restored: 0, cancelled: 0 };
          out.set(key, row);
        }
        for (const o of OUTCOMES) row[o] += counts[o] ?? 0;
      }
    }
    return out;
  }

  /** أيام لها حدث، من الأقدم. */
  get dayList(): string[] {
    return [...this.days.keys()].sort();
  }

  /** عدّادات طبقة في يوم واحد. */
  layerOn(day: string, layer: string): Required<Counts> {
    const counts = this.days.get(day)?.layer[layer] ?? {};
    return { linked: counts.linked ?? 0, undone: counts.undone ?? 0, rejected: counts.rejected ?? 0, formIgnored: counts.formIgnored ?? 0, restored: counts.restored ?? 0, cancelled: counts.cancelled ?? 0 };
  }

  private trim(): void {
    if (this.days.size <= MAX_DAYS) return;
    for (const day of [...this.days.keys()].sort().slice(0, this.days.size - MAX_DAYS)) this.days.delete(day);
  }
}

export interface Verdict {
  /** ما حكم عليه المستخدم: رُبط أو رُفض أو تُجوهلت صيغته. */
  readonly judged: number;
  /** ما بقي مقبولًا بعد التراجع. */
  readonly accepted: number;
  /** `accepted / judged`؛ `null` إن لم يُحكم على شيء. ما تُرك دون حكم لا يدخل. */
  readonly precision: number | null;
}

/**
 * الدقة من حكم المستخدم وحده. حكمه: رُبط + رُفض + صيغة متجاهَلة − ما استُرجع. والمقبول: رُبط − ما تُراجع عنه
 * (الرابط المتراجَع عنه يُحسب خطأً). المعاينة الملغاة ليست حكمًا. السالب يُصفَّر لأن استرجاع تجاهل قديم
 * (قبل العدّادات) لا مقابل له هنا.
 */
export function verdict(c: Required<Counts>): Verdict {
  const accepted = Math.max(0, c.linked - c.undone);
  const judged = c.linked + Math.max(0, c.rejected + c.formIgnored - c.restored);
  return { judged, accepted, precision: judged > 0 ? accepted / judged : null };
}

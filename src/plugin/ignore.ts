/**
 * قائمة التجاهل (الدراسة، القسم ٥ «منع تكرار المرفوض»): ما رفضه المستخدم لا يعود.
 * - موضع متجاهَل: مفتاحه الوجهة + المصدر + بصمة السياق القريب. إن تغيّر النص حول الموضع تغيّرت
 *   البصمة فعاد الاقتراح؛ وإن بقي كما هو لا يعود.
 * - كلمة متجاهَلة لملاحظة: لا تُقترح هذه الصيغة (مطبّعة) لهذه الوجهة في أي ملاحظة.
 * تُحفظ في `data.json` فتتزامن مع Obsidian Sync، وتتبع الملفات عند إعادة التسمية. نقي بلا `obsidian`.
 */

import { nameKey } from "../core/index";
import type { Found, Snippet } from "./context";

export interface IgnoredMention {
  /** الوجهة (مسار الملاحظة الهدف). */
  readonly t: string;
  /** المصدر. */
  readonly s: string;
  /** بصمة السياق. */
  readonly f: string;
}

export interface IgnoredForm {
  readonly t: string;
  /** الكلمة مطبّعة (`formKey`). */
  readonly w: string;
}

export interface IgnoreData {
  readonly mentions: readonly IgnoredMention[];
  readonly forms: readonly IgnoredForm[];
}

/** حروف السياق المأخوذة من كل جهة قبل التطبيع. */
const WINDOW = 25;

/** FNV-1a على 32 بت، ست عشرية. يكفي لتمييز سياقات ملاحظة واحدة. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** بصمة الموضع: المقطع وما حوله، مطبّعًا كتابيًا (حركة تُضاف قربه لا تغيّر البصمة). */
export function fingerprint(surface: string, snippet: Snippet): string {
  const before = snippet.text.slice(0, snippet.matchStart).slice(-WINDOW);
  const after = snippet.text.slice(snippet.matchEnd, snippet.matchEnd + WINDOW);
  return hash(nameKey(before) + "\u0000" + nameKey(surface) + "\u0000" + nameKey(after));
}

/** مفتاح الصيغة: الكلمة كاملة بعد تطبيع الفئة (أ). */
export function formKey(surface: string): string {
  return nameKey(surface);
}

export type IgnoreKind = "mention" | "form";

function movePath(path: string, oldPath: string, newPath: string): string {
  if (path === oldPath) return newPath;
  if (path.startsWith(oldPath + "/")) return newPath + path.slice(oldPath.length);
  return path;
}

function under(path: string, folderOrFile: string): boolean {
  return path === folderOrFile || path.startsWith(folderOrFile + "/");
}

/** بصمة كل موضع تُحسب مرة؛ المواضع كائنات ثابتة تعيش ما عاشت نتائج المسح. */
const fingerprints = new WeakMap<Found, string>();

function fingerprintOf(m: Found): string {
  let f = fingerprints.get(m);
  if (f === undefined) {
    f = fingerprint(m.surface, m.snippet);
    fingerprints.set(m, f);
  }
  return f;
}

const SEP = "\u0000";

export class IgnoreList {
  private mentions: IgnoredMention[] = [];
  private forms: IgnoredForm[] = [];
  /** مفاتيح مركّبة للبحث الفوري؛ تُشتق من القائمتين. */
  private mentionKeys = new Set<string>();
  private formKeys = new Set<string>();
  /** يزيد مع كل تغيير، فتميّز الواجهة قائمة تبدّلت بالحجم نفسه. */
  version = 0;

  /** يقرأ ما في `data.json` ويُسقط كل مدخل تالف وحده. */
  static read(raw: unknown): IgnoreList {
    const list = new IgnoreList();
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
    if (Array.isArray(r.mentions)) {
      for (const m of r.mentions as unknown[]) {
        const o = (m && typeof m === "object" ? m : {}) as Record<string, unknown>;
        if (str(o.t) && str(o.s) && str(o.f)) list.ignoreMention(o.t, o.s, o.f);
      }
    }
    if (Array.isArray(r.forms)) {
      for (const f of r.forms as unknown[]) {
        const o = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
        if (str(o.t) && str(o.w)) list.ignoreForm(o.t, o.w);
      }
    }
    return list;
  }

  toJSON(): IgnoreData {
    return { mentions: [...this.mentions], forms: [...this.forms] };
  }

  get size(): number {
    return this.mentions.length + this.forms.length;
  }

  private reindex(): void {
    this.mentionKeys = new Set(this.mentions.map((m) => m.t + SEP + m.s + SEP + m.f));
    this.formKeys = new Set(this.forms.map((m) => m.t + SEP + m.w));
    this.version++;
  }

  /** يعيد `true` إن تغيّرت القائمة. */
  ignoreMention(t: string, s: string, f: string): boolean {
    if (this.mentionKeys.has(t + SEP + s + SEP + f)) return false;
    this.mentions.push({ t, s, f });
    this.reindex();
    return true;
  }

  ignoreForm(t: string, w: string): boolean {
    if (!w || this.formKeys.has(t + SEP + w)) return false;
    this.forms.push({ t, w });
    this.reindex();
    return true;
  }

  unignoreMention(t: string, s: string, f: string): boolean {
    if (!this.mentionKeys.has(t + SEP + s + SEP + f)) return false;
    this.mentions = this.mentions.filter((m) => !(m.t === t && m.s === s && m.f === f));
    this.reindex();
    return true;
  }

  unignoreForm(t: string, w: string): boolean {
    if (!this.formKeys.has(t + SEP + w)) return false;
    this.forms = this.forms.filter((m) => !(m.t === t && m.w === w));
    this.reindex();
    return true;
  }

  /** لماذا يُخفى موضع: بعينه، أو لأن كلمته متجاهَلة لهذه الوجهة؛ أو `null`. */
  isIgnored(target: string, source: string, m: Found): IgnoreKind | null {
    if (this.formKeys.size && this.formKeys.has(target + SEP + formKey(m.surface))) return "form";
    if (this.mentionKeys.size && this.mentionKeys.has(target + SEP + source + SEP + fingerprintOf(m))) return "mention";
    return null;
  }

  /** يُلغي كل ما أخفى هذا الموضع: الكلمة والموضع بعينه معًا إن اجتمعا، فتكفي نقرة واحدة. */
  unignore(target: string, source: string, m: Found): boolean {
    const a = this.unignoreForm(target, formKey(m.surface));
    const b = this.unignoreMention(target, source, fingerprintOf(m));
    return a || b;
  }

  /** ملف أو مجلد نُقل: تتبعه المفاتيح. يعيد `true` إن تغيّر شيء. */
  rename(oldPath: string, newPath: string): boolean {
    let changed = false;
    this.mentions = this.mentions.map((m) => {
      const t = movePath(m.t, oldPath, newPath);
      const s = movePath(m.s, oldPath, newPath);
      if (t === m.t && s === m.s) return m;
      changed = true;
      return { t, s, f: m.f };
    });
    this.forms = this.forms.map((m) => {
      const t = movePath(m.t, oldPath, newPath);
      if (t === m.t) return m;
      changed = true;
      return { t, w: m.w };
    });
    if (changed) this.reindex();
    return changed;
  }

  /** ملف أو مجلد حُذف: تُحذف مفاتيحه. */
  drop(path: string): boolean {
    const before = this.size;
    this.mentions = this.mentions.filter((m) => !under(m.t, path) && !under(m.s, path));
    this.forms = this.forms.filter((m) => !under(m.t, path));
    const changed = this.size !== before;
    if (changed) this.reindex();
    return changed;
  }
}

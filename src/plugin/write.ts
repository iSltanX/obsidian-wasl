/**
 * التحقق قبل الكتابة (الدراسة، الجزء الثاني هـ): الموضع المسجّل وقت البحث قد يكون تحرّك أو تغيّر.
 * يُقبل الموضع إن بقي المقطع في مكانه بسياقه؛ وإلا يُبحث عنه بسياقه، ويُقبل إن وُجد مرة واحدة فقط.
 * ثم يُفحص أنه ما زال كلمة كاملة خارج النطاقات المحمية. لا كتابة عند الشك.
 * نقي بلا `obsidian`؛ يعمل على نص المحرر أو على ما يمرّره `vault.process`.
 */

import { isMark, isWordChar } from "../core/normalize";
import { inRanges, intersects, protect, type CacheLike } from "../core/protect";
import type { Snippet } from "./context";
import { escapeForTable } from "./link";

/** ما يلزم لإيجاد الموضع من جديد: المقطع وموضعه وسطر سياقه كما حُفظ وقت البحث. */
export interface Locator {
  readonly surface: string;
  readonly start: number;
  /** ما قبل المقطع في سياقه (لاحقة لما قبل الموضع في النص) وما بعده (سابقة لما بعده). */
  readonly before: string;
  readonly after: string;
}

export function locatorOf(start: number, surface: string, snippet: Snippet): Locator {
  return { surface, start, before: snippet.text.slice(0, snippet.matchStart), after: snippet.text.slice(snippet.matchEnd) };
}

export type LocateFailure = "changed" | "ambiguous" | "protected";

export type Located =
  | { readonly ok: true; readonly start: number; readonly end: number; readonly moved: boolean; readonly inTable: boolean }
  | { readonly ok: false; readonly reason: LocateFailure };

function contextAt(doc: string, loc: Locator, start: number): boolean {
  return (
    start >= loc.before.length &&
    doc.startsWith(loc.surface, start) &&
    doc.slice(start - loc.before.length, start) === loc.before &&
    doc.startsWith(loc.after, start + loc.surface.length)
  );
}

/** حرف كلمة أو حركة يلتصق بالمقطع من أحد طرفيه: لم يعد كلمة كاملة. */
function wholeWord(doc: string, start: number, end: number): boolean {
  const b = start > 0 ? doc.charCodeAt(start - 1) : -1;
  const a = end < doc.length ? doc.charCodeAt(end) : -1;
  return !(b >= 0 && (isWordChar(b) || isMark(b))) && !(a >= 0 && (isWordChar(a) || isMark(a)));
}

/**
 * يجد الموضع في النص الحالي. `cache` بيانات Obsidian للملف إن كانت حديثة؛ تُهمل حين تحرّك الموضع
 * لأن مواضعها قد تكون تحرّكت معه، ويكفي حينها الماسح الخفيف.
 */
export function locate(doc: string, loc: Locator, cache?: CacheLike): Located {
  let start = -1;
  let moved = false;
  if (contextAt(doc, loc, loc.start) && wholeWord(doc, loc.start, loc.start + loc.surface.length)) {
    start = loc.start;
  } else {
    // بالسياق كاملًا، وكلمةً كاملة: السياق الفارغ (الكلمة وحدها في سطرها) لا يطابق جزء كلمة أطول
    const needle = loc.before + loc.surface + loc.after;
    const hits: number[] = [];
    for (let i = doc.indexOf(needle); i >= 0; i = doc.indexOf(needle, i + 1)) {
      const s = i + loc.before.length;
      if (wholeWord(doc, s, s + loc.surface.length)) hits.push(s);
      if (hits.length > 1) return { ok: false, reason: "ambiguous" };
    }
    if (hits.length !== 1) return { ok: false, reason: "changed" };
    start = hits[0] as number;
    moved = true;
  }
  const end = start + loc.surface.length;
  const prot = protect(doc, moved ? undefined : cache);
  if (intersects(prot.protected, start, end)) return { ok: false, reason: "protected" };
  return { ok: true, start, end, moved, inTable: inRanges(prot.tables, start) };
}

export type Applied = { readonly ok: true; readonly text: string; readonly link: string; readonly start: number; readonly end: number } | { readonly ok: false; readonly reason: LocateFailure };

/**
 * النص بعد وضع الرابط مكان المقطع، أو سبب الامتناع. `link` بلا تهريب الجدول؛ يُهرَّب هنا
 * بحسب حالة السطر وقت الكتابة لا وقت البحث.
 */
export function applyLink(doc: string, loc: Locator, link: string, cache?: CacheLike): Applied {
  const at = locate(doc, loc, cache);
  if (!at.ok) return at;
  const final = at.inTable ? escapeForTable(link) : link;
  return { ok: true, text: doc.slice(0, at.start) + final + doc.slice(at.end), link: final, start: at.start, end: at.end };
}

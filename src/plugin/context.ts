/**
 * سياق كل موضع: السطر الذي فيه مقصوصًا عند حدود الكلمات، ورقم السطر. يُحسب مرة عند المسح
 * ويُحفظ مع النتيجة، فلا تُحفظ نصوص الملفات في الذاكرة. نقي بلا `obsidian`.
 */

import type { Mention } from "../core/match";
import { isArabicIndicDigit, isMark } from "../core/normalize";

/** السياق المعروض: نص مقصوص عند حدود الكلمات، وموضع المقطع داخله، واتجاه سطره. */
export interface Snippet {
  /** النص بلا علامات القص؛ الواجهة ترسم «…» عنصرًا مستقلًّا. */
  readonly text: string;
  readonly matchStart: number;
  readonly matchEnd: number;
  readonly cutStart: boolean;
  readonly cutEnd: boolean;
  /** من أول حرف قوي في السطر كاملًا لا في المقصوص؛ `null` إن لم يكن فيه حرف قوي. */
  readonly dir: "rtl" | "ltr" | null;
}

/** موضع جاهز للعرض: نتيجة النواة مع رقم سطره (من صفر) وسياقه. */
export interface Found extends Mention {
  readonly line: number;
  readonly snippet: Snippet;
}

/** نحو ٤٥ حرفًا من كل جهة: سطران أو ثلاثة في لوحة جانبية (docs/ui.md، البند ٦). */
export const RADIUS = 45;

function isSurrogateTail(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

function isAttached(c: number): boolean {
  return isMark(c) || isSurrogateTail(c);
}

/** اتجاه أول حرف قوي: العبرية والعربية وأشكال عرضها يمين، والحروف اللاتينية وما بعدها حتى الإغريقية الممتدة يسار. */
export function firstStrongDir(text: string, from = 0, to = text.length): "rtl" | "ltr" | null {
  for (let i = from; i < to; i++) {
    const c = text.charCodeAt(i);
    if (isMark(c) || isArabicIndicDigit(c)) continue; // ضعيفة في خوارزمية الاتجاه
    if ((c >= 0x0590 && c <= 0x08ff) || (c >= 0xfb1d && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfefc)) return "rtl";
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f && c !== 0xd7 && c !== 0xf7) || (c >= 0x370 && c <= 0x1fff))
      return "ltr";
  }
  return null;
}

/** حدود سطر واتجاهه؛ تُحسب مرة لكل سطر لا لكل موضع، فلا يتضاعف الزمن على سطر طويل فيه مواضع كثيرة. */
export interface LineInfo {
  readonly start: number;
  /** نهاية السطر بلا `\r`. */
  readonly end: number;
  /** أول ما ليس مسافة، وما بعد آخر ما ليس مسافة: القص في المسافات الطرفية ليس قصًا. */
  readonly firstText: number;
  readonly lastText: number;
  readonly dir: "rtl" | "ltr" | null;
}

export function lineInfo(doc: string, at: number): LineInfo {
  const start = doc.lastIndexOf("\n", at - 1) + 1;
  let end = doc.indexOf("\n", at);
  if (end < 0) end = doc.length;
  if (doc[end - 1] === "\r") end--;
  let firstText = start;
  while (firstText < end && (doc[firstText] === " " || doc[firstText] === "\t")) firstText++;
  let lastText = end;
  while (lastText > firstText && (doc[lastText - 1] === " " || doc[lastText - 1] === "\t")) lastText--;
  return { start, end, firstText, lastText, dir: firstStrongDir(doc, start, end) };
}

/** سياق موضع واحد داخل سطره. القراءة محصورة فيما حول الموضع بنصف القطر. */
export function snippetFor(doc: string, start: number, end: number, radius = RADIUS, line: LineInfo = lineInfo(doc, start)): Snippet {
  const lineEnd = Math.max(end, line.end);

  let from = Math.min(line.firstText, start);
  if (start - from > radius) {
    const at = start - radius;
    const space = doc.slice(at, start).indexOf(" ");
    from = space >= 0 && at + space < start - 1 ? at + space + 1 : at;
    while (from < start && isAttached(doc.charCodeAt(from))) from++;
  }
  const before = doc.slice(from, start).replace(/^[ \t]+/, "");

  let to = lineEnd;
  if (lineEnd - end > radius) {
    const space = doc.slice(end, end + radius + 1).lastIndexOf(" ", radius);
    to = end + (space > 0 ? space : radius);
    while (to < lineEnd && isAttached(doc.charCodeAt(to))) to++;
  }
  const after = doc.slice(end, to).replace(/[ \t]+$/, "");

  const match = doc.slice(start, end);
  return {
    text: before + match + after,
    matchStart: before.length,
    matchEnd: before.length + match.length,
    cutStart: from > line.firstText,
    cutEnd: to < line.lastText,
    dir: line.dir,
  };
}

/** يضيف السطر والسياق إلى مواضع ملف واحد (المرتبة بالموضع كما تعيدها النواة). */
export function withContext(doc: string, mentions: readonly Mention[], radius = RADIUS): Found[] {
  let line = 0;
  let cursor = 0;
  let info: LineInfo | null = null;
  return mentions.map((m) => {
    for (let i = doc.indexOf("\n", cursor); i >= 0 && i < m.start; i = doc.indexOf("\n", i + 1)) {
      line++;
      cursor = i + 1;
    }
    if (!info || m.start < info.start || m.start > info.end) info = lineInfo(doc, m.start);
    return { ...m, line, snippet: snippetFor(doc, m.start, m.end, radius, info) };
  });
}

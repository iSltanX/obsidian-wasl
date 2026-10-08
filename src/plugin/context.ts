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

/** لا يبدأ المقصوص بحركة ولا بنصف محرف. */
function skipAttached(text: string, i: number): number {
  while (i < text.length && (isMark(text.charCodeAt(i)) || isSurrogateTail(text.charCodeAt(i)))) i++;
  return i;
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

/** سياق موضع واحد داخل سطره. */
export function snippetFor(doc: string, start: number, end: number, radius = RADIUS): Snippet {
  const lineStart = doc.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = doc.indexOf("\n", end);
  if (lineEnd < 0) lineEnd = doc.length;
  if (doc[lineEnd - 1] === "\r") lineEnd--;
  lineEnd = Math.max(end, lineEnd);

  let before = doc.slice(lineStart, start);
  const cutStart = before.length > radius;
  if (cutStart) {
    const space = before.indexOf(" ", before.length - radius);
    const at = space >= 0 && space < before.length - 1 ? space + 1 : before.length - radius;
    before = before.slice(skipAttached(before, at));
  }
  before = before.replace(/^[ \t]+/, "");

  let after = doc.slice(end, lineEnd);
  const cutEnd = after.length > radius;
  if (cutEnd) {
    const space = after.lastIndexOf(" ", radius);
    after = after.slice(0, skipAttached(after, space > 0 ? space : radius));
  }
  after = after.replace(/[ \t]+$/, "");

  const match = doc.slice(start, end);
  return {
    text: before + match + after,
    matchStart: before.length,
    matchEnd: before.length + match.length,
    cutStart,
    cutEnd,
    dir: firstStrongDir(doc, lineStart, lineEnd),
  };
}

/** يضيف السطر والسياق إلى مواضع ملف واحد (المرتبة بالموضع كما تعيدها النواة). */
export function withContext(doc: string, mentions: readonly Mention[], radius = RADIUS): Found[] {
  let line = 0;
  let cursor = 0;
  return mentions.map((m) => {
    for (let i = doc.indexOf("\n", cursor); i >= 0 && i < m.start; i = doc.indexOf("\n", i + 1)) {
      line++;
      cursor = i + 1;
    }
    return { ...m, line, snippet: snippetFor(doc, m.start, m.end, radius) };
  });
}

/**
 * النطاقات المحمية: ما لا يُقترح فيه رابط، وما يُقترح فيه موسومًا.
 *
 * مصدران يتكاملان:
 * 1. بيانات شبيهة بـ`CachedMetadata` من Obsidian (مواضع فقط): الخصائص، الروابط، التضمينات،
 *    العناوين، الأقسام (كود، yaml، رياضيات، تعليق، HTML، اقتباس، تنبيه، جدول)، الحواشي، الوسوم.
 * 2. ماسح خفيف يعمل دائمًا، لأن الكود المضمّن والرياضيات وتعليقات `%%` وHTML داخل الفقرة
 *    غير مغطاة بالكامل في البيانات، ولأن النواة تُختبر خارج Obsidian.
 *
 * القرارات: عناوين الأقسام مستثناة (٦)، الاقتباسات تُعرض موسومة (٥)، الجداول تُقترح مع تهريب `|` (٢٩).
 */

import { nameKey } from "./index";

export interface Range {
  readonly start: number;
  readonly end: number;
}

interface Pos {
  readonly start: { readonly offset: number };
  readonly end: { readonly offset: number };
}

/** الجزء المستعمل من `CachedMetadata`؛ مواضع بوحدات UTF-16 كما تعطيها Obsidian. */
export interface CacheLike {
  readonly frontmatterPosition?: Pos;
  readonly links?: readonly { readonly position: Pos; readonly link: string }[];
  readonly embeds?: readonly { readonly position: Pos; readonly link: string }[];
  readonly headings?: readonly { readonly position: Pos }[];
  readonly sections?: readonly { readonly type: string; readonly position: Pos }[];
  readonly footnotes?: readonly { readonly position: Pos }[];
  readonly tags?: readonly { readonly position: Pos }[];
}

export interface Protection {
  /** لا يُقترح فيها شيء. */
  readonly protected: readonly Range[];
  /** اقتباسات وتنبيهات: يُقترح موسومًا «داخل اقتباس». */
  readonly quotes: readonly Range[];
  /** جداول: يُقترح، ويُهرَّب `|` عند الكتابة. */
  readonly tables: readonly Range[];
  /** مفاتيح وجهات الروابط الموجودة في الملاحظة (اسم الملف بلا امتداد، مطبّعًا). */
  readonly links: ReadonlySet<string>;
}

const QUOTE_SECTIONS = new Set(["blockquote", "callout"]);
const PROTECTED_SECTIONS = new Set(["code", "yaml", "math", "comment", "html", "heading"]);

/** مفتاح وجهة رابط: اسم الملف بلا مجلد ولا امتداد ولا قسم. */
export function linkKey(target: string): string {
  const noSub = target.split("#")[0] as string;
  const base = noSub.split("/").pop() as string;
  return nameKey(base.replace(/\.md$/i, ""));
}

function frontmatterEnd(doc: string): number {
  if (!/^---[ \t]*\r?\n/.test(doc)) return 0;
  const m = /\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(doc.slice(3));
  return m ? 3 + m.index + m[0].length : 0;
}

/** أنماط داخل السطر؛ كلها بلا نظرة خلفية. */
const INLINE_PATTERNS: readonly RegExp[] = [
  /\$\$[\s\S]*?\$\$/g,
  /%%[\s\S]*?%%/g,
  /<!--[\s\S]*?-->/g,
  /`+[^`\n]*`+/g,
  /!?\[\[[^\]\n]*\]\]/g,
  /!?\[[^\]\n]*\]\([^)\n]*\)/g,
  /https?:\/\/[^\s)\]>]+/g,
  /\$[^$\s][^$\n]*?\$/g,
  /<\/?[A-Za-z][^<>\n]*>/g,
  /\[\^[^\]\s]+\]:?/g,
  /\^[A-Za-z0-9-]+[ \t]*$/gm,
];

export function protect(doc: string, cache?: CacheLike): Protection {
  const ranges: Range[] = [];
  const quotes: Range[] = [];
  const tables: Range[] = [];
  const links = new Set<string>();

  // ١. من البيانات المرسلة
  if (cache) {
    const pos = (p: Pos): Range => ({ start: p.start.offset, end: p.end.offset });
    if (cache.frontmatterPosition) ranges.push(pos(cache.frontmatterPosition));
    for (const l of cache.links ?? []) {
      ranges.push(pos(l.position));
      links.add(linkKey(l.link));
    }
    for (const e of cache.embeds ?? []) {
      ranges.push(pos(e.position));
      links.add(linkKey(e.link));
    }
    for (const h of cache.headings ?? []) ranges.push(pos(h.position));
    for (const f of cache.footnotes ?? []) ranges.push(pos(f.position));
    for (const t of cache.tags ?? []) ranges.push(pos(t.position));
    for (const s of cache.sections ?? []) {
      if (PROTECTED_SECTIONS.has(s.type)) ranges.push(pos(s.position));
      else if (QUOTE_SECTIONS.has(s.type)) quotes.push(pos(s.position));
      else if (s.type === "table") tables.push(pos(s.position));
    }
  }

  // ٢. الماسح الخفيف
  const fm = frontmatterEnd(doc);
  if (fm) ranges.push({ start: 0, end: fm });

  let pos = fm;
  let fence: string | null = null;
  let fenceStart = 0;
  for (const line of doc.slice(fm).split("\n")) {
    const lineStart = pos;
    pos += line.length + 1;
    const lineEnd = Math.min(pos, doc.length);
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const close = f && (f[1] as string)[0] === fence[0] && (f[1] as string).length >= fence.length;
      if (close) {
        ranges.push({ start: fenceStart, end: lineEnd });
        fence = null;
      }
      continue;
    }
    if (f) {
      fence = f[1] as string;
      fenceStart = lineStart;
      continue;
    }
    if (/^ {0,3}#{1,6}(\s|$)/.test(line)) ranges.push({ start: lineStart, end: lineEnd });
    else if (/^ {0,3}>/.test(line)) quotes.push({ start: lineStart, end: lineEnd });
    else if (/^ {0,3}\|/.test(line)) tables.push({ start: lineStart, end: lineEnd });
  }
  if (fence) ranges.push({ start: fenceStart, end: doc.length });

  for (const re of INLINE_PATTERNS) {
    re.lastIndex = 0;
    for (const m of doc.matchAll(re)) ranges.push({ start: m.index, end: m.index + m[0].length });
  }
  // الوسوم: «#» بعد بداية السطر أو مسافة؛ النطاق من «#» لا من المسافة
  for (const m of doc.matchAll(/(^|[\s(])#[^\s#()[\]]+/g)) {
    const lead = (m[1] as string).length;
    ranges.push({ start: m.index + lead, end: m.index + m[0].length });
  }

  for (const m of doc.matchAll(/!?\[\[([^\]|#\n]+)/g)) links.add(linkKey(m[1] as string));
  for (const m of doc.matchAll(/\]\(([^)\s#]+?)(?:#[^)]*)?\)/g)) {
    const raw = m[1] as string;
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) continue; // http: وأمثالها ليست ملاحظات
    let target = raw;
    try {
      target = decodeURIComponent(raw);
    } catch {
      /* يبقى كما هو */
    }
    links.add(linkKey(target));
  }

  return { protected: ranges, quotes, tables, links };
}

/** هل يقع الموضع داخل أحد النطاقات؟ */
export function inRanges(ranges: readonly Range[], offset: number): boolean {
  for (const r of ranges) if (offset >= r.start && offset < r.end) return true;
  return false;
}

/** يستبدل النطاقات المحمية بمسافات مع حفظ الأسطر والمواضع، فلا تتكوّن منها كلمات. */
export function mask(doc: string, ranges: readonly Range[]): string {
  if (!ranges.length) return doc;
  const chars = doc.split("");
  for (const r of ranges) {
    const end = Math.min(r.end, chars.length);
    for (let i = Math.max(0, r.start); i < end; i++) if (chars[i] !== "\n") chars[i] = " ";
  }
  return chars.join("");
}

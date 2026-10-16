/**
 * النطاقات المحمية: ما لا يُقترح فيه رابط، وما يُقترح فيه موسومًا.
 *
 * مصدران يتكاملان:
 * 1. بيانات شبيهة بـ`CachedMetadata` من Obsidian (مواضع فقط): الخصائص، الروابط، التضمينات،
 *    العناوين، الأقسام (كود، yaml، رياضيات، تعليق، HTML، اقتباس، تنبيه، جدول)، الحواشي، الوسوم.
 * 2. ماسح خفيف يعمل دائمًا، لأن الكود المضمّن والرياضيات وتعليقات `%%` وHTML داخل الفقرة
 *    غير مغطاة بالكامل في البيانات، ولأن النواة تُختبر خارج Obsidian.
 *
 * الماسح يمرّ على مراحل، وكل مرحلة تعمل على نسخة عُمّي فيها ما استهلكته المراحل السابقة، حتى لا
 * يقترن `$` داخل كود مضمّن بـ`$` آخر خارجه. التعمية بمحرف فاصل (U+FFFC) لا بمسافة، فلا تندمج كلمتان
 * حول نطاق محمي ولا يُطابَق عنوان مركّب عبره.
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
  /**
   * وجهات الروابط الموجودة كما كُتبت: بمجلدها وامتدادها، بلا قسم ولا معرّف كتلة. تُحلّ إلى ملفات
   * بمسار الملف لا باسمه (`MatchOptions.resolveLink`)، فرابط إلى `أ/المعنى` لا يُعدّ رابطًا إلى `ب/المعنى`.
   */
  readonly targets: ReadonlySet<string>;
}

/** محرف التعمية: ليس حرف كلمة ولا مسافة ولا حركة، فيفصل الكلمات ولا يصلها. */
export const MASK_CHAR = "￼";

const QUOTE_SECTIONS = new Set(["blockquote", "callout"]);
const PROTECTED_SECTIONS = new Set(["code", "yaml", "math", "comment", "html", "heading"]);

/** مفتاح وجهة رابط: اسم الملف بلا مجلد ولا امتداد ولا قسم ولا معرّف كتلة. */
/** وجهة رابط كما كُتبت بلا قسم ولا معرّف كتلة (`مجلد/ملاحظة#قسم` ← `مجلد/ملاحظة`). */
export function linkTarget(target: string): string {
  return (target.split(/[#^]/)[0] as string).trim();
}

export function linkKey(target: string): string {
  const noSub = target.split(/[#^]/)[0] as string;
  const base = noSub.split("/").pop() as string;
  return nameKey(base.replace(/\.md$/i, ""));
}

function frontmatterEnd(doc: string): number {
  if (!/^---[ \t]*\r?\n/.test(doc)) return 0;
  const m = /\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(doc.slice(3));
  return m ? 3 + m.index + m[0].length : 0;
}

/**
 * مراحل الأنماط داخل السطر، بالترتيب. كل مرحلة تُطبَّق على نص عُمّيت فيه المراحل السابقة.
 * الأطوال محدودة، وأجسام الأنماط داخل نظرة أمامية `(?=(…))\1` فلا يُعاد المسح عبرها عند الفشل؛ بذلك يبقى الزمن
 * خطيًا تقريبًا على سطر طويل مفتوح بلا إغلاق. بلا نظرة خلفية.
 */
const INLINE_STAGES: readonly (readonly RegExp[])[] = [
  // ١. الكود المضمّن (تعليقات HTML و%% والرياضيات المعروضة يمسحها scanPairs خطيًا)
  [/`+[^`\n]{0,2000}`+/g],
  // ٢. العناوين المطلقة (الروابط والتضمينات بالأقواس يمسحها scanBrackets خطيًا)
  [/https?:\/\/[^\s)\]>]+/g],
  // ٣. الرياضيات المضمّنة بقاعدة Obsidian: لا مسافة بعد الفتح ولا قبل الإغلاق ولا رقم بعده؛
  //    وسوم HTML بخصائص بلا حروف عربية؛ الحواشي؛ معرّفات الكتل في آخر السطر
  [
    /\$(?:[^$\s]|[^$\s][^$\n]{0,500}?[^$\s])\$(?!\d)/g,
    /<\/?[A-Za-z][A-Za-z0-9-]{0,50}(?:\s(?=([^<>\n\u0600-\u06ff]{0,500}))\1)?\/?>/g,
    /\[\^[^\]\s]{1,100}\]:?/g,
    /\^[A-Za-z0-9-]{1,100}[ \t]*$/gm,
  ],
];

/**
 * مسح خطي للروابط `[[…]]` و`[…](…)` والتضمينات، في السطر نفسه. إن لم يوجد قافل قبل آخر السطر
 * فلن يوجد لأي فاتح بعده في السطر نفسه، فيُقفَز إلى السطر التالي؛ بذلك لا يتضاعف الزمن على `[[[[…`.
 */
export function scanBrackets(text: string): Range[] {
  const out: Range[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const open = text.indexOf("[", i);
    if (open < 0) break;
    let lineEnd = text.indexOf("\n", open);
    if (lineEnd < 0) lineEnd = n;
    const start = open > 0 && text[open - 1] === "!" ? open - 1 : open;
    if (text[open + 1] === "[") {
      const close = text.indexOf("]]", open + 2);
      if (close < 0 || close > lineEnd) {
        i = lineEnd + 1;
        continue;
      }
      out.push({ start, end: close + 2 });
      i = close + 2;
      continue;
    }
    const close = text.indexOf("]", open + 1);
    if (close < 0 || close > lineEnd) {
      i = lineEnd + 1;
      continue;
    }
    if (text[close + 1] !== "(") {
      i = open + 1;
      continue;
    }
    const paren = text.indexOf(")", close + 2);
    if (paren < 0 || paren > lineEnd) {
      i = lineEnd + 1;
      continue;
    }
    out.push({ start, end: paren + 1 });
    i = paren + 1;
  }
  return out;
}

/** يستخرج وجهة رابط واحد («[[هدف|نص]]» أو «[نص](هدف.md)») ويضيف مفتاحها. */
function addLinkTarget(links: Set<string>, targets: Set<string>, link: string): void {
  const wiki = /^!?\[\[([^\]|#^\\]+)/.exec(link);
  if (wiki) {
    links.add(linkKey(wiki[1] as string));
    addTarget(targets, wiki[1] as string);
    return;
  }
  const md = /\]\(([^)\s#]+)/.exec(link);
  if (!md) return;
  const raw = md[1] as string;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return; // http: وأمثالها ليست ملاحظات
  let target = raw;
  try {
    target = decodeURIComponent(raw);
  } catch {
    /* يبقى كما هو */
  }
  links.add(linkKey(target));
  addTarget(targets, target);
}

function addTarget(targets: Set<string>, target: string): void {
  const t = linkTarget(target);
  if (t) targets.add(t);
}

/** مسح خطي لزوج فاتح/قافل قد يمتد أسطرًا («<!--»/«-->»، «%%»، «$$»): إن لم يوجد قافل بعد فاتح فلن يوجد لما بعده. */
export function scanPairs(text: string, open: string, close: string): Range[] {
  const out: Range[] = [];
  let i = 0;
  while (i < text.length) {
    const s = text.indexOf(open, i);
    if (s < 0) break;
    const e = text.indexOf(close, s + open.length);
    if (e < 0) break;
    out.push({ start: s, end: e + close.length });
    i = e + close.length;
  }
  return out;
}

export function protect(doc: string, cache?: CacheLike): Protection {
  const ranges: Range[] = [];
  const quotes: Range[] = [];
  const tables: Range[] = [];
  const links = new Set<string>();
  const targets = new Set<string>();

  // ١. من البيانات المرسلة
  if (cache) {
    const pos = (p: Pos): Range => ({ start: p.start.offset, end: p.end.offset });
    if (cache.frontmatterPosition) ranges.push(pos(cache.frontmatterPosition));
    for (const l of cache.links ?? []) {
      ranges.push(pos(l.position));
      links.add(linkKey(l.link));
      addTarget(targets, l.link);
    }
    for (const e of cache.embeds ?? []) {
      ranges.push(pos(e.position));
      links.add(linkKey(e.link));
      addTarget(targets, e.link);
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

  // ٢. الماسح: الكتل أولًا (الخصائص، أسوار الكود، العناوين)، ثم الأسطر الموسومة
  const blockRanges: Range[] = [];
  const fm = frontmatterEnd(doc);
  if (fm) blockRanges.push({ start: 0, end: fm });

  let pos = fm;
  let fence: string | null = null;
  let fenceStart = 0;
  for (const line of doc.slice(fm).split("\n")) {
    const lineStart = pos;
    pos += line.length + 1;
    const lineEnd = Math.min(pos, doc.length);
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      // سياج الإغلاق: الرمز نفسه بطول لا يقل، ولا شيء بعده سوى مسافات
      const close = f && (f[1] as string)[0] === fence[0] && (f[1] as string).length >= fence.length && /^\s*$/.test(line.slice(f[0].length));
      if (close) {
        blockRanges.push({ start: fenceStart, end: lineEnd });
        fence = null;
      }
      continue;
    }
    if (f) {
      fence = f[1] as string;
      fenceStart = lineStart;
      continue;
    }
    if (/^ {0,3}#{1,6}(\s|$)/.test(line)) blockRanges.push({ start: lineStart, end: lineEnd });
    else if (/^ {0,3}>/.test(line)) quotes.push({ start: lineStart, end: lineEnd });
    else if (/^ {0,3}\|/.test(line)) tables.push({ start: lineStart, end: lineEnd });
  }
  if (fence) blockRanges.push({ start: fenceStart, end: doc.length });
  ranges.push(...blockRanges);

  // ٣. الأنماط داخل السطر على مراحل، كل مرحلة على نص عُمّي فيه ما سبق
  let work = mask(doc, blockRanges);
  for (const stage of INLINE_STAGES) {
    const found: Range[] = [];
    if (stage === INLINE_STAGES[0]) {
      for (const [o, c] of [["<!--", "-->"], ["%%", "%%"], ["$$", "$$"]] as const) found.push(...scanPairs(work, o, c));
    }
    if (stage === INLINE_STAGES[1]) {
      // الروابط: نطاقاتها محمية، ووجهاتها تُجمع هنا (خارج الكتل والكود المضمّن، فرابط داخل كود ليس ربطًا)
      for (const r of scanBrackets(work)) {
        found.push(r);
        addLinkTarget(links, targets, work.slice(r.start, r.end));
      }
    }
    for (const re of stage) {
      re.lastIndex = 0;
      for (const m of work.matchAll(re)) found.push({ start: m.index, end: m.index + m[0].length });
    }
    // الوسوم مع المرحلة الأخيرة: «#» بعد بداية السطر أو مسافة أو قوس؛ النطاق من «#» لا من قبله
    if (stage === INLINE_STAGES[INLINE_STAGES.length - 1]) {
      for (const m of work.matchAll(/(^|[\s(])#[^\s#()[\]]{1,200}/gm)) {
        const lead = (m[1] as string).length;
        found.push({ start: m.index + lead, end: m.index + m[0].length });
      }
    }
    ranges.push(...found);
    work = mask(work, found);
  }

  return { protected: ranges, quotes, tables, links, targets };
}

/** هل يقع الموضع داخل أحد النطاقات؟ */
export function inRanges(ranges: readonly Range[], offset: number): boolean {
  for (const r of ranges) if (offset >= r.start && offset < r.end) return true;
  return false;
}

/** هل يتقاطع النطاق `[start, end)` مع أحد النطاقات؟ */
export function intersects(ranges: readonly Range[], start: number, end: number): boolean {
  for (const r of ranges) if (start < r.end && end > r.start) return true;
  return false;
}

/** يستبدل النطاقات بمحرف التعمية مع حفظ الأسطر والمواضع، فلا تتكوّن منها كلمات ولا تلتصق كلمتان حولها. */
export function mask(doc: string, ranges: readonly Range[]): string {
  if (!ranges.length) return doc;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const r of sorted) {
    const start = Math.max(r.start, cursor);
    const end = Math.min(r.end, doc.length);
    if (end <= start) continue;
    out += doc.slice(cursor, start);
    out += doc.slice(start, end).replace(/[^\n]/g, MASK_CHAR);
    cursor = end;
  }
  return out + doc.slice(cursor);
}

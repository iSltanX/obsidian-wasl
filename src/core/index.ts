/**
 * فهرس الأسماء: لكل ملاحظة عنوانها وأسماؤها البديلة، ولكل اسم «نواة» تُبحث في النص.
 *
 * النواة = الكلمة الأولى من الاسم بعد تطبيع الفئة (أ) وحذف «ال» من أولها إن كان الاسم معرّفًا.
 * العناوين متعددة الكلمات تحتفظ ببقية كلماتها وفواصلها لتُطابَق حرفيًا بعد النواة.
 * الفهرس صغير: حجمه بعدد الأسماء لا بحجم النصوص.
 */

import { foldInitialHamza, hasLetter, isArabicLetter, isVowelMark, normalize, tokenize, vowelsOf } from "./normalize";

export interface NoteInput {
  /** مسار الملاحظة في الخزينة؛ هو معرّفها. */
  readonly path: string;
  /** العنوان = اسم الملف بلا امتداد. */
  readonly title: string;
  readonly aliases?: readonly string[];
  /** «مطابقة تامة فقط»: لا سوابق ولا نكرة ولا همزة أولى (خاصية `wasl: exact`). */
  readonly exactOnly?: boolean;
  /** اقبل النكرة لعنوان معرّف (خاصية `wasl: indefinite`؛ مطفأ افتراضيًا، القرار ٠٠٠١). */
  readonly indefinite?: boolean;
}

export interface NameEntry {
  readonly note: NoteInput;
  /** الاسم كما كتبه المستخدم (عنوان أو اسم بديل). */
  readonly name: string;
  readonly isAlias: boolean;
  /** مفتاح الاسم المطبّع كاملًا، لمقارنة الروابط. */
  readonly key: string;
  /** هل يبدأ الاسم بـ«ال»؟ */
  readonly definite: boolean;
  /** الكلمة الأولى بعد حذف «ال»، مطبّعة، بهمزتها. */
  readonly core: string;
  /** النواة بعد توحيد الهمزة الأولى؛ مفتاح البحث. */
  readonly coreKey: string;
  /** هل أول حرف في النواة عربي؟ (الـ«ال» قبل كلمة لاتينية مجرد سابقة) */
  readonly arabicCore: boolean;
  /** بقية كلمات الاسم مطبّعة، والفواصل بينها. */
  readonly rest: readonly string[];
  readonly seps: readonly string[];
  /** الحركات الصوتية لكل حرف في كل كلمة (الكلمة ٠ هي النواة)؛ لقاعدة التشكيل المتعارض. */
  readonly vowels: readonly (readonly string[])[];
  /** هل شكّل المستخدم الاسم في حرف غير أخير؟ عندها التشكيل مقصود (القرار ١١). */
  readonly vocalized: boolean;
}

export interface TitleIndex {
  /** النوى بعد توحيد الهمزة ← الأسماء التي تحملها. */
  readonly byCore: ReadonlyMap<string, readonly NameEntry[]>;
  /** مفاتيح العناوين التي تحملها ملاحظتان فأكثر (للتنبيه «ملاحظتان بالاسم نفسه»). */
  readonly ambiguousTitles: ReadonlySet<string>;
  /** مفاتيح كل أسماء كل ملاحظة (العنوان والأسماء البديلة)، لمعرفة «مربوطة في هذه الملاحظة». */
  readonly keysByPath: ReadonlyMap<string, ReadonlySet<string>>;
  /** عدد الأسماء المفهرسة. */
  readonly size: number;
}

/** مفتاح اسم للمقارنة: مطبّع بلا مسافات طرفية. */
export function nameKey(name: string): string {
  return normalize(name).text.trim();
}

/** يبني مدخل اسم واحد، أو `null` إن لم يصلح للبحث (بلا حروف، أو يبدأ أو ينتهي بغير حرف كلمة). */
export function makeEntry(note: NoteInput, name: string, isAlias: boolean): NameEntry | null {
  const n = normalize(name);
  const text = n.text.trim();
  if (!text || !hasLetter(text)) return null;
  const offset = n.text.indexOf(text);
  const toks = tokenize(text);
  const first = toks[0];
  const last = toks[toks.length - 1];
  // الاسم كله كلمات وفواصل؛ ما يبدأ أو ينتهي بترقيم («C++») لا تحدّه الكلمات فلا يُبحث
  if (!first || !last || first.s !== 0 || last.e !== text.length) return null;
  const words = toks.map((t) => text.slice(t.s, t.e));
  const seps = toks.slice(1).map((t, i) => text.slice((toks[i] as { e: number }).e, t.s));
  const firstWord = words[0] as string;
  const definite = firstWord.startsWith("ال") && firstWord.length >= 4;
  const core = definite ? firstWord.slice(2) : firstWord;
  const vowels = toks.map((t, w) => {
    const from = w === 0 && definite ? t.s + 2 : t.s;
    const out: string[] = [];
    for (let i = from; i < t.e; i++) out.push(vowelsOf(n.marks[offset + i] as string));
    return out;
  });
  const vocalized = vowels.some((word) => word.slice(0, -1).some((v) => v.length > 0 && isVowelMark(v.charCodeAt(0))));
  return {
    note,
    name,
    isAlias,
    key: text,
    definite,
    core,
    coreKey: foldInitialHamza(core),
    arabicCore: isArabicLetter(core.charCodeAt(0)),
    rest: words.slice(1),
    seps,
    vowels,
    vocalized,
  };
}

/**
 * يبني الفهرس. `targets` (اختياري) مسارات الملاحظات التي تُفهرس أسماؤها؛ بقية الملاحظات تُستعمل
 * فقط لاكتشاف العناوين المكررة. في الاتجاه الوارد الهدف ملاحظة واحدة: المفتوحة.
 */
export function buildIndex(notes: readonly NoteInput[], targets?: Iterable<string>): TitleIndex {
  const only = targets ? new Set(targets) : null;
  const byCore = new Map<string, NameEntry[]>();
  const keysByPath = new Map<string, Set<string>>();
  const titleCount = new Map<string, number>();
  let size = 0;
  for (const note of notes) {
    const titleKey = nameKey(note.title);
    if (titleKey) titleCount.set(titleKey, (titleCount.get(titleKey) ?? 0) + 1);
    const keys = new Set<string>();
    if (titleKey) keys.add(titleKey);
    for (const a of note.aliases ?? []) {
      const k = nameKey(a);
      if (k) keys.add(k);
    }
    keysByPath.set(note.path, keys);
    if (only && !only.has(note.path)) continue;
    const names: [string, boolean][] = [[note.title, false], ...(note.aliases ?? []).map((a): [string, boolean] => [a, true])];
    const seen = new Set<string>();
    for (const [name, isAlias] of names) {
      const entry = makeEntry(note, name, isAlias);
      if (!entry || seen.has(entry.key)) continue;
      seen.add(entry.key);
      const list = byCore.get(entry.coreKey);
      if (list) list.push(entry);
      else byCore.set(entry.coreKey, [entry]);
      size++;
    }
  }
  const ambiguousTitles = new Set<string>();
  for (const [k, c] of titleCount) if (c > 1) ambiguousTitles.add(k);
  return { byCore, ambiguousTitles, keysByPath, size };
}

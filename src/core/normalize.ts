/**
 * تطبيع الفئة (أ) مع خريطة مواضع إلى النص الأصلي.
 *
 * الفئة (أ) في الدراسة (القسم ٣): فروق كتابية لا تغيّر الكلمة، فتُتجاهل بأمان:
 * الحركات والشدة والتنوين والسكون والألف الخنجرية، والتطويل، والمحارف الخفية،
 * وأشكال العرض المنسوخة من PDF، والأرقام العربية والفارسية، والكاف والياء الفارسيتان،
 * وحالة الأحرف اللاتينية. لا يُستعمل NFD الشامل حتى لا تُحذف الهمزات ضمنًا.
 *
 * قواعد المجلد: لا `obsidian`، لا Node، لا نظرة خلفية، لا خصائص Unicode في التعابير؛ نطاقات صريحة.
 */

export const TATWEEL = 0x0640;

/** حركة أو علامة ملحقة بالحرف الذي قبلها (تشمل الشدة وعلامات القرآن والعلامات اللاتينية المفككة). */
export function isMark(c: number): boolean {
  return (
    (c >= 0x064b && c <= 0x065f) ||
    c === 0x0670 ||
    (c >= 0x0610 && c <= 0x061a) ||
    (c >= 0x06d6 && c <= 0x06ed) ||
    (c >= 0x08ca && c <= 0x08ff) ||
    (c >= 0x0300 && c <= 0x036f)
  );
}

/** حركة تحمل صوتًا: الفتحة والضمة والكسرة والتنوين والسكون والألف الخنجرية. الشدة ليست منها. */
export function isVowelMark(c: number): boolean {
  return (c >= 0x064b && c <= 0x0650) || c === 0x0652 || c === 0x0670;
}

/** محارف لا تُرى: علامات الاتجاه، فاصل عدم الوصل، علامة ترتيب البايتات، الواصلة اللينة. */
export function isInvisible(c: number): boolean {
  return (
    (c >= 0x200b && c <= 0x200f) ||
    (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2060 && c <= 0x2064) ||
    (c >= 0x2066 && c <= 0x2069) ||
    c === 0x061c ||
    c === 0xfeff ||
    c === 0x00ad
  );
}

/** أشكال العرض العربية (Presentation Forms A وB). */
export function isPresentationForm(c: number): boolean {
  return (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfefc);
}

/** الأرقام العربية الهندية والفارسية. */
export function isArabicIndicDigit(c: number): boolean {
  return (c >= 0x0660 && c <= 0x0669) || (c >= 0x06f0 && c <= 0x06f9);
}

export function isSpace(c: number): boolean {
  return (
    c === 0x20 ||
    c === 0x09 ||
    c === 0x0d ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

/** حرف عربي (بلا الحركات والأرقام والتطويل). */
export function isArabicLetter(c: number): boolean {
  return (
    (c >= 0x0620 && c <= 0x063f) ||
    (c >= 0x0641 && c <= 0x064a) ||
    (c >= 0x066e && c <= 0x066f) ||
    (c >= 0x0671 && c <= 0x06d3) ||
    c === 0x06d5 ||
    (c >= 0x06ee && c <= 0x06ef) ||
    (c >= 0x06fa && c <= 0x06fc) ||
    c === 0x06ff ||
    (c >= 0x0750 && c <= 0x077f) ||
    (c >= 0x08a0 && c <= 0x08c9)
  );
}

/**
 * حرف يدخل في بناء الكلمة بعد التطبيع: أرقام لاتينية، حروف لاتينية ولاتينية موسّعة،
 * يونانية وسيريلية وعبرية، عربية، وبعض الكتابات الآسيوية. الحركات والتطويل والترقيم ليست منه.
 */
export function isWordChar(c: number): boolean {
  return (
    (c >= 0x30 && c <= 0x39) ||
    (c >= 0x41 && c <= 0x5a) ||
    (c >= 0x61 && c <= 0x7a) ||
    (c >= 0xc0 && c <= 0xff && c !== 0xd7 && c !== 0xf7) ||
    (c >= 0x100 && c <= 0x24f) ||
    (c >= 0x0370 && c <= 0x03ff) ||
    (c >= 0x0400 && c <= 0x052f) ||
    (c >= 0x05d0 && c <= 0x05ea) ||
    isArabicLetter(c) ||
    (c >= 0x3040 && c <= 0x30ff) ||
    (c >= 0x4e00 && c <= 0x9fff) ||
    (c >= 0xac00 && c <= 0xd7a3)
  );
}

/** تركيب الهمزة والمدة المفككة على الحرف السابق، مثل ا + ٔ = أ، كي لا تضيع الهمزة. */
const COMPOSE: ReadonlyMap<string, string> = new Map([
  ["آ", "آ"],
  ["أ", "أ"],
  ["إ", "إ"],
  ["ؤ", "ؤ"],
  ["ئ", "ئ"],
  ["ىٔ", "ئ"],
]);

export interface Normalized {
  /** النص المطبّع. */
  readonly text: string;
  /** `map[i]` موضع المحرف المطبّع `i` في النص الأصلي (بوحدات UTF-16). */
  readonly map: readonly number[];
  /** `marks[i]` الحركات الملحقة بالمحرف المطبّع `i` كما وردت في الأصل، بترتيبها، أو نص فارغ. */
  readonly marks: readonly string[];
}

/**
 * يطبّع النص ويبني خريطة المواضع.
 * - يُحذف: الحركات (وتُسجَّل في `marks`)، التطويل، المحارف الخفية.
 * - يُوحَّد: أشكال العرض (NFKC للمحرف وحده)، الأرقام إلى لاتينية، ک ی إلى ك ي، اللاتينية إلى حروف صغيرة.
 * - المسافات المتتالية تصير مسافة واحدة، والسطر الجديد يبقى.
 */
export function normalize(text: string): Normalized {
  const out: string[] = [];
  const map: number[] = [];
  const marks: string[] = [];
  const addMark = (m: string): void => {
    if (out.length) marks[out.length - 1] += m;
  };
  const push = (ch: string, i: number): void => {
    out.push(ch);
    map.push(i);
    marks.push("");
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    const c = ch.charCodeAt(0);
    if (c === 0x0653 || c === 0x0654 || c === 0x0655) {
      const last = out.length ? (out[out.length - 1] as string) : "";
      const composed = COMPOSE.get(last + ch);
      if (composed) out[out.length - 1] = composed;
      else addMark(ch);
      continue;
    }
    if (isMark(c)) {
      addMark(ch);
      continue;
    }
    if (c === TATWEEL || isInvisible(c)) continue;
    if (c === 0x0a) {
      push("\n", i);
      continue;
    }
    if (isSpace(c)) {
      if (out.length && out[out.length - 1] !== " ") push(" ", i);
      continue;
    }
    let rep = ch;
    if (isPresentationForm(c)) rep = ch.normalize("NFKC");
    else if (isArabicIndicDigit(c)) rep = String.fromCharCode(0x30 + (c >= 0x06f0 ? c - 0x06f0 : c - 0x0660));
    else if (c === 0x06a9) rep = "ك";
    else if (c === 0x06cc) rep = "ي";
    else if (c >= 0x41 && c < 0x0250) rep = ch.toLowerCase();
    for (let k = 0; k < rep.length; k++) {
      const r = rep[k] as string;
      const rc = r.charCodeAt(0);
      // أشكال العرض قد تحمل حركات أو تطويلًا أو مسافة بعد التفكيك (ﹰ = مسافة + فتحتان)
      if (isMark(rc)) addMark(r);
      else if (rc === TATWEEL) continue;
      else if (isSpace(rc)) {
        if (out.length && out[out.length - 1] !== " ") push(" ", i);
      } else push(r, i);
    }
  }
  return { text: out.join(""), map, marks };
}

export interface Token {
  /** بداية الكلمة في النص المطبّع. */
  readonly s: number;
  /** نهايتها (غير شاملة). */
  readonly e: number;
}

/** يقطّع النص المطبّع إلى كلمات: كل سلسلة متصلة من حروف الكلمة. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let s = -1;
  for (let i = 0; i <= text.length; i++) {
    const w = i < text.length && isWordChar(text.charCodeAt(i));
    if (w && s < 0) s = i;
    else if (!w && s >= 0) {
      tokens.push({ s, e: i });
      s = -1;
    }
  }
  return tokens;
}

/**
 * يحوّل نطاقًا في النص المطبّع `[s, e)` إلى نطاقه في الأصل، ويمدّ النهاية فوق الحركات
 * الملحقة بالحرف الأخير حتى يبقى المقطع الظاهر كلمة كاملة بحركاتها («الكتابةِ»).
 */
export function originalRange(n: Normalized, original: string, s: number, e: number): [number, number] {
  const start = n.map[s] as number;
  let end = (n.map[e - 1] as number) + 1;
  while (end < original.length && isMark(original.charCodeAt(end))) end++;
  return [start, end];
}

/** الحركات الصوتية وحدها من سلسلة علامات، مرتّبة؛ لمقارنة التشكيل حرفًا بحرف. */
export function vowelsOf(marks: string): string {
  if (!marks) return "";
  const v: string[] = [];
  for (let i = 0; i < marks.length; i++) {
    const c = marks.charCodeAt(i);
    if (isVowelMark(c)) v.push(marks[i] as string);
  }
  return v.sort().join("");
}

/** يوحّد همزة القطع والمدة والوصل في أول الكلمة إلى ألف، للبحث فقط (الفئة ب). */
export function foldInitialHamza(word: string): string {
  const c = word.charCodeAt(0);
  // أ إ آ ٱ
  return c === 0x0623 || c === 0x0625 || c === 0x0622 || c === 0x0671 ? "ا" + word.slice(1) : word;
}

/** هل في النص حرف واحد على الأقل (لا أرقام فقط)؟ */
export function hasLetter(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (isWordChar(c) && !(c >= 0x30 && c <= 0x39)) return true;
  }
  return false;
}

/**
 * المطابقة: البحث عن نوى الأسماء في النص المطبّع، فحص الحدود، التصنيف إلى طبقات مع السبب.
 *
 * الخوارزمية (ب) في الدراسة:
 * 1. النص يُحمى (protect) ثم يُطبّع مع خريطة مواضع (normalize) ويُقطّع إلى كلمات.
 * 2. لكل كلمة، تُجرَّب سلاسل السوابق المغلقة: (و|ف)? (ب|ك|ل)? (ال)? مع قاعدة «لل»،
 *    وما يبقى بعد السابقة يُبحث عنه في الفهرس نواةً (أو نواةً + لاحقة ضميرية للطبقة ٢).
 * 3. العناوين متعددة الكلمات: السابقة على الكلمة الأولى فقط، وبقية الكلمات تُطابَق حرفيًا.
 * 4. التصنيف: الطبقة ٠ تطابق، ١ سابقة أو همزة أولى أو نكرة/تعريف، ٢ محتمل.
 *    قواعد الحماية: لا نزع عن نواة من حرفين؛ سابقة مفردة على نواة من ثلاثة أحرف ← ٢؛
 *    النكرة لا تُقترح إلا بخيار `indefinite`؛ «مطابقة تامة فقط» تُسقط كل ما ليس طبقة ٠.
 * 5. التشكيل المتعارض (القرار ١١): إن شُكّل العنوان، فالموضع المشكول بحركة مختلفة في الحرف نفسه
 *    يُسقط، وغير المشكول ينزل إلى ٢ موسومًا. حركة الحرف الأخير إعراب فلا تُقارن.
 * 6. الأعلام: اقتباس، جدول، مربوطة في هذه الملاحظة، ملاحظتان بالاسم نفسه.
 *
 * بلا نظرة خلفية: الحدود تُفحص برمجيًا على الكلمات المقطّعة.
 */

import type { NameEntry, TitleIndex } from "./index";
import {
  foldInitialHamza,
  isArabicIndicDigit,
  isInvisible,
  isMark,
  isPresentationForm,
  normalize,
  originalRange,
  tokenize,
  TATWEEL,
  vowelsOf,
  type Normalized,
  type Token,
} from "./normalize";
import { inRanges, mask, protect, type CacheLike } from "./protect";

export type Layer = 0 | 1 | 2;

export type ReasonCode =
  | "exact"
  | "prefix"
  | "lam-lam"
  | "indefinite"
  | "definite"
  | "initial-hamza"
  | "short-core"
  | "suffix"
  | "alias"
  | "diacritics"
  | "tatweel"
  | "invisible"
  | "presentation-forms"
  | "digits"
  | "persian-letters"
  | "case";

export interface Reason {
  readonly code: ReasonCode;
  /** تفصيل للعرض: السابقة كما كُتبت («وبال»)، أو اللاحقة («ها»). */
  readonly detail?: string;
}

export type Flag = "quote" | "table" | "already-linked" | "ambiguous-target" | "unvocalized";

export interface Mention {
  /** مسار الملاحظة الهدف (الوجهة). */
  readonly path: string;
  /** الاسم الذي طابق (عنوان أو اسم بديل) كما كتبه المستخدم. */
  readonly name: string;
  readonly isAlias: boolean;
  /** نطاق الكلمة كاملة في النص الأصلي؛ `surface` هو النص الظاهر للرابط (القرار ٤). */
  readonly start: number;
  readonly end: number;
  readonly surface: string;
  readonly layer: Layer;
  readonly reasons: readonly Reason[];
  readonly flags: readonly Flag[];
}

export interface MatchOptions {
  /** مسار الملاحظة الممسوحة؛ لا يُقترح ربط ملاحظة بنفسها. */
  readonly sourcePath?: string;
  /** بيانات Obsidian للملاحظة إن توفرت. */
  readonly cache?: CacheLike;
}

interface Chain {
  readonly text: string;
  readonly conj: string;
  readonly prep: string;
  readonly art: boolean;
  /** «لل» المدمجة: ل + ال + كلمة تبدأ بلام تُكتب بلامين («للغة»)، فالنواة تبدأ بما بعد لام واحدة. */
  readonly mergedLam: boolean;
}

const CHAINS: readonly Chain[] = (() => {
  const out: Chain[] = [];
  for (const conj of ["", "و", "ف"]) {
    for (const prep of ["", "ب", "ك", "ل"]) {
      for (const art of [false, true]) {
        const article = art ? (prep === "ل" ? "ل" : "ال") : "";
        out.push({ text: conj + prep + article, conj, prep, art, mergedLam: false });
      }
      if (prep === "ل") out.push({ text: conj + "ل", conj, prep, art: true, mergedLam: true });
    }
  }
  return out;
})();

/** اللواحق الضميرية، الأطول أولًا. */
const SUFFIXES: readonly string[] = ["هما", "كما", "ها", "هم", "هن", "كم", "كن", "نا", "ه", "ك", "ي"];

interface Classified {
  layer: Layer;
  readonly reasons: Reason[];
}

function classify(entry: NameEntry, chain: Chain, hamzaDiffers: boolean, suffix: string | null): Classified | null {
  const coreLen = entry.core.length;
  const clitics = chain.conj + chain.prep;
  const reasons: Reason[] = [];
  let layer: Layer;
  const prefix = (): void => {
    reasons.push({ code: "prefix", detail: clitics + (chain.art ? "ال" : "") });
    if (chain.prep === "ل" && chain.art) reasons.push({ code: "lam-lam" });
  };
  const shortCoreGuard = (): void => {
    if (clitics.length === 1 && coreLen <= 3) {
      layer = 2;
      reasons.push({ code: "short-core" });
    }
  };

  if (entry.definite) {
    if (chain.art) {
      layer = clitics ? 1 : 0;
      if (clitics) prefix();
    } else {
      // العنوان معرّف والنص بلا «ال»
      if (coreLen <= 2) return null;
      if (suffix) {
        // المضاف إلى ضمير معرّف بالإضافة؛ لا يحتاج خيار النكرة
        layer = 2;
      } else {
        if (!entry.note.indefinite) return null;
        layer = 1;
        reasons.push({ code: "indefinite" });
      }
      if (clitics) {
        prefix();
        shortCoreGuard();
      }
    }
  } else if (chain.art) {
    if (!entry.arabicCore) {
      // «بالـPython»: «ال» قبل كلمة لاتينية مجرد سابقة
      layer = 1;
      prefix();
    } else {
      if (coreLen <= 2) return null;
      layer = 1;
      reasons.push({ code: "definite" });
      if (clitics) prefix();
    }
  } else if (!clitics) {
    layer = 0;
  } else {
    if (coreLen <= 2) return null;
    layer = 1;
    prefix();
    shortCoreGuard();
  }

  if (suffix) {
    if (coreLen <= 2) return null;
    layer = 2;
    reasons.push({ code: "suffix", detail: suffix });
  }
  if (hamzaDiffers) {
    reasons.push({ code: "initial-hamza" });
    if (layer === 0) layer = 1;
  }
  if (entry.note.exactOnly && (clitics || chain.art !== entry.definite || hamzaDiffers || suffix)) return null;
  if (entry.isAlias) reasons.push({ code: "alias" });
  return { layer, reasons };
}

/** أسباب الفئة (أ): ما في المقطع الأصلي من فروق كتابية تجاهلناها. */
function surfaceReasons(surface: string, name: string, titleHasMarks: boolean): Reason[] {
  const r = new Set<ReasonCode>();
  for (let i = 0; i < surface.length; i++) {
    const c = surface.charCodeAt(i);
    if (isMark(c)) r.add("diacritics");
    else if (c === TATWEEL) r.add("tatweel");
    else if (isInvisible(c)) r.add("invisible");
    else if (isPresentationForm(c)) r.add("presentation-forms");
    else if (isArabicIndicDigit(c)) r.add("digits");
    else if (c === 0x06a9 || c === 0x06cc) r.add("persian-letters");
  }
  if (titleHasMarks) r.add("diacritics");
  if (surface !== name && surface.toLowerCase() === name.toLowerCase()) r.add("case");
  return [...r].map((code) => ({ code }));
}

type Vocalization = "match" | "unvocalized" | "conflict";

/**
 * يقارن حركات العنوان بحركات الموضع حرفًا بحرف في كل كلمة، عدا الحرف الأخير (إعراب).
 * `wordStarts[w]` موضع أول حرف من الكلمة `w` في النص المطبّع (الكلمة ٠ تبدأ بالنواة لا بالسابقة).
 */
function compareVowels(entry: NameEntry, n: Normalized, wordStarts: readonly number[]): Vocalization {
  let unvocalized = false;
  for (let w = 0; w < entry.vowels.length; w++) {
    const tv = entry.vowels[w] as readonly string[];
    const start = wordStarts[w] as number;
    for (let i = 0; i < tv.length - 1; i++) {
      const t = tv[i] as string;
      if (!t) continue;
      const d = vowelsOf(n.marks[start + i] as string);
      if (!d) unvocalized = true;
      else if (d !== t) return "conflict";
    }
  }
  return unvocalized ? "unvocalized" : "match";
}

function hasMarks(name: string): boolean {
  for (let i = 0; i < name.length; i++) if (isMark(name.charCodeAt(i))) return true;
  return false;
}

interface Candidate {
  readonly entry: NameEntry;
  readonly chain: Chain;
  readonly suffix: string | null;
  /** بداية النواة داخل الكلمة المطبّعة. */
  readonly coreStart: number;
  readonly hamzaDiffers: boolean;
}

/** المرشحون من كلمة واحدة: كل سلسلة سوابق تترك نواة موجودة في الفهرس، بلاحقة أو بدونها. */
function candidatesFor(word: string, tokStart: number, index: TitleIndex): Candidate[] {
  const out: Candidate[] = [];
  for (const chain of CHAINS) {
    if (word.length <= chain.text.length || !word.startsWith(chain.text)) continue;
    const rest = word.slice(chain.text.length);
    if (chain.mergedLam && rest[0] !== "ل") continue;
    const tryCore = (core: string, suffix: string | null): void => {
      const list = index.byCore.get(foldInitialHamza(core));
      if (!list) return;
      for (const entry of list) {
        if (chain.mergedLam && !entry.definite) continue;
        if (suffix && entry.rest.length) continue; // اللاحقة على اسم من كلمة واحدة فقط
        out.push({ entry, chain, suffix, coreStart: tokStart + chain.text.length, hamzaDiffers: core[0] !== entry.core[0] });
      }
    };
    tryCore(rest, null);
    for (const suffix of SUFFIXES) {
      if (rest.length <= suffix.length + 2 || !rest.endsWith(suffix)) continue;
      const base = rest.slice(0, -suffix.length);
      tryCore(base, suffix);
      if (base.endsWith("ت")) tryCore(base.slice(0, -1) + "ة", suffix);
    }
  }
  return out;
}

function better(a: Mention, b: Mention): boolean {
  if (a.layer !== b.layer) return a.layer < b.layer;
  if (a.isAlias !== b.isAlias) return !a.isAlias;
  return a.reasons.length < b.reasons.length;
}

/**
 * يبحث في ملاحظة عن مواضع أسماء الفهرس. النتائج مرتبة بالموضع، وفي كل كلمة أفضل مطابقة
 * واحدة لكل ملاحظة هدف (الطبقة الأدنى، ثم العنوان قبل الاسم البديل).
 */
export function findMentions(doc: string, index: TitleIndex, opts: MatchOptions = {}): Mention[] {
  if (!index.size) return [];
  const prot = protect(doc, opts.cache);
  const n = normalize(mask(doc, prot.protected));
  const tokens = tokenize(n.text);
  const best = new Map<string, Mention>();

  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti] as Token;
    const word = n.text.slice(tok.s, tok.e);
    for (const cand of candidatesFor(word, tok.s, index)) {
      const { entry, chain, suffix } = cand;
      if (entry.note.path === opts.sourcePath) continue;

      // بقية كلمات العنوان المركّب حرفيًا بعد النواة، بالفواصل نفسها
      let endTok = tok;
      const wordStarts: number[] = [cand.coreStart];
      let ok = true;
      for (let k = 0; k < entry.rest.length; k++) {
        const prev = tokens[ti + k] as Token;
        const next = tokens[ti + 1 + k];
        if (!next || n.text.slice(prev.e, next.s) !== entry.seps[k] || n.text.slice(next.s, next.e) !== entry.rest[k]) {
          ok = false;
          break;
        }
        wordStarts.push(next.s);
        endTok = next;
      }
      if (!ok) continue;

      const res = classify(entry, chain, cand.hamzaDiffers, suffix);
      if (!res) continue;
      const flags: Flag[] = [];
      if (entry.vocalized) {
        const v = compareVowels(entry, n, wordStarts);
        if (v === "conflict") continue;
        if (v === "unvocalized") {
          res.layer = 2;
          flags.push("unvocalized");
        }
      }

      const [start, end] = originalRange(n, doc, tok.s, endTok.e);
      const surface = doc.slice(start, end);
      const reasons = [...res.reasons, ...surfaceReasons(surface, entry.name, hasMarks(entry.name))];
      if (!reasons.length) reasons.push({ code: "exact" });
      if (inRanges(prot.quotes, start)) flags.push("quote");
      if (inRanges(prot.tables, start)) flags.push("table");
      const keys = index.keysByPath.get(entry.note.path);
      if (keys) {
        let linked = false;
        for (const k of keys) if (prot.links.has(k)) linked = true;
        if (linked) flags.push("already-linked");
        if (index.ambiguousTitles.has(keys.values().next().value as string)) flags.push("ambiguous-target");
      }

      const mention: Mention = { path: entry.note.path, name: entry.name, isAlias: entry.isAlias, start, end, surface, layer: res.layer, reasons, flags };
      const key = entry.note.path + "\u0000" + ti;
      const prev = best.get(key);
      if (!prev || better(mention, prev)) best.set(key, mention);
    }
  }
  return [...best.values()].sort((a, b) => a.start - b.start || a.path.localeCompare(b.path));
}

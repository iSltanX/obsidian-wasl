/**
 * نصوص الواجهة بالعربية والإنجليزية. العربية أولًا: الجموع والإعراب بعد الأعداد عبر `Intl.PluralRules`،
 * والأرقام الهندية العربية (٣٤) في العربية عبر `Intl.NumberFormat`.
 * نقي بلا `obsidian`؛ لغة Obsidian تُمرَّر من الخارج.
 */

import type { LanguageSetting } from "./settings";

export type Lang = "ar" | "en";

/** التلقائية تتبع لغة Obsidian (`moment.locale()`): العربية إن بدأت بـ«ar»، وإلا الإنجليزية. */
export function resolveLang(setting: LanguageSetting, appLocale: string): Lang {
  if (setting !== "auto") return setting;
  return appLocale.toLowerCase().startsWith("ar") ? "ar" : "en";
}

type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const AR = {
  viewTitle: "وصل",
  commandShow: "اعرض المواضع غير المربوطة",
  noNote: "افتح ملاحظة لترى أين ذُكرت ولم تُربط.",
  unsearchable: "لا يمكن البحث عن «{name}»: الاسم بلا حروف أو ملتصق برموز. أضف له اسمًا بديلًا بحروف.",
  exactOnly: "مطابقة تامة فقط",
  indefinite: "تقبل بلا «ال»",
  ambiguous: "توجد ملاحظة أخرى بالاسم نفسه في {folders}. سيحمل الرابط اسم المجلد ليُفرَّق بينهما.",
  rootFolder: "المجلد الرئيسي",
  listSep: "، ",
  openNow: "المفتوحة الآن: «{name}»",
  showActive: "اعرض مواضعها",
  rescan: "أعد البحث",
  stop: "أوقف البحث",
  resume: "أكمل",
  retry: "أعد المحاولة",
  searching: "يبحث…",
  scanning: "يبحث… {done} من {notes}",
  stopped: "أُوقف البحث بعد {done} من {notes}. النتائج جزئية.",
  failed: "توقف البحث بسبب خطأ.",
  none: "لم يُعثر على ذكر بلا رابط لـ«{name}» في {notes}.",
  summary: "{mentions} في {notes}",
  hiddenBySettings: "مخفية بالإعدادات: {n}",
  openSettings: "افتح الإعدادات",
  readErrors: "تعذّرت قراءة {notes}.",
  sectionMain: "مواضع",
  sectionPossible: "مواضع محتملة",
  possibleHint: "أقل يقينًا: ضمير متصل، أو سابقة على اسم قصير، أو كلمة بلا تشكيل.",
  showRest: "اعرض الباقي ({n})",
  link: "اربط",
  ignore: "تجاهل",
  open: "افتح",
  more: "المزيد",
  ignoreForm: "لا تقترح هذه الكلمة لهذه الملاحظة (قريبًا)",
  comingLater: "متاح في نسخة قادمة.",
  sourceGone: "لم تعد هذه الملاحظة موجودة.",
  // الوسوم (docs/ui.md، البند ٦)
  tagExact: "تطابق",
  tagPrefix: "سابقة: {d}",
  tagHamza: "همزة مختلفة",
  tagIndefinite: "بلا «ال»",
  tagDefinite: "مع «ال»",
  tagSuffix: "ضمير: {d}",
  tagShortCore: "اسم قصير",
  tagAlias: "اسم بديل: {d}",
  tagDiacritics: "تشكيل",
  tagTatweel: "تطويل",
  tagInvisible: "رموز خفية",
  tagPresentation: "شكل حروف مختلف",
  tagDigits: "أرقام بشكل آخر",
  tagPersian: "حروف فارسية",
  tagCase: "كبيرة/صغيرة",
  tagQuote: "داخل اقتباس",
  tagTable: "داخل جدول",
  tagLinked: "مربوطة في موضع آخر",
  tagUnvocalized: "بلا تشكيل (العنوان مشكول)",
  // الإعدادات (البند ٨)
  setExcluded: "مجلدات مستثناة",
  setExcludedDesc: "لا يُبحث في الملاحظات داخلها. مجلد في كل سطر.",
  setPossible: "المواضع المحتملة",
  setPossibleDesc: "مواضع أقل يقينًا، مثل ضمير متصل أو سابقة على اسم قصير.",
  setPossibleCollapsed: "مطوية",
  setPossibleHidden: "مخفية",
  setQuotes: "مواضع داخل اقتباس",
  setQuotesDesc: "كلام منقول عن غيرك قد لا تريد ربطه.",
  setQuotesTagged: "تظهر مع علامة",
  setQuotesHidden: "مخفية",
  setFirst: "أول ذكر فقط",
  setFirstDesc: "في كل ملاحظة يظهر أول موضع فقط، ولا يظهر شيء من ملاحظة تربط الهدف من قبل.",
  setLanguage: "لغة الواجهة",
  setLanguageDesc: "التلقائية تتبع لغة Obsidian.",
  setLanguageAuto: "تلقائية",
  setPropertyHeading: "خاصية الملاحظة",
  setPropertyDesc: "أضف إلى خصائص الملاحظة التي تريد مواضعها:",
  setPropertyExact: "مطابقة تامة فقط: لا سوابق ولا «ال» ولا همزة مختلفة. لأسماء الأشخاص.",
  setPropertyIndefinite: "اقبل الكلمة بلا «ال» لعنوان معرّف («كتابة» لـ«الكتابة»). لملاحظات المفاهيم.",
};

export type Key = keyof typeof AR;

const EN: Record<Key, string> = {
  viewTitle: "Wasl",
  commandShow: "Show unlinked mentions",
  noNote: "Open a note to see where it is mentioned but not linked.",
  unsearchable: "Can't search for “{name}”: the name has no letters or is joined to symbols. Add an alias with letters.",
  exactOnly: "Exact only",
  indefinite: "Accepts without «ال»",
  ambiguous: "Another note has the same name in {folders}. Links will include the folder to tell them apart.",
  rootFolder: "the vault root",
  listSep: ", ",
  openNow: "Open now: “{name}”",
  showActive: "Show its mentions",
  rescan: "Search again",
  stop: "Stop search",
  resume: "Continue",
  retry: "Try again",
  searching: "Searching…",
  scanning: "Searching… {done} of {notes}",
  stopped: "Search stopped after {done} of {notes}. Results are partial.",
  failed: "The search stopped because of an error.",
  none: "No unlinked mentions of “{name}” in {notes}.",
  summary: "{mentions} in {notes}",
  hiddenBySettings: "Hidden by settings: {n}",
  openSettings: "Open settings",
  readErrors: "Couldn't read {notes}.",
  sectionMain: "Mentions",
  sectionPossible: "Possible mentions",
  possibleHint: "Less certain: an attached pronoun, a prefix on a short name, or an unvocalized word.",
  showRest: "Show the rest ({n})",
  link: "Link",
  ignore: "Ignore",
  open: "Open",
  more: "More",
  ignoreForm: "Don't suggest this word for this note (soon)",
  comingLater: "Available in a later version.",
  sourceGone: "This note no longer exists.",
  tagExact: "Exact",
  tagPrefix: "Prefix: {d}",
  tagHamza: "Different hamza",
  tagIndefinite: "Without «ال»",
  tagDefinite: "With «ال»",
  tagSuffix: "Suffix: {d}",
  tagShortCore: "Short name",
  tagAlias: "Alias: {d}",
  tagDiacritics: "Diacritics",
  tagTatweel: "Tatweel",
  tagInvisible: "Hidden characters",
  tagPresentation: "Presentation forms",
  tagDigits: "Other digits",
  tagPersian: "Persian letters",
  tagCase: "Letter case",
  tagQuote: "In a quote",
  tagTable: "In a table",
  tagLinked: "Linked elsewhere in this note",
  tagUnvocalized: "Unvocalized (title is vocalized)",
  setExcluded: "Excluded folders",
  setExcludedDesc: "Notes inside these folders aren't searched. One folder per line.",
  setPossible: "Possible mentions",
  setPossibleDesc: "Less certain mentions, such as an attached pronoun or a prefix on a short name.",
  setPossibleCollapsed: "Collapsed",
  setPossibleHidden: "Hidden",
  setQuotes: "Mentions inside quotes",
  setQuotesDesc: "Quoted words you may not want to link.",
  setQuotesTagged: "Shown with a tag",
  setQuotesHidden: "Hidden",
  setFirst: "First mention only",
  setFirstDesc: "Show only the first mention in each note, and nothing from notes that already link the target.",
  setLanguage: "Interface language",
  setLanguageDesc: "Automatic follows Obsidian's language.",
  setLanguageAuto: "Automatic",
  setPropertyHeading: "Note property",
  setPropertyDesc: "Add to the properties of the note whose mentions you want:",
  setPropertyExact: "Exact match only: no prefixes, no «ال», no hamza variants. For people's names.",
  setPropertyIndefinite: "Accept the word without «ال» for a definite title («كتابة» for «الكتابة»). For concept notes.",
};

/** «موضع» مرفوعًا بعد العدد. */
const MENTIONS: Record<Lang, PluralForms> = {
  ar: { zero: "لا مواضع", one: "موضع واحد", two: "موضعان", few: "{n} مواضع", many: "{n} موضعًا", other: "{n} موضع" },
  en: { one: "{n} mention", other: "{n} mentions" },
};

/** «ملاحظة» مجرورة (بعد «في» و«من» و«قراءة»). */
const NOTES: Record<Lang, PluralForms> = {
  ar: { one: "ملاحظة واحدة", two: "ملاحظتين", few: "{n} ملاحظات", many: "{n} ملاحظة", other: "{n} ملاحظة" },
  en: { one: "{n} note", other: "{n} notes" },
};

/** «، منها ٥ مواضع محتملة»: العدد والمعدود والصفة متطابقة. */
const POSSIBLE_OF: Record<Lang, PluralForms> = {
  ar: {
    one: "، منها موضع محتمل",
    two: "، منها موضعان محتملان",
    few: "، منها {n} مواضع محتملة",
    many: "، منها {n} موضعًا محتملًا",
    other: "، منها {n} موضع محتمل",
  },
  en: { one: ", {n} of them possible", other: ", {n} of them possible" },
};

export interface Strings {
  readonly lang: Lang;
  t(key: Key, vars?: Record<string, string | number>): string;
  num(n: number): string;
  mentions(n: number): string;
  notes(n: number): string;
  possibleOf(n: number): string;
}

export function strings(lang: Lang): Strings {
  const table: Record<Key, string> = lang === "ar" ? AR : EN;
  // CLDR الحديث يجعل الأرقام اللاتينية افتراضية لـ«ar»؛ العقد يطلب الهندية العربية (٣٤)
  const nf = new Intl.NumberFormat(lang === "ar" ? "ar-u-nu-arab" : "en");
  const pr = new Intl.PluralRules(lang);
  const num = (n: number): string => nf.format(n);
  const fill = (s: string, vars: Record<string, string | number>): string =>
    s.replace(/\{(\w+)\}/g, (m, k: string) => {
      const v = vars[k];
      return v === undefined ? m : typeof v === "number" ? num(v) : v;
    });
  const plural = (forms: PluralForms, n: number): string => fill(forms[pr.select(n)] ?? forms.other, { n });
  return {
    lang,
    t: (key, vars) => fill(table[key], vars ?? {}),
    num,
    mentions: (n) => plural(MENTIONS[lang], n),
    notes: (n) => plural(NOTES[lang], n),
    possibleOf: (n) => (n > 0 ? plural(POSSIBLE_OF[lang], n) : ""),
  };
}

/**
 * إعدادات وصل وخيارات الملاحظة. دوال نقية بلا `obsidian` كي تُختبر خارج التطبيق.
 * العقد: docs/ui.md، البند ٨.
 */

export type PossibleMode = "collapsed" | "hidden";
export type QuoteMode = "tagged" | "hidden";
export type LanguageSetting = "auto" | "ar" | "en";

export interface WaslSettings {
  /** مجلدات لا تُمسح ملاحظاتها (مسارات نسبية بلا شرطة أولى أو أخيرة). */
  excludedFolders: string[];
  /** قسم «محتمل» (الطبقة ٢): مطوي أو مخفي (القرار ٣). */
  possible: PossibleMode;
  /** المواضع داخل اقتباس: موسومة أو مخفية (القرار ٥). */
  quotes: QuoteMode;
  /** أول موضع فقط في كل ملاحظة مصدر. */
  firstMentionOnly: boolean;
  /** لغة الواجهة؛ التلقائية تتبع لغة Obsidian. */
  language: LanguageSetting;
}

export const DEFAULT_SETTINGS: Readonly<WaslSettings> = {
  excludedFolders: [],
  possible: "collapsed",
  quotes: "tagged",
  firstMentionOnly: false,
  language: "auto",
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** يقرأ ما في `data.json` ويصحّح كل حقل على حدة؛ الحقل التالف يرجع إلى الافتراضي ولا يُسقط البقية. */
export function readSettings(raw: unknown): WaslSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    excludedFolders: Array.isArray(r.excludedFolders)
      ? cleanFolders(r.excludedFolders.filter((f): f is string => typeof f === "string"))
      : [],
    possible: oneOf(r.possible, ["collapsed", "hidden"], DEFAULT_SETTINGS.possible),
    quotes: oneOf(r.quotes, ["tagged", "hidden"], DEFAULT_SETTINGS.quotes),
    firstMentionOnly: typeof r.firstMentionOnly === "boolean" ? r.firstMentionOnly : DEFAULT_SETTINGS.firstMentionOnly,
    language: oneOf(r.language, ["auto", "ar", "en"], DEFAULT_SETTINGS.language),
  };
}

/** مسار مجلد بصيغة واحدة: NFC، شرطات أمامية، بلا «./» ولا شرطات طرفية. */
export function cleanFolder(folder: string): string {
  return folder
    .normalize("NFC")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/^\/+|\/+$/g, "");
}

export function cleanFolders(folders: readonly string[]): string[] {
  const out: string[] = [];
  for (const f of folders) {
    const c = cleanFolder(f);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** نص الإعداد (مجلد في كل سطر) ← قائمة. */
export function parseFolderList(text: string): string[] {
  return cleanFolders(text.split(/\r?\n/));
}

/** هل الملف داخل أحد المجلدات المستثناة (أو هو المجلد نفسه)؟ */
export function isExcluded(path: string, folders: readonly string[]): boolean {
  if (!folders.length) return false;
  const p = path.normalize("NFC");
  for (const f of folders) if (p === f || p.startsWith(f + "/")) return true;
  return false;
}

export interface NoteOptions {
  readonly exactOnly: boolean;
  readonly indefinite: boolean;
}

/**
 * خاصية `wasl` في الملاحظة: `exact` أو `indefinite`، نصًا أو قائمة، بلا حساسية لحالة الأحرف.
 * إن اجتمعتا غلبت `exact` لأنها الأضيق.
 */
export function noteOptions(value: unknown): NoteOptions {
  const words = (Array.isArray(value) ? value : [value])
    .filter((v): v is string => typeof v === "string")
    .flatMap((v) => v.split(/[\s,]+/))
    .map((v) => v.trim().toLowerCase());
  const exactOnly = words.includes("exact");
  return { exactOnly, indefinite: !exactOnly && words.includes("indefinite") };
}

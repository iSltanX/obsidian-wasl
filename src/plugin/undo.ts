/**
 * سجل التراجع الداخلي (الدراسة، الجزء الثاني هـ-٥): لكل ربط الملف والموضع والمقطع والرابط كما كُتب.
 * يبقى في الذاكرة ما دامت الإضافة محمّلة، ويحتفظ بآخر خمسين ربطًا. التراجع يتحقق أولًا أن الرابط
 * ما زال كما كُتب: في موضعه، أو في موضع واحد آخر إن تحرّك النص. نقي بلا `obsidian`.
 */

export interface LinkRecord {
  readonly path: string;
  readonly start: number;
  /** المقطع الأصلي الذي حلّ الرابط محلّه. */
  readonly surface: string;
  /** الرابط كما كُتب حرفيًا. */
  readonly link: string;
  readonly at: number;
}

export class UndoLog {
  private items: LinkRecord[] = [];

  constructor(private readonly max = 50) {}

  push(r: LinkRecord): void {
    this.items.push(r);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }

  get last(): LinkRecord | undefined {
    return this.items[this.items.length - 1];
  }

  pop(): LinkRecord | undefined {
    return this.items.pop();
  }

  get size(): number {
    return this.items.length;
  }

  /** ملف أو مجلد نُقل: تتبعه سجلاته. */
  rename(oldPath: string, newPath: string): void {
    this.items = this.items.map((r) => {
      if (r.path === oldPath) return { ...r, path: newPath };
      if (r.path.startsWith(oldPath + "/")) return { ...r, path: newPath + r.path.slice(oldPath.length) };
      return r;
    });
  }

  /** ملف أو مجلد حُذف: لا شيء يُتراجع عنه فيه. */
  drop(path: string): void {
    this.items = this.items.filter((r) => r.path !== path && !r.path.startsWith(path + "/"));
  }
}

export type Reverted = { readonly ok: true; readonly text: string; readonly start: number; readonly end: number } | { readonly ok: false; readonly reason: "changed" | "ambiguous" };

/** يعيد المقطع مكان الرابط إن كان الرابط ما زال كما كُتب، في موضعه أو في موضع واحد غيره. */
export function revertLink(doc: string, r: LinkRecord): Reverted {
  let start = -1;
  if (doc.startsWith(r.link, r.start)) {
    start = r.start;
  } else {
    const first = doc.indexOf(r.link);
    if (first < 0) return { ok: false, reason: "changed" };
    if (doc.indexOf(r.link, first + 1) >= 0) return { ok: false, reason: "ambiguous" };
    start = first;
  }
  const end = start + r.link.length;
  return { ok: true, text: doc.slice(0, start) + r.surface + doc.slice(end), start, end };
}

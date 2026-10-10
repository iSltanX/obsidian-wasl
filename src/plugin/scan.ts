/**
 * مسح الملاحظات بحثًا عن مواضع الهدف. نقي بلا `obsidian`: الوصول إلى الخزينة عبر `ScanHost`.
 */

import { buildIndex, nameKey, type NoteInput, type TitleIndex } from "../core/index";
import { findMentions } from "../core/match";
import type { CacheLike } from "../core/protect";
import { withContext, type Found } from "./context";

/** ما يلزم من ملاحظة لا يُفهرس اسمها: عنوانها وأسماؤها البديلة، لاكتشاف الأسماء المشتركة. */
export interface NoteRef {
  readonly path: string;
  readonly title: string;
  readonly aliases?: readonly string[];
}

/** اسم من أسماء الهدف تحمله ملاحظات أخرى عنوانًا أو اسمًا بديلًا (الدراسة، القسم ٥ «تعدد الوجهات»). */
export interface SharedName {
  readonly name: string;
  readonly paths: readonly string[];
}

export interface Target {
  readonly note: NoteInput;
  readonly index: TitleIndex;
  /** بصمة كل ما يغيّر نتيجة المسح من جهة الهدف؛ مفتاح الذاكرة. */
  readonly sig: string;
  /** ملاحظات أخرى بالعنوان نفسه (تنبيه الالتباس). */
  readonly sameTitle: readonly string[];
  /** أسماء الهدف التي تشترك فيها ملاحظات أخرى، عدا تطابق العنوانين (له `sameTitle`). */
  readonly sharedNames: readonly SharedName[];
}

/** نسخة قواعد النواة في البصمة: تُرفع حين تتغير القواعد فلا تُعرض نتائج قديمة. */
const CORE_VERSION = 1;

export function makeTarget(note: NoteInput, notes: readonly NoteRef[]): Target {
  const others = notes.filter((n) => n.path !== note.path);
  const index = buildIndex([note, ...others], [note.path]);
  const key = nameKey(note.title);
  const sameTitle = key ? others.filter((n) => nameKey(n.title) === key).map((n) => n.path) : [];
  // من مفاتيح الفهرس الجاهزة (العناوين والأسماء البديلة مطبّعة)، لا تطبيع ثانٍ لكل ملاحظة
  const sharedNames: SharedName[] = [];
  const seen = new Set<string>();
  for (const [name, isTitle] of [[note.title, true], ...(note.aliases ?? []).map((a): [string, boolean] => [a, false])] as [string, boolean][]) {
    const k = nameKey(name);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const paths: string[] = [];
    for (const n of others) {
      if (!index.keysByPath.get(n.path)?.has(k)) continue;
      // عنوان يطابق عنوانًا له تنبيهه الخاص؛ ما عداه (اسم بديل من أي جهة) يُذكر هنا
      if (isTitle && index.titleKeyByPath.get(n.path) === k) continue;
      paths.push(n.path);
    }
    if (paths.length) sharedNames.push({ name, paths });
  }
  const sig = JSON.stringify([
    CORE_VERSION,
    note.path,
    note.title,
    note.aliases ?? [],
    !!note.exactOnly,
    !!note.indefinite,
    sameTitle.length > 0,
  ]);
  return { note, index, sig, sameTitle, sharedNames };
}

export interface SourceRef {
  readonly path: string;
  /** وقت التعديل؛ النتيجة المحفوظة صالحة ما دام لم يتغير. */
  readonly mtime: number;
}

export interface ScanHost {
  /** الملاحظات التي تُمسح، بعد استثناء المجلدات. */
  sources(): readonly SourceRef[];
  /** `null`: الملف لم يعد موجودًا (حُذف أو نُقل أثناء البحث)؛ يُتخطى ولا يُعدّ فشلًا. */
  read(path: string): Promise<string | null>;
  metadata(path: string): CacheLike | undefined;
}

export interface FileResult {
  readonly path: string;
  readonly mtime: number;
  readonly items: readonly Found[];
}

/** مسح ملف واحد: النواة ثم السياق. */
export function scanText(target: Target, path: string, text: string, meta?: CacheLike): Found[] {
  return withContext(text, findMentions(text, target.index, { sourcePath: path, cache: meta }));
}

/**
 * ذاكرة النتائج: لكل بصمة هدف، نتيجة كل ملف بوقت تعديله. تحتفظ بآخر بضعة أهداف فقط،
 * فالرجوع إلى ملاحظة قبل قليل لا يعيد المسح، والذاكرة لا تكبر بلا حد.
 */
export class ResultCache {
  private readonly bySig = new Map<string, Map<string, FileResult>>();
  private lastSig: string | null = null;

  constructor(private readonly maxTargets = 4) {}

  get(sig: string, path: string, mtime: number): FileResult | undefined {
    const files = this.bySig.get(sig);
    const r = files?.get(path);
    if (!files || !r || r.mtime !== mtime) return undefined;
    // القراءة استعمال: الهدف الذي يُرجع إليه كثيرًا لا يُطرد قبل غيره
    if (this.lastSig !== sig) {
      this.bySig.delete(sig);
      this.bySig.set(sig, files);
      this.lastSig = sig;
    }
    return r;
  }

  set(sig: string, result: FileResult): void {
    let files = this.bySig.get(sig);
    if (files) {
      // الأحدث استعمالًا في آخر الترتيب
      this.bySig.delete(sig);
    } else {
      files = new Map();
      while (this.bySig.size >= this.maxTargets) {
        const oldest = this.bySig.keys().next().value as string;
        this.bySig.delete(oldest);
      }
    }
    this.bySig.set(sig, files);
    this.lastSig = sig;
    files.set(result.path, result);
  }

  drop(path: string): void {
    for (const files of this.bySig.values()) files.delete(path);
  }

  /** إعادة التسمية لا تغيّر المحتوى ولا وقت التعديل؛ النتائج تنتقل بمواضعها. */
  rename(oldPath: string, newPath: string): void {
    for (const files of this.bySig.values()) {
      const r = files.get(oldPath);
      if (!r) continue;
      files.delete(oldPath);
      files.set(newPath, { ...r, path: newPath, items: r.items });
    }
  }

  clear(sig?: string): void {
    if (sig === undefined) this.bySig.clear();
    else this.bySig.delete(sig);
    this.lastSig = null;
  }

  get size(): number {
    return this.bySig.size;
  }
}

export interface ScanOptions {
  /** أقصى زمن متصل للدفعة الواحدة بالملّي ثانية قبل الهدنة. */
  readonly budgetMs?: number;
  /** الهدنة بين الدفعات: تعطي الواجهة فرصة للرسم والاستجابة. */
  readonly pause?: () => Promise<void>;
  readonly now?: () => number;
}

export type ScanState = "running" | "stopped" | "done" | "failed";

const collator = new Intl.Collator(undefined, { numeric: true });

/** ترتيب طبيعي للمسارات: «فصل 2» قبل «فصل 10». المسح والعرض بالترتيب نفسه، فلا تُدرج مجموعة فوق ما يُقرأ. */
export function comparePaths(a: string, b: string): number {
  return collator.compare(a, b);
}

/**
 * مسح واحد لهدف واحد على دفعات قابلة للإيقاف. النتائج تُقرأ من `results` في أي وقت،
 * و`onProgress` يُستدعى بعد كل دفعة وفي النهاية.
 */
export class Scan {
  readonly results = new Map<string, FileResult>();
  done = 0;
  total = 0;
  failed = 0;
  /** أحرف النصوص المقروءة (لا المأخوذة من الذاكرة). */
  chars = 0;
  /** زمن العمل في الدفعات بلا الهدنات، وزمن البحث كله؛ للقياس (ت٣). */
  busyMs = 0;
  wallMs = 0;
  /** أطول دفعة متصلة: ما قد تتجمد فيه الواجهة. ملف واحد لا يُقسم، فهي لا تقل عن أبطأ ملف. */
  maxBatchMs = 0;
  state: ScanState = "running";
  /** يزيد كلما تغيّر ما يُعرض (ملف بمواضع أُضيف أو تبدّل أو زال)؛ ملف بلا مواضع لا يغيّره. */
  version = 0;
  /** رقم آخر قراءة طُلبت لكل ملف: قراءة أقدم تنتهي متأخرة لا تكتب فوق أحدث منها. */
  private readonly reads = new Map<string, number>();
  private readSeq = 0;
  /** ملفات حُذفت أثناء البحث: قراءتها الجارية لا تُعيدها. */
  private readonly gone = new Set<string>();

  constructor(
    readonly target: Target,
    private readonly host: ScanHost,
    private readonly cache: ResultCache,
    private readonly opts: ScanOptions = {},
  ) {}

  stop(): void {
    if (this.state === "running") this.state = "stopped";
  }

  /** ملف حُذف: تُزال نتيجته، ولا تعيدها قراءة جارية. */
  forget(path: string): void {
    this.gone.add(path);
    if (this.results.get(path)?.items.length) this.version++;
    this.results.delete(path);
  }

  /** ملف نُقل: تنتقل نتيجته، والمسار القديم يُعامل محذوفًا. */
  move(oldPath: string, newPath: string): void {
    const r = this.results.get(oldPath);
    this.forget(oldPath);
    this.gone.delete(newPath);
    if (r) this.put({ ...r, path: newPath });
  }

  private put(r: FileResult): void {
    const prev = this.results.get(r.path);
    this.results.set(r.path, r);
    if (r.items.length || prev?.items.length) this.version++;
  }

  async run(onProgress: (scan: Scan) => void = () => {}): Promise<ScanState> {
    try {
      return await this.loop(onProgress);
    } catch (e) {
      console.error("Wasl: scan failed", e);
      this.state = "failed";
      onProgress(this);
      return this.state;
    }
  }

  private async loop(onProgress: (scan: Scan) => void): Promise<ScanState> {
    const budget = this.opts.budgetMs ?? 12;
    const now = this.opts.now ?? (() => Date.now());
    const pause = this.opts.pause ?? (() => new Promise<void>((r) => setTimeout(r, 8)));
    const sources = this.host
      .sources()
      .filter((s) => s.path !== this.target.note.path)
      .sort((a, b) => comparePaths(a.path, b.path));
    this.total = sources.length;
    const started = now();
    let batchStart = started;
    for (const src of sources) {
      if (this.state !== "running") return this.state;
      const hit = this.cache.get(this.target.sig, src.path, src.mtime);
      if (hit) {
        this.put(hit);
      } else {
        await this.scanFile(src);
        if (this.state !== "running") return this.state;
      }
      this.done++;
      if (now() - batchStart >= budget) {
        this.endBatch(now() - batchStart);
        onProgress(this);
        await pause();
        batchStart = now();
      }
    }
    this.endBatch(now() - batchStart);
    this.wallMs = now() - started;
    if (this.state === "running") this.state = "done";
    onProgress(this);
    return this.state;
  }

  private endBatch(ms: number): void {
    this.busyMs += ms;
    if (ms > this.maxBatchMs) this.maxBatchMs = ms;
  }

  /** يمسح ملفًا واحدًا ويحفظ نتيجته؛ يُستعمل أيضًا لتحديث ملف تغيّر بعد انتهاء المسح. */
  async scanFile(src: SourceRef): Promise<FileResult | null> {
    const seq = ++this.readSeq;
    this.reads.set(src.path, seq);
    this.gone.delete(src.path);
    let result: FileResult;
    try {
      const text = await this.host.read(src.path);
      if (text === null || this.gone.has(src.path) || this.reads.get(src.path) !== seq) return null;
      this.chars += text.length;
      result = { path: src.path, mtime: src.mtime, items: scanText(this.target, src.path, text, this.host.metadata(src.path)) };
    } catch (e) {
      // ملف لا يُقرأ أو نص أفشل النواة: يُعدّ ويُتخطى، والبحث يكمل
      console.warn("Wasl: could not scan", src.path, e);
      this.failed++;
      return null;
    }
    this.cache.set(this.target.sig, result);
    this.put(result);
    return result;
  }
}

#!/usr/bin/env node
// ت٠: مسح قراءة فقط لخزينة Obsidian، يقيس مكسب «وصل» فوق المطابقة الحرفية.
//
// الاستخدام:
//   node scripts/t0-survey.mjs <مسار-الخزينة> [--exclude مجلد1,مجلد2] [--sample 100] [--seed 1] [--include-numeric] [--titles ملف]
//
// --titles: ملف فيه عنوان في كل سطر (وأسماء بديلة بعد «|»). يحلّ محل عناوين الملفات، ليقيس الخزينة
//           كأن فيها ملاحظة لكل عنوان. مفيد حين تكون عناوين الملفات تقنية لا تُذكر في النص.
//   node scripts/t0-survey.mjs --score local/t0/sample.tsv
//
// الضمانات:
// - لا يكتب شيئًا داخل الخزينة. كل المخرجات في local/t0/ داخل المستودع، والمجلد مستثنى من git.
// - report.md أرقام مجمّعة فقط بلا عناوين ولا نصوص؛ هو وحده ما يُنقل إلى docs/experiments/.
// - detail.tsv وsample.tsv فيهما عناوين وسياقات من الخزينة، فيبقيان محليين.
//
// هذا نموذج استطلاعي للمرحلة ٠ وليس نواة المطابقة. النواة تُبنى وتُختبر في المرحلة ١.

import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const OUT = join(REPO, "local", "t0");

// ───────────────────────── الحروف ─────────────────────────

const TATWEEL = 0x0640;
const isMark = (c) =>
  (c >= 0x064b && c <= 0x065f) || c === 0x0670 || (c >= 0x0610 && c <= 0x061a) || (c >= 0x06d6 && c <= 0x06ed);
const isInvisible = (c) =>
  (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069) ||
  c === 0x061c || c === 0xfeff || c === 0x00ad || c === 0x2060;
const isPresentation = (c) => (c >= 0xfb50 && c <= 0xfdff) || (c >= 0xfe70 && c <= 0xfefc);
const isArabicIndicDigit = (c) => (c >= 0x0660 && c <= 0x0669) || (c >= 0x06f0 && c <= 0x06f9);
const isSpace = (c) => c === 0x20 || c === 0x09 || c === 0x0d || c === 0xa0 || c === 0x202f || (c >= 0x2000 && c <= 0x200a) || c === 0x3000;
const isWordChar = (c) =>
  (c >= 0x30 && c <= 0x39) || (c >= 0x61 && c <= 0x7a) || (c >= 0xdf && c <= 0xff && c !== 0xf7) ||
  (c >= 0x100 && c <= 0x24f) || (c >= 0x0621 && c <= 0x063a) || (c >= 0x0641 && c <= 0x064a) ||
  (c >= 0x066e && c <= 0x066f) || (c >= 0x0671 && c <= 0x06d3) || c === 0x06d5 ||
  (c >= 0x06ee && c <= 0x06ef) || (c >= 0x06fa && c <= 0x06fc) || c === 0x06ff;
// فئة «الحرف» في الإشارات غير المربوطة المدمجة (من كود Obsidian 1.14.4، مُبسّطة للعربية واللاتينية):
// التطويل وأشكال العرض والأرقام حروف؛ الحركات ليست حروفًا.
const isObsidianWordChar = (c) =>
  isWordChar(c) || (c >= 0x41 && c <= 0x5a) || (c >= 0xc0 && c <= 0xde && c !== 0xd7) || c === 0x0620 ||
  c === TATWEEL || c === 0x06e5 || c === 0x06e6 || isPresentation(c) || isArabicIndicDigit(c);
/** هل تلتقط الميزة المدمجة هذا الموضع؟ الاسم حرفيًا دون حساسية لحالة الأحرف، ولا حرف قبله ولا بعده. */
function builtinMatches(raw, start, end, name) {
  const hay = raw.slice(start, end).toLowerCase();
  const needle = name.toLowerCase();
  for (let o = hay.indexOf(needle); o >= 0; o = hay.indexOf(needle, o + 1)) {
    const a = start + o, z = a + needle.length;
    if ((a === 0 || !isObsidianWordChar(raw.charCodeAt(a - 1))) && (z >= raw.length || !isObsidianWordChar(raw.charCodeAt(z)))) return true;
  }
  return false;
}
const hasLetter = (s) => [...s].some((ch) => { const c = ch.codePointAt(0); return isWordChar(c) && !(c >= 0x30 && c <= 0x39); });

// تركيب الهمزة والمدة المفككة (NFD) على الحرف السابق، مثل ا + ٔ = أ
const COMPOSE = new Map([
  ["آ", "آ"], ["أ", "أ"], ["إ", "إ"],
  ["ؤ", "ؤ"], ["ئ", "ئ"],
]);

/**
 * تطبيع الفئة (أ) مع خريطة مواضع: map[i] موضع الحرف المطبَّع i في النص الأصلي.
 * يُحذف: الحركات، التطويل، المحارف الخفية. يُوحَّد: أشكال العرض، الأرقام، ک ی، حالة اللاتينية، المسافات.
 * لا يُستعمل NFD الشامل، فالهمزات تبقى.
 */
function normalizeA(text) {
  const out = [];
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const c = ch.charCodeAt(0);
    if (c === 0x0653 || c === 0x0654 || c === 0x0655) {
      const composed = out.length && COMPOSE.get(out[out.length - 1] + ch);
      if (composed) out[out.length - 1] = composed;
      continue;
    }
    if (isMark(c) || c === TATWEEL || isInvisible(c)) continue;
    if (c === 0x0a) { out.push("\n"); map.push(i); continue; }
    if (isSpace(c)) {
      if (out.length && out[out.length - 1] !== " ") { out.push(" "); map.push(i); }
      continue;
    }
    let rep = ch;
    if (isPresentation(c)) rep = ch.normalize("NFKC");
    else if (isArabicIndicDigit(c)) rep = String.fromCharCode(0x30 + (c >= 0x06f0 ? c - 0x06f0 : c - 0x0660));
    else if (c === 0x06a9) rep = "ك";
    else if (c === 0x06cc) rep = "ي";
    else if (c < 0x0250) rep = ch.toLowerCase();
    for (const r of rep) {
      // أشكال العرض قد تحمل حركات بعد التفكيك (ﹰ): تُحذف أيضًا
      const rc = r.charCodeAt(0);
      if (isMark(rc) || rc === TATWEEL) continue;
      out.push(r);
      map.push(i);
    }
  }
  return { norm: out.join(""), map };
}

function tokenize(norm) {
  const tokens = [];
  let s = -1;
  for (let i = 0; i <= norm.length; i++) {
    const w = i < norm.length && isWordChar(norm.charCodeAt(i));
    if (w && s < 0) s = i;
    else if (!w && s >= 0) { tokens.push({ s, e: i }); s = -1; }
  }
  return tokens;
}

const foldInitialHamza = (w) => (/^[أإآٱ]/.test(w) ? "ا" + w.slice(1) : w);
// تطبيع متساهل للشبكة الواسعة فقط، حرف بحرف كي تبقى المواضع
const foldWide = (s) => s.replace(/[أإآٱ]/g, "ا").replace(/ؤ/g, "و").replace(/[ئى]/g, "ي").replace(/ة/g, "ه");

// سلاسل السوابق المغلقة: (و|ف)? (ب|ك|ل)? (ال)? مع قاعدة ل + ال = لل
const CHAINS = [];
for (const conj of ["", "و", "ف"])
  for (const prep of ["", "ب", "ك", "ل"])
    for (const art of [false, true])
      CHAINS.push({ text: conj + prep + (art ? (prep === "ل" ? "ل" : "ال") : ""), clitics: conj + prep, prep, art });

// ───────────────────────── قراءة الخزينة ─────────────────────────

function walk(dir, root, exclude, files) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    const st = lstatSync(path);
    if (st.isSymbolicLink()) continue;
    const rel = relative(root, path);
    if (st.isDirectory()) {
      if (exclude.some((x) => rel === x || rel.startsWith(x + sep))) continue;
      walk(path, root, exclude, files);
    } else if (name.toLowerCase().endsWith(".md")) {
      files.push({ path, rel, title: name.slice(0, -3) });
    }
  }
  return files;
}

function frontmatterEnd(raw) {
  if (!/^---\r?\n/.test(raw)) return 0;
  const m = /\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.exec(raw.slice(3));
  return m ? 3 + m.index + m[0].length : 0;
}

function parseAliases(raw) {
  const end = frontmatterEnd(raw);
  if (!end) return [];
  // بين السطرين «---» فقط، كي لا يُقرأ السطر الختامي عنصرًا في القائمة
  const lines = raw.slice(0, end).split(/\r?\n/).slice(1, -1).filter((l) => !/^(---|\.\.\.)\s*$/.test(l));
  const clean = (v) => v.trim().replace(/^["']|["']$/g, "").trim();
  for (let i = 0; i < lines.length; i++) {
    const m = /^(aliases|alias)\s*:\s*(.*)$/i.exec(lines[i]);
    if (!m) continue;
    const inline = m[2].trim();
    if (inline) return inline.replace(/^\[|\]$/g, "").split(",").map(clean).filter(Boolean);
    const list = [];
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s+(.*)$/.exec(lines[j]);
      if (item) list.push(clean(item[1]));
      else if (lines[j].trim()) break;
    }
    return list.filter(Boolean);
  }
  return [];
}

/** يستبدل المناطق المحمية بمسافات مع حفظ الأسطر والمواضع. */
function mask(raw) {
  const ranges = [];
  const quotes = [];
  const links = new Set();
  const fm = frontmatterEnd(raw);
  if (fm) ranges.push([0, fm]);

  // كتل متعددة الأسطر: الكود المسوّر، الرياضيات، التعليقات
  let pos = fm;
  let fence = null;
  let fenceStart = 0;
  for (const line of raw.slice(fm).split("\n")) {
    const lineStart = pos;
    pos += line.length + 1;
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) { ranges.push([fenceStart, pos]); fence = null; }
      continue;
    }
    if (f) { fence = f[1]; fenceStart = lineStart; continue; }
    if (/^\s{0,3}#{1,6}(\s|$)/.test(line)) ranges.push([lineStart, pos]); // عناوين الأقسام مستثناة (القرار ٦)
    else if (/^\s{0,3}>/.test(line)) quotes.push([lineStart, pos]);
  }
  if (fence) ranges.push([fenceStart, raw.length]);

  const patterns = [
    /\$\$[\s\S]*?\$\$/g, /%%[\s\S]*?%%/g, /<!--[\s\S]*?-->/g,
    /`+[^`\n]*`+/g, /!?\[\[[^\]\n]*\]\]/g, /!?\[[^\]\n]*\]\([^)\n]*\)/g,
    /https?:\/\/[^\s)\]]+/g, /\$[^$\n]+\$/g, /<[^>\n]+>/g, /(^|\s)#[^\s#]+/g, /\^[A-Za-z0-9-]+\s*$/gm,
  ];
  for (const re of patterns) for (const m of raw.matchAll(re)) ranges.push([m.index, m.index + m[0].length]);

  for (const m of raw.matchAll(/!?\[\[([^\]|#\n]+)/g)) links.add(linkKey(m[1]));
  for (const m of raw.matchAll(/\]\(([^)\s#]+?)(?:\.md)?(?:#[^)]*)?\)/g)) {
    try { links.add(linkKey(decodeURIComponent(m[1]))); } catch { links.add(linkKey(m[1])); }
  }

  const chars = raw.split("");
  for (const [s, e] of ranges) for (let i = s; i < e && i < chars.length; i++) if (chars[i] !== "\n") chars[i] = " ";
  return { masked: chars.join(""), quotes, links };
}

const linkKey = (target) => normalizeA(target.split("/").pop().replace(/\.md$/i, "").trim()).norm;

// ───────────────────────── فهرس العناوين ─────────────────────────

function buildIndex(files, includeNumeric, virtual) {
  const titles = new Map(); // titleKey -> {id, name, paths:Set, aliases:[]}
  const stats = { numericSkipped: 0, duplicates: 0, aliasCount: 0, notesWithAliases: 0 };
  for (const f of files) {
    const raw = readFileSync(f.path, "utf8");
    f.raw = raw;
    if (virtual) continue;
    const key = normalizeA(f.title).norm;
    if (!includeNumeric && !hasLetter(key)) { stats.numericSkipped++; continue; }
    let t = titles.get(key);
    if (t) { stats.duplicates++; t.paths.add(f.rel); }
    else { t = { id: titles.size, name: f.title, key, paths: new Set([f.rel]), aliases: [] }; titles.set(key, t); }
    const aliases = parseAliases(raw);
    if (aliases.length) { stats.notesWithAliases++; stats.aliasCount += aliases.length; t.aliases.push(...aliases); }
  }

  for (const line of virtual ?? []) {
    const [name, ...aliases] = line.split("|").map((x) => x.trim()).filter(Boolean);
    const key = normalizeA(name).norm;
    if (!titles.has(key)) titles.set(key, { id: titles.size, name, key, paths: new Set(), aliases });
    if (aliases.length) { stats.notesWithAliases++; stats.aliasCount += aliases.length; }
  }

  const coreMap = new Map();
  const entries = [];
  for (const t of titles.values()) {
    for (const [name, isAlias] of [[t.name, false], ...t.aliases.map((a) => [a, true])]) {
      const norm = normalizeA(name).norm.trim();
      const toks = tokenize(norm);
      if (!toks.length || !hasLetter(norm)) continue;
      const words = toks.map((k) => norm.slice(k.s, k.e));
      const seps = toks.slice(1).map((k, i) => norm.slice(toks[i].e, k.s));
      const first = words[0];
      const definite = first.startsWith("ال") && first.length - 2 >= 2;
      const core = definite ? first.slice(2) : first;
      const entry = { title: t, name, isAlias, definite, core, rest: words.slice(1), seps };
      entries.push(entry);
      const key = foldInitialHamza(core);
      if (!coreMap.has(key)) coreMap.set(key, []);
      coreMap.get(key).push(entry);
    }
  }
  return { titles, coreMap, entries, stats };
}

function classify(entry, chain, hamzaDiffers) {
  const coreLen = entry.core.length;
  const reasons = [];
  let layer;
  const prefix = () => reasons.push("prefix:" + chain.clitics + (chain.art ? "+ال" : ""));
  if (entry.definite) {
    if (chain.art) {
      if (!chain.clitics) layer = 0;
      else { layer = 1; prefix(); if (chain.prep === "ل") reasons.push("lam-lam"); }
    } else {
      if (coreLen <= 2) return null;
      layer = 1; reasons.push("indefinite");
      if (chain.clitics) { prefix(); if (chain.clitics.length === 1 && coreLen <= 3) layer = 2; }
    }
  } else if (chain.art) {
    if (coreLen <= 2) return null;
    layer = 1; reasons.push("definite");
    if (chain.clitics) prefix();
  } else if (!chain.clitics) {
    layer = 0;
  } else {
    if (coreLen <= 2) return null;
    layer = 1; prefix();
    if (chain.clitics.length === 1 && coreLen <= 3) layer = 2;
  }
  if (hamzaDiffers) { reasons.push("initial-hamza"); if (layer === 0) layer = 1; }
  if (entry.isAlias) reasons.push("alias");
  return { layer, reasons };
}

/** أسباب الفئة (أ) داخل المقطع الأصلي. */
function surfaceReasons(surface, name) {
  const r = new Set();
  for (const ch of surface) {
    const c = ch.charCodeAt(0);
    if (isMark(c) || c === 0x0653 || c === 0x0654 || c === 0x0655) r.add("diacritics");
    else if (c === TATWEEL) r.add("tatweel");
    else if (isInvisible(c)) r.add("invisible");
    else if (isPresentation(c)) r.add("presentation-forms");
    else if (isArabicIndicDigit(c)) r.add("digits");
    else if (c === 0x06a9 || c === 0x06cc) r.add("persian-letters");
  }
  if (surface !== name && surface.toLowerCase() === name.toLowerCase()) r.add("case");
  if ([...name].some((ch) => isMark(ch.charCodeAt(0)))) r.add("title-diacritics");
  return [...r];
}

// ───────────────────────── المسح ─────────────────────────

function scanNote(note, index) {
  const { masked, quotes, links } = mask(note.raw);
  const { norm, map } = normalizeA(masked);
  const tokens = tokenize(norm);
  const best = new Map(); // titleId:tokenIndex -> candidate
  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti];
    const w = norm.slice(tok.s, tok.e);
    for (const chain of CHAINS) {
      if (w.length <= chain.text.length || !w.startsWith(chain.text)) continue;
      const rest = w.slice(chain.text.length);
      const list = index.coreMap.get(foldInitialHamza(rest));
      if (!list) continue;
      for (const entry of list) {
        if (entry.title.paths.has(note.rel)) continue; // الملاحظة الهدف نفسها
        let endTok = ti;
        let ok = true;
        for (let k = 0; k < entry.rest.length; k++) {
          const nt = tokens[ti + 1 + k];
          if (!nt || norm.slice(tokens[ti + k].e, nt.s) !== entry.seps[k] || norm.slice(nt.s, nt.e) !== entry.rest[k]) { ok = false; break; }
          endTok = ti + 1 + k;
        }
        if (!ok) continue;
        const res = classify(entry, chain, rest[0] !== entry.core[0]);
        if (!res) continue;
        const start = map[tok.s];
        let end = map[tokens[endTok].e - 1] + 1;
        const strictEnd = end;
        while (end < note.raw.length && isMark(note.raw.charCodeAt(end))) end++;
        const surface = note.raw.slice(start, end);
        const builtin = builtinMatches(note.raw, start, end, entry.name);
        const literalStrict = !chain.clitics && end === strictEnd && note.raw.slice(start, strictEnd).toLowerCase() === entry.name.toLowerCase();
        const reasons = [...res.reasons, ...surfaceReasons(surface, entry.name)];
        const cand = {
          titleId: entry.title.id, layer: res.layer, reasons, literalStrict, builtin,
          start, end, surface, inQuote: quotes.some(([s, e]) => start >= s && start < e),
          alreadyLinked: links.has(entry.title.key) || entry.title.aliases.some((a) => links.has(linkKey(a))),
          note: note.rel,
        };
        const k = entry.title.id + ":" + ti;
        const prev = best.get(k);
        if (!prev || cand.layer < prev.layer || (cand.layer === prev.layer && !entry.isAlias && prev.reasons.includes("alias"))) best.set(k, cand);
      }
    }
  }
  return { cands: [...best.values()], norm, map };
}

// ───────────────────────── أدوات ─────────────────────────

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rnd) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const tsv = (v) => String(v).replace(/[\t\r\n]+/g, " ⏎ ");
const ar = (n) => String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[d]).replace(".", "٫");
const pct = (a, b) => (b ? ar(((100 * a) / b).toFixed(1)) + "٪" : "—");
function context(raw, s, e, width = 45) {
  return raw.slice(Math.max(0, s - width), s) + "⟦" + raw.slice(s, e) + "⟧" + raw.slice(e, e + width);
}

// ───────────────────────── الوضع: المسح ─────────────────────────

function survey(vault, opts) {
  const t0 = Date.now();
  const root = resolve(vault);
  if (resolve(OUT).startsWith(root + sep)) throw new Error("مجلد المخرجات داخل الخزينة؛ أوقفتُ التنفيذ كي لا أكتب فيها.");
  const files = walk(root, root, opts.exclude, []);
  const virtual = opts.titles ? readFileSync(opts.titles, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) : null;
  const index = buildIndex(files, opts.includeNumeric, virtual);
  const all = [];
  const notesById = new Map();
  for (const f of files) {
    const { cands, norm, map } = scanNote(f, index);
    notesById.set(f.rel, { raw: f.raw, norm, map });
    all.push(...cands);
  }

  const titles = [...index.titles.values()];
  const per = new Map(titles.map((t) => [t.id, { t, strict: 0, builtin: 0, L0: 0, L0nb: 0, L1: 0, L1nb: 0, L2: 0 }]));
  const reasonCount = { 0: new Map(), 1: new Map(), 2: new Map() };
  let inQuote = 0, alreadyLinked = 0;
  for (const c of all) {
    const p = per.get(c.titleId);
    if (c.literalStrict) p.strict++;
    if (c.builtin) p.builtin++;
    if (c.layer === 0) { p.L0++; if (!c.builtin) p.L0nb++; }
    if (c.layer === 1) { p.L1++; if (!c.builtin) p.L1nb++; }
    if (c.layer === 2) p.L2++;
    if (c.layer <= 1 && !c.builtin) { if (c.inQuote) inQuote++; if (c.alreadyLinked) alreadyLinked++; }
    if (c.layer === 0 && c.builtin) continue;
    for (const r of c.reasons.length ? c.reasons : ["exact"]) {
      const key = r.startsWith("prefix:") ? "prefix" : r;
      reasonCount[c.layer].set(key, (reasonCount[c.layer].get(key) || 0) + 1);
    }
  }
  const sum = (k) => [...per.values()].reduce((a, p) => a + p[k], 0);
  const S = { strict: sum("strict"), builtin: sum("builtin"), L0: sum("L0"), L0nb: sum("L0nb"), L1: sum("L1"), L1nb: sum("L1nb"), L2: sum("L2") };
  const gain = S.L0nb + S.L1nb;
  const gainTitles = [...per.values()].filter((p) => p.L0nb + p.L1nb > 0).map((p) => p.L0nb + p.L1nb).sort((a, b) => b - a);
  const topN = Math.max(1, Math.ceil(gainTitles.length / 10));
  const topShare = gainTitles.slice(0, topN).reduce((a, b) => a + b, 0);
  const notesWithGain = new Set(all.filter((c) => c.layer <= 1 && !c.builtin).map((c) => c.note)).size;

  // توزيع العناوين
  const dist = { w1: 0, w2: 0, w3: 0, arabic: 0, latin: 0, mixed: 0, short: 0 };
  for (const e of index.entries.filter((x) => !x.isAlias)) {
    const n = 1 + e.rest.length;
    dist[n === 1 ? "w1" : n === 2 ? "w2" : "w3"]++;
    const a = /[؀-ۿ]/.test(e.name), l = /[a-z]/i.test(e.name);
    dist[a && l ? "mixed" : a ? "arabic" : "latin"]++;
    if (e.core.length <= 3) dist.short++;
  }

  // ── الشبكة الواسعة على عيّنة عناوين (مقام الاسترجاع)
  const rnd = mulberry32(opts.seed);
  const withMentions = titles.filter((t) => { const p = per.get(t.id); return p.builtin + p.L0 + p.L1 + p.L2 > 0; });
  const wideTitles = shuffle(withMentions, rnd).slice(0, 40);
  const wide = [];
  for (const t of wideTitles) {
    const entry = index.entries.find((e) => e.title === t && !e.isAlias);
    if (!entry || entry.core.length < 2) continue;
    const needle = foldWide(entry.core);
    const covered = all.filter((c) => c.titleId === t.id);
    for (const [rel, n] of notesById) {
      if (t.paths.has(rel)) continue;
      const hay = foldWide(n.norm);
      for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
        const s = n.map[i], e = n.map[i + needle.length - 1] + 1;
        if (covered.some((c) => c.note === rel && c.start <= s && c.end >= e)) continue;
        wide.push({ titleId: t.id, note: rel, start: s, end: e, layer: "—", reasons: ["wide-only"] });
      }
    }
  }

  // ── عيّنة الوسم
  const groups = {
    L1: all.filter((c) => c.layer === 1),
    L0nb: all.filter((c) => c.layer === 0 && !c.builtin),
    L2: all.filter((c) => c.layer === 2),
    wide,
  };
  const quota = { L1: Math.round(opts.sample * 0.5), L0nb: Math.round(opts.sample * 0.15), L2: Math.round(opts.sample * 0.15), wide: Math.round(opts.sample * 0.2) };
  const sample = [];
  for (const [g, list] of Object.entries(groups)) {
    for (const c of shuffle(list, rnd).slice(0, quota[g])) sample.push({ g, c });
  }

  mkdirSync(OUT, { recursive: true });
  const title = (id) => titles[id].name;
  writeFileSync(join(OUT, "sample.tsv"),
    ["id\tgroup\tlayer\treasons\ttitle\tnote\tcontext\tlabel"]
      .concat(sample.map(({ g, c }, i) => [i + 1, g, c.layer, c.reasons.join(" "), title(c.titleId), c.note,
        context(notesById.get(c.note).raw, c.start, c.end), ""].map(tsv).join("\t"))).join("\n") + "\n");
  writeFileSync(join(OUT, "detail.tsv"),
    ["title\taliases\tliteral_strict\tbuiltin\tL0\tL0_not_builtin\tL1\tL1_not_builtin\tL2\tgain"]
      .concat([...per.values()].sort((a, b) => b.L0nb + b.L1nb - (a.L0nb + a.L1nb))
        .map((p) => [p.t.name, p.t.aliases.join("، "), p.strict, p.builtin, p.L0, p.L0nb, p.L1, p.L1nb, p.L2, p.L0nb + p.L1nb].map(tsv).join("\t"))).join("\n") + "\n");

  const reasonRows = (layer) => [...reasonCount[layer].entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${ar(v)} |`).join("\n") || "| — | ٠ |";
  const ms = Date.now() - t0;
  const report = `# ت٠: نتائج المسح

أرقام مجمّعة فقط؛ لا عناوين ولا نصوص من الخزينة. التفاصيل في \`local/t0/\` ولا تُلتزم.

- **التاريخ:** ${new Date().toISOString().slice(0, 10)}
- **مدة المسح:** ${ar((ms / 1000).toFixed(1))} ث على الحاسوب
- **الإعدادات:** عيّنة ${ar(opts.sample)}، بذرة ${ar(opts.seed)}، مجلدات مستثناة: ${opts.exclude.length ? opts.exclude.length : "لا شيء"}${opts.includeNumeric ? "، العناوين الرقمية مشمولة" : ""}${virtual ? `، **عناوين افتراضية** (${ar(virtual.length)}) بدل عناوين الملفات` : ""}

## الخزينة

| | العدد |
|---|---|
| ملاحظات | ${ar(files.length)} |
| عناوين مفهرسة | ${ar(index.titles.size)} |
| عناوين رقمية أو تواريخ مستبعدة | ${ar(index.stats.numericSkipped)} |
| عناوين مكررة في مجلدين فأكثر | ${ar(index.stats.duplicates)} |
| أسماء بديلة | ${ar(index.stats.aliasCount)} في ${ar(index.stats.notesWithAliases)} ملاحظة |
| عناوين من كلمة واحدة / كلمتين / ثلاث فأكثر | ${ar(dist.w1)} / ${ar(dist.w2)} / ${ar(dist.w3)} |
| عناوين عربية / لاتينية / مختلطة | ${ar(dist.arabic)} / ${ar(dist.latin)} / ${ar(dist.mixed)} |
| عناوين نواتها ثلاثة أحرف فأقل | ${ar(dist.short)} |

## المواضع

| المقياس | العدد |
|---|---|
| مطابقة حرفية صارمة (بلا أي حركة) | ${ar(S.strict)} |
| ما تلتقطه الميزة المدمجة | ${ar(S.builtin)} |
| الطبقة ٠ | ${ar(S.L0)} |
| منها لا تلتقطه المدمجة | ${ar(S.L0nb)} |
| الطبقة ١ | ${ar(S.L1)} |
| منها لا تلتقطه المدمجة | ${ar(S.L1nb)} |
| الطبقة ٢ (مطفأة افتراضيًا) | ${ar(S.L2)} |
| **المكسب الخام** (ما تجده الطبقتان ٠ و١ ولا تجده المدمجة) | **${ar(gain)}** |
| نسبة المكسب الخام من مواضع الطبقتين ٠ و١ | **${pct(gain, S.L0 + S.L1)}** |
| عناوين لها مكسب | ${ar(gainTitles.length)} من ${ar(index.titles.size)} (${pct(gainTitles.length, index.titles.size)}) |
| حصة أعلى عُشر العناوين من المكسب | ${pct(topShare, gain)} |
| ملاحظات فيها مكسب | ${ar(notesWithGain)} |
| من المكسب: داخل اقتباس | ${ar(inQuote)} |
| من المكسب: في ملاحظة تربط الهدف أصلًا | ${ar(alreadyLinked)} |

«خام» لأن دقته غير معروفة قبل الوسم. نموذج الميزة المدمجة مأخوذ من كودها في Obsidian 1.14.4 وطابق تشغيلها الفعلي في ت١، خارج الكود وعناوين الأقسام التي تعرضها المدمجة ويستثنيها هذا المسح عمدًا.

### أسباب الطبقة ٠ التي لا تلتقطها المدمجة

| السبب | العدد |
|---|---|
${reasonRows(0)}

### أسباب الطبقة ١

| السبب | العدد |
|---|---|
${reasonRows(1)}

### أسباب الطبقة ٢

| السبب | العدد |
|---|---|
${reasonRows(2)}

## عيّنة الوسم

${ar(sample.length)} موضعًا في \`local/t0/sample.tsv\`: ${Object.keys(groups).map((g) => `${g} ${ar(sample.filter((x) => x.g === g).length)}`).join("، ")}. الشبكة الواسعة شملت ${ar(wideTitles.length)} عنوانًا ووجدت ${ar(wide.length)} موضعًا لا تلتقطه أي طبقة.

ضع في عمود \`label\`: \`y\` يستحق الربط، \`n\` لا يستحق، \`?\` غير متأكد. ثم:

\`\`\`bash
node scripts/t0-survey.mjs --score local/t0/sample.tsv
\`\`\`
`;
  writeFileSync(join(OUT, "report.md"), report);
  writeFileSync(join(OUT, "summary.json"), JSON.stringify({ ...S, gain, sampleSize: sample.length, wideCount: wide.length, wideTitles: wideTitles.length }, null, 2));
  console.log(report);
}

// ───────────────────────── الوضع: التقييم ─────────────────────────

function score(path) {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  const head = lines[0].split("\t");
  const gi = head.indexOf("group"), li = head.indexOf("label");
  const by = {};
  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    const g = cols[gi];
    const raw = (cols[li] || "").trim().toLowerCase();
    const label = ["y", "نعم", "ن"].includes(raw) ? "y" : ["n", "لا", "ل"].includes(raw) ? "n" : raw ? "?" : "";
    by[g] ??= { y: 0, n: 0, "?": 0, blank: 0 };
    by[g][label || "blank"]++;
  }
  const summary = JSON.parse(readFileSync(join(OUT, "summary.json"), "utf8"));
  const prec = (g) => (by[g] && by[g].y + by[g].n ? by[g].y / (by[g].y + by[g].n) : null);
  const p0 = prec("L0nb"), p1 = prec("L1"), p2 = prec("L2");
  const estGain = (p0 ?? 0) * summary.L0nb + (p1 ?? 0) * summary.L1nb;
  const share = estGain / (summary.builtin + estGain);
  const f = (p) => (p === null ? "—" : ar((100 * p).toFixed(1)) + "٪");
  const rows = Object.entries(by).map(([g, c]) => `| ${g} | ${ar(c.y)} | ${ar(c.n)} | ${ar(c["?"])} | ${ar(c.blank)} | ${f(prec(g))} |`).join("\n");
  const out = `## نتيجة الوسم

| المجموعة | يستحق | لا يستحق | غير متأكد | بلا وسم | الدقة |
|---|---|---|---|---|---|
${rows}

| المقياس | القيمة | العتبة | الحكم |
|---|---|---|---|
| دقة الطبقة ٠ فيما لا تلتقطه المدمجة | ${f(p0)} | ٩٥٪ | ${p0 === null ? "—" : p0 >= 0.95 ? "تجتاز" : "دون العتبة"} |
| دقة الطبقة ١ | ${f(p1)} | ٩٥٪ | ${p1 === null ? "—" : p1 >= 0.95 ? "تجتاز" : "دون العتبة"} |
| دقة الطبقة ٢ | ${f(p2)} | ٧٠٪ | ${p2 === null ? "—" : p2 >= 0.7 ? "تجتاز" : "دون العتبة"} |
| المكسب الصحيح المقدّر | ${ar(Math.round(estGain))} موضعًا | | |
| نسبته من كل المواضع الصحيحة | ${f(share)} | الثلث | ${share >= 1 / 3 ? "تجتاز" : "دون العتبة"} |
| مواضع صحيحة فاتت كل الطبقات (من عيّنة الشبكة الواسعة) | ${ar(by.wide?.y ?? 0)} من ${ar((by.wide?.y ?? 0) + (by.wide?.n ?? 0))} | | |
`;
  writeFileSync(join(OUT, "score.md"), out);
  console.log(out);
}

// ───────────────────────── التشغيل ─────────────────────────

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
if (args[0] === "--score") {
  score(resolve(args[1] || join(OUT, "sample.tsv")));
} else if (!args[0] || args[0].startsWith("--")) {
  console.error("الاستخدام: node scripts/t0-survey.mjs <مسار-الخزينة> [--exclude a,b] [--sample 100] [--seed 1] [--include-numeric]");
  process.exit(1);
} else {
  survey(args[0], {
    exclude: (flag("--exclude", "") || "").split(",").map((s) => s.trim()).filter(Boolean),
    sample: Number(flag("--sample", 100)),
    seed: Number(flag("--seed", 1)),
    includeNumeric: args.includes("--include-numeric"),
    titles: flag("--titles", null),
  });
}

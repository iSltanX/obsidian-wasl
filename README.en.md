<h1 align="center">Wasl · وَصْل</h1>

<p align="center">Arabic-aware unlinked mentions for Obsidian, linked only with your approval.</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-pre--alpha-C2552B" alt="Status: pre-alpha">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-6E8B3D" alt="License"></a>
  <img src="https://img.shields.io/badge/Obsidian-1.6%2B-1E2A2C" alt="Obsidian 1.6+">
</p>

> **Work in progress.** There is no installable release yet. The execution plan is in [`PLAN.md`](PLAN.md) and the feasibility study in [`docs/study.md`](docs/study.md), both in Arabic. [العربية](README.md)

## Why

Obsidian's built-in *unlinked mentions* look for a note's name literally. Arabic text rarely cooperates: a mention may carry diacritics, a tatweel, or attached prefixes. «وبالكتابةِ» ("and by writing"), «للكتابة» ("for writing") and «الكتـابة» all refer to a note titled «الكتابة» ("writing"), and literal matching misses every one of them.

Wasl searches the rest of your vault for the open note's title and aliases, aware of Arabic orthographic variation. It shows each mention in context with the reason it matched, and writes a link only after you approve it.

## Principles

- **Matching bound to your titles.** No roots, no stemming, no AI. Wasl compares against your existing note titles with a closed list of prefixes, because stemmers conflate different words.
- **Your text stays as written.** The link keeps the original word as display text: `[[الكتابة|وبالكتابةِ]]`.
- **Nothing is written without consent.** Preview before linking, undo after, and no vault-wide bulk linking.
- **Quiet.** No underlines while you type; it works when you open its panel.
- **No runtime dependencies,** written to run on mobile. iOS and Android support will be announced only after testing on real devices.

## Development

Requires Node 20 or newer.

```bash
npm install
npm test
npm run build
```

`npm run dev` rebuilds on save. Code rules are in [`CONTRIBUTING.md`](CONTRIBUTING.md) (Arabic).

## License

[MIT](LICENSE).

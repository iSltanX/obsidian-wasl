# Changelog

## غير منشور

**المرحلة ٠: التأسيس**
- هيكل المستودع: `manifest.json` بالمعرّف `wasl`، وبناء esbuild، واختبارات vitest، وTypeScript.
- اختبار «أمان الجوال» يمنع النظرة الخلفية في التعابير، و`\p{...}`، واستيراد Node وElectron، واستيراد `obsidian` داخل `src/core`.
- اختبار يتحقق من تطابق النسخة بين `package.json` و`manifest.json` و`versions.json`.

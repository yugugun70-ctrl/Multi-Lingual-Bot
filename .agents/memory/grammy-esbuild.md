---
name: Grammy esbuild external
description: Grammy tidak bisa di-bundle dengan esbuild karena memuat platform.node secara dinamis
---

Grammy memuat `platform.node` secara dinamis saat runtime sehingga tidak kompatibel dengan esbuild bundling.

**Why:** Crash dengan `Error: Cannot find module './platform.node'` jika tidak di-externalize.

**How to apply:** Di `artifacts/api-server/build.mjs`, tambahkan `"grammy"` ke array `external`:
```js
external: ["*.node", "grammy", "sharp", ...]
```

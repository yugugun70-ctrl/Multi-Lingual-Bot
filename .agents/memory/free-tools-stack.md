---
name: Free tools stack
description: Stack editing foto/video gratis yang menggantikan Replicate berbayar
---

## Stack

| Fitur | Library | Catatan |
|-------|---------|---------|
| Remove background | `@imgly/background-removal-node` | CJS, di-require via createRequire; harus externalize di build.mjs |
| Upscale, enhance, color correction, portrait, cartoon, anime, style | `sharp` | ESM import dinamis; versi 0.34.5 di api-server |
| Photo-to-video | FFmpeg (zoompan/Ken Burns) | Fallback jika Kling tidak terkonfigurasi |
| Video upscale, stabilize, resize, watermark, noise reduction | FFmpeg | 100% lokal gratis |
| Subtitle | FFmpeg + template SRT | HF api-inference.huggingface.co diblokir Replit |
| Video generation | Kling AI (primary) + FFmpeg (fallback) | Kling butuh saldo |

## Penting
- `@imgly/background-removal-node` depend pada `sharp@~0.32.4` — native module di workspace root perlu di-rebuild: `cd node_modules/.pnpm/sharp@0.32.6/node_modules/sharp && npm rebuild`
- `@imgly/background-removal-node` dan `onnxruntime-node` wajib di-externalize di `build.mjs` (sama seperti grammy)
- HF api-inference.huggingface.co **tidak bisa diakses** dari Replit (HTTP 000) — jangan andalkan HF Inference API
- FFmpeg tersedia di `/nix/store/.../bin/ffmpeg` (versi 6.1.2, full build)

**Why:** Replicate berbayar per request; semua fitur editing dasar bisa dilakukan lokal dengan kualitas yang layak.

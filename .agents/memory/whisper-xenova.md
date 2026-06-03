---
name: Whisper lokal via @xenova/transformers
description: NVIDIA NIM tidak support audio transcription; gunakan @xenova/transformers untuk Whisper lokal gratis tanpa API key
---

## Aturan

NVIDIA NIM di `integrate.api.nvidia.com` TIDAK memiliki endpoint audio (`/v1/audio/transcriptions` → 404). Gunakan `@xenova/transformers` untuk inferensi Whisper lokal.

**Why:** NVIDIA NIM fokus pada text/vision LLM, bukan ASR. Endpoint audio 404 walau dokumentasinya OpenAI-compatible.

**How to apply:**
- Install: `@xenova/transformers` + `onnxruntime-node` (keduanya sudah di `package.json`)
- Model: `Xenova/whisper-tiny` (quantized, ~40MB, download otomatis ke `.whisper_cache/`)
- Cache dir: set `process.env.TRANSFORMERS_CACHE` dan `env.cacheDir` ke path project agar model tidak re-download
- WAJIB di-external di `build.mjs`: tambahkan `"@xenova/transformers"` dan `"@huggingface/transformers"` ke array `external`
- `onnxruntime-node` sudah ada di externals, jangan hapus

## Performa
- whisper-tiny: ~30 detik untuk audio 60 detik (CPU)
- Model download pertama: ~40MB, lalu tersimpan di `.whisper_cache/`
- Gunakan `return_timestamps: true` untuk mendapat segmen bertiming (untuk subtitle sinkron)

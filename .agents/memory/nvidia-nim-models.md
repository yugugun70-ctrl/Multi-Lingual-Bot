---
name: NVIDIA NIM models
description: Model NVIDIA NIM yang terverifikasi aktif di akun ini
---

## Terverifikasi Aktif
- `meta/llama-3.1-8b-instruct` — text, chat, fallback cepat ✅
- `meta/llama-3.2-11b-vision-instruct` — vision/OCR/analisis gambar ✅
- `meta/llama-3.3-70b-instruct` — text, reasoning ✅  
- `nvidia/llama-3.3-nemotron-super-49b-v1` — chat + coding (Nemotron) ✅
- `nvidia/llama-3.1-nemotron-nano-8b-v1` — fallback ringan ✅

## Tidak Aktif (404 di akun ini)
- `nvidia/llama-3.1-nemotron-70b-instruct` — 404
- `nvidia/llama-3.2-11b-vision-instruct` — 404 (gunakan versi `meta/` bukan `nvidia/`)

## Base URL
`https://integrate.api.nvidia.com/v1` — standard OpenAI-compatible endpoint

## Model Priority di agent.ts
- Teks: Nemotron-49B → Nemotron-Nano → Vision → Llama-3.3-70B
- Vision (ada gambar): Vision-11B → Llama-3.3-70B → Nemotron-Nano

**Why:** Beberapa model listed di /v1/models tapi tetap 404 saat dipanggil — selalu test dulu sebelum set sebagai primary.

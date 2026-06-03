---
name: Transcription provider chain
description: Urutan provider transkripsi audio-to-text untuk fitur auto subtitle bot
---

## Urutan Provider

1. **AssemblyAI** (primary) — pakai `assemblyai` npm package, upload file via `client.files.upload(createReadStream(path))`, lalu `client.transcripts.transcribe({audio, language_detection: true})`. Timestamps dalam milliseconds → bagi 1000.
2. **Deepgram** (fallback) — pakai `@deepgram/sdk`, `deepgram.listen.prerecorded.transcribeFile(buffer, {model: 'nova-2', utterances: true})`. Timestamps sudah dalam detik.
3. **Whisper lokal** (last resort) — `@xenova/transformers` Xenova/whisper-tiny, butuh PCM float32 (bukan MP3).

## Audio Extraction

- Untuk API (AssemblyAI/Deepgram): ekstrak ke MP3 mono 16kHz via FFmpeg → lebih kecil, upload lebih cepat
- Untuk Whisper lokal: ekstrak ke raw f32le PCM

## Grouping Words → Segments

- AssemblyAI dan Deepgram word-level: `groupWordsToSegments(words, maxWords=8, maxGap=1.0s)`
- Deepgram utterances (lebih natural): dipakai langsung jika tersedia

**Why:** Whisper lokal terlalu lambat (30-90 detik) dan sering gagal di environment resource-terbatas. AssemblyAI & Deepgram jauh lebih akurat dan cepat (~5-15 detik).

**How to apply:** Saat ada perubahan ke `transcribe.ts`, pastikan chain tetap berurutan. API key ASSEMBLYAI_API_KEY dan DEEPGRAM_API_KEY wajib ada di env vars.

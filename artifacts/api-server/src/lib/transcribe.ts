import { logger } from "./logger";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

function ffmpeg(): string { return process.env.FFMPEG_PATH ?? "ffmpeg"; }
function ffprobe(): string { return (process.env.FFMPEG_PATH ?? "ffmpeg").replace("ffmpeg", "ffprobe"); }

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptResult {
  success: boolean;
  segments?: TranscriptSegment[];
  fullText?: string;
  language?: string;
  error?: string;
  provider?: string;
}

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
  isPortrait: boolean;
}

export async function getVideoInfo(inputPath: string): Promise<VideoInfo> {
  try {
    const { stdout } = await execAsync(
      `${ffprobe()} -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${inputPath}"`
    );
    const parts  = stdout.trim().split(",");
    const width  = parseInt(parts[0] ?? "1280") || 1280;
    const height = parseInt(parts[1] ?? "720")  || 720;
    const { stdout: durOut } = await execAsync(
      `${ffprobe()} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${inputPath}"`
    );
    const duration = parseFloat(durOut.trim()) || 30;
    return { width, height, duration, isPortrait: height > width };
  } catch {
    return { width: 1280, height: 720, duration: 30, isPortrait: false };
  }
}

// ─── Ekstrak audio sebagai MP3 (kecil, cocok untuk upload API) ────────────────

async function extractAudioMp3(inputPath: string, maxSec = 60): Promise<string> {
  const mp3Path = path.join(os.tmpdir(), `editai_audio_${Date.now()}.mp3`);
  await execAsync(
    `${ffmpeg()} -y -i "${inputPath}" -vn -ar 16000 -ac 1 -t ${maxSec} -q:a 4 "${mp3Path}"`,
    { timeout: 60000 }
  );
  return mp3Path;
}

// ─── Ekstrak audio sebagai raw float32 PCM (untuk Whisper lokal) ─────────────

async function extractAudioPCM(inputPath: string, maxSec = 60): Promise<Float32Array> {
  const pcmPath = path.join(os.tmpdir(), `editai_pcm_${Date.now()}.f32`);
  try {
    await execAsync(
      `${ffmpeg()} -y -i "${inputPath}" -vn -ar 16000 -ac 1 -t ${maxSec} -f f32le "${pcmPath}"`,
      { timeout: 60000 }
    );
    const buf = await fs.readFile(pcmPath);
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  } finally {
    await fs.unlink(pcmPath).catch(() => {});
  }
}

// ─── Pengelompokan kata → segmen (untuk Deepgram word-level) ─────────────────

interface WordItem {
  start: number;
  end: number;
  word: string;
}

function groupWordsToSegments(words: WordItem[], maxWords = 8, maxGapSec = 1.2): TranscriptSegment[] {
  if (words.length === 0) return [];
  const segments: TranscriptSegment[] = [];
  let group: WordItem[] = [];

  for (const w of words) {
    const prevEnd = group[group.length - 1]?.end ?? 0;
    const gap = group.length > 0 ? w.start - prevEnd : 0;
    if (group.length >= maxWords || (group.length > 0 && gap > maxGapSec)) {
      segments.push({
        start: group[0]!.start,
        end:   group[group.length - 1]!.end,
        text:  group.map(w => w.word).join(" "),
      });
      group = [];
    }
    group.push(w);
  }
  if (group.length > 0) {
    segments.push({
      start: group[0]!.start,
      end:   group[group.length - 1]!.end,
      text:  group.map(w => w.word).join(" "),
    });
  }
  return segments;
}

// ─── AssemblyAI Transcription ─────────────────────────────────────────────────

async function transcribeWithAssemblyAI(mp3Path: string): Promise<TranscriptResult> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error("ASSEMBLYAI_API_KEY tidak ada");

  const { AssemblyAI } = await import("assemblyai");
  const client = new AssemblyAI({ apiKey });

  logger.info("AssemblyAI: mengupload audio...");
  const uploadUrl = await client.files.upload(createReadStream(mp3Path));
  logger.info({ uploadUrl }, "AssemblyAI: upload selesai, mulai transkripsi...");

  const transcript = await client.transcripts.transcribe({
    audio: uploadUrl,
    language_detection: true,
    punctuate: true,
    format_text: true,
  });

  if (transcript.status === "error" || !transcript.text) {
    throw new Error(`AssemblyAI error: ${transcript.error ?? "Tidak ada teks"}`);
  }

  const fullText = transcript.text.trim();
  logger.info({ wordCount: transcript.words?.length }, "AssemblyAI: transkripsi selesai");

  let segments: TranscriptSegment[] = [];

  if (transcript.words && transcript.words.length > 0) {
    const wordItems: WordItem[] = transcript.words.map((w: any) => ({
      start: (w.start ?? 0) / 1000,
      end:   (w.end   ?? 0) / 1000,
      word:  w.text ?? "",
    })).filter((w: WordItem) => w.word.trim().length > 0);
    segments = groupWordsToSegments(wordItems, 8, 1.0);
  }

  if (segments.length === 0) {
    segments = [{ start: 0, end: 9999, text: fullText }];
  }

  return {
    success:  true,
    segments,
    fullText,
    language: transcript.language_code ?? undefined,
    provider: "assemblyai",
  };
}

// ─── Deepgram Transcription ───────────────────────────────────────────────────

async function transcribeWithDeepgram(mp3Path: string): Promise<TranscriptResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY tidak ada");

  const { createClient } = await import("@deepgram/sdk");
  const deepgram = createClient(apiKey);

  logger.info("Deepgram: mengirim audio...");
  const audioBuffer = await fs.readFile(mp3Path);

  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
    audioBuffer,
    {
      model:      "nova-2",
      detect_language: true,
      punctuate:  true,
      utterances: true,
      smart_format: true,
    }
  );

  if (error) throw new Error(`Deepgram error: ${error.message}`);

  const channel = result?.results?.channels?.[0];
  const alternative = channel?.alternatives?.[0];
  const fullText = alternative?.transcript?.trim() ?? "";

  if (!fullText) throw new Error("Deepgram: tidak ada teks terdeteksi");

  logger.info({ utteranceCount: result?.results?.utterances?.length }, "Deepgram: transkripsi selesai");

  let segments: TranscriptSegment[] = [];

  const utterances = result?.results?.utterances;
  if (utterances && utterances.length > 0) {
    segments = utterances
      .filter((u: any) => u.transcript?.trim())
      .map((u: any) => ({
        start: u.start ?? 0,
        end:   u.end   ?? 0,
        text:  u.transcript.trim(),
      }));
  } else if (alternative?.words && alternative.words.length > 0) {
    const wordItems: WordItem[] = alternative.words.map((w: any) => ({
      start: w.start ?? 0,
      end:   w.end   ?? 0,
      word:  w.punctuated_word ?? w.word ?? "",
    })).filter((w: WordItem) => w.word.trim().length > 0);
    segments = groupWordsToSegments(wordItems, 8, 1.0);
  }

  if (segments.length === 0) {
    segments = [{ start: 0, end: 9999, text: fullText }];
  }

  const detectedLang = channel?.detected_language ?? undefined;
  return {
    success:  true,
    segments,
    fullText,
    language: detectedLang,
    provider: "deepgram",
  };
}

// ─── Whisper Lokal (fallback terakhir) ───────────────────────────────────────

let _whisperPipeline: any = null;
let _pipelineLoading = false;
const _pipelineWaiters: Array<(p: any) => void> = [];

async function getWhisperPipeline(): Promise<any> {
  if (_whisperPipeline) return _whisperPipeline;
  if (_pipelineLoading) {
    return new Promise((resolve) => _pipelineWaiters.push(resolve));
  }
  _pipelineLoading = true;
  logger.info("Whisper fallback: memuat model (~40MB)...");

  try {
    const cacheDir = path.join(process.cwd(), ".whisper_cache");
    process.env.TRANSFORMERS_CACHE    = cacheDir;
    process.env.HF_HOME               = cacheDir;
    process.env.HUGGINGFACE_HUB_CACHE = cacheDir;

    const { pipeline, env } = await import("@xenova/transformers");
    env.cacheDir        = cacheDir;
    env.localModelPath  = cacheDir;
    env.backends.onnx.wasm.numThreads = 2;

    _whisperPipeline = await pipeline(
      "automatic-speech-recognition",
      "Xenova/whisper-tiny",
      { quantized: true }
    );

    logger.info("Whisper fallback: model siap!");
    for (const r of _pipelineWaiters) r(_whisperPipeline);
    _pipelineWaiters.length = 0;
    return _whisperPipeline;
  } catch (err: any) {
    _pipelineLoading = false;
    _whisperPipeline  = null;
    for (const r of _pipelineWaiters) r(null);
    _pipelineWaiters.length = 0;
    throw err;
  }
}

async function transcribeWithWhisper(inputPath: string): Promise<TranscriptResult> {
  const audioData = await extractAudioPCM(inputPath, 60);
  if (audioData.length < 1600) {
    throw new Error("Audio terlalu pendek atau tidak ada suara.");
  }

  const asr = await getWhisperPipeline();
  if (!asr) throw new Error("Model Whisper gagal dimuat.");

  logger.info({ samples: audioData.length }, "Whisper fallback: menjalankan inferensi...");

  const result = await asr(audioData, {
    sampling_rate:     16000,
    chunk_length_s:    30,
    stride_length_s:   5,
    task:              "transcribe",
    language:          null,
    return_timestamps: true,
  });

  const fullText = String(result?.text ?? "").trim();
  const chunks: Array<{ timestamp: [number, number | null]; text: string }> = result?.chunks ?? [];

  if (!fullText && chunks.length === 0) {
    throw new Error("Tidak ada suara yang terdeteksi.");
  }

  let segments: TranscriptSegment[];
  if (chunks.length > 0) {
    segments = chunks
      .map((c) => ({
        start: c.timestamp[0] ?? 0,
        end:   c.timestamp[1] ?? (c.timestamp[0] ?? 0) + 3,
        text:  c.text.trim(),
      }))
      .filter((s) => s.text.length > 0);
  } else {
    segments = [{ start: 0, end: 9999, text: fullText }];
  }

  logger.info({ segCount: segments.length }, "Whisper fallback: selesai");
  return { success: true, segments, fullText, provider: "whisper-local" };
}

// ─── Transkripsi Utama (AssemblyAI → Deepgram → Whisper) ─────────────────────

export async function transcribeVideo(inputPath: string): Promise<TranscriptResult> {
  let mp3Path: string | null = null;

  try {
    logger.info("Mengekstrak audio dari video...");
    mp3Path = await extractAudioMp3(inputPath, 60);

    const mp3Stat = await fs.stat(mp3Path);
    if (mp3Stat.size < 1000) {
      return { success: false, error: "Video tidak memiliki audio atau audio terlalu pendek." };
    }

    logger.info({ sizeKB: Math.round(mp3Stat.size / 1024) }, "Audio diekstrak, mencoba AssemblyAI...");

    // ── 1. AssemblyAI (primary) ────────────────────────────────────────────────
    try {
      const result = await transcribeWithAssemblyAI(mp3Path);
      logger.info({ provider: "assemblyai", segs: result.segments?.length }, "Transkripsi berhasil");
      return result;
    } catch (err: any) {
      logger.warn({ err: err.message }, "AssemblyAI gagal, mencoba Deepgram...");
    }

    // ── 2. Deepgram (fallback) ─────────────────────────────────────────────────
    try {
      const result = await transcribeWithDeepgram(mp3Path);
      logger.info({ provider: "deepgram", segs: result.segments?.length }, "Transkripsi berhasil");
      return result;
    } catch (err: any) {
      logger.warn({ err: err.message }, "Deepgram gagal, mencoba Whisper lokal...");
    }

    // ── 3. Whisper lokal (last resort) ────────────────────────────────────────
    try {
      const result = await transcribeWithWhisper(inputPath);
      logger.info({ provider: "whisper-local", segs: result.segments?.length }, "Transkripsi berhasil");
      return result;
    } catch (err: any) {
      logger.error({ err: err.message }, "Semua provider transkripsi gagal");
      return {
        success: false,
        error: `Transkripsi gagal di semua provider. Pastikan video memiliki suara yang jelas. (${err.message?.slice(0, 80)})`,
      };
    }

  } catch (err: any) {
    logger.error({ err }, "Transkripsi gagal: ekstrak audio error");
    return { success: false, error: `Gagal mengekstrak audio: ${err.message?.slice(0, 100)}` };
  } finally {
    if (mp3Path) await fs.unlink(mp3Path).catch(() => {});
  }
}

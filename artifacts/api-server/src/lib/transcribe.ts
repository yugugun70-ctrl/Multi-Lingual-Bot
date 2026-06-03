import { logger } from "./logger";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
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

// ─── Ekstrak audio sebagai raw float32 PCM (bypass AudioContext) ───────────────

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

// ─── Lazy-load pipeline Whisper (cached setelah pertama kali) ─────────────────

let _whisperPipeline: any = null;
let _pipelineLoading = false;
const _pipelineWaiters: Array<(p: any) => void> = [];

async function getWhisperPipeline(): Promise<any> {
  if (_whisperPipeline) return _whisperPipeline;
  if (_pipelineLoading) {
    return new Promise((resolve) => _pipelineWaiters.push(resolve));
  }
  _pipelineLoading = true;
  logger.info("Memuat model Whisper (pertama kali ~40MB)...");

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

    logger.info("Model Whisper siap!");
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

// ─── Transkripsi utama ─────────────────────────────────────────────────────────

export async function transcribeVideo(inputPath: string): Promise<TranscriptResult> {
  try {
    logger.info("Mengekstrak audio PCM dari video...");
    const audioData = await extractAudioPCM(inputPath, 60);

    if (audioData.length < 1600) {
      return { success: false, error: "Audio terlalu pendek atau tidak ada suara." };
    }

    const asr = await getWhisperPipeline();
    if (!asr) return { success: false, error: "Model Whisper gagal dimuat." };

    logger.info({ samples: audioData.length }, "Menjalankan Whisper lokal...");

    // Kirim Float32Array langsung → bypass AudioContext sepenuhnya
    const result = await asr(audioData, {
      sampling_rate:    16000,
      chunk_length_s:   30,
      stride_length_s:  5,
      task:             "transcribe",
      language:         null,          // auto-detect
      return_timestamps: true,
    });

    const fullText = String(result?.text ?? "").trim();
    const chunks: Array<{ timestamp: [number, number | null]; text: string }> =
      result?.chunks ?? [];

    if (!fullText && chunks.length === 0) {
      return { success: false, error: "Tidak ada suara yang terdeteksi dalam video." };
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

    logger.info({ segCount: segments.length }, "Whisper selesai");
    return { success: true, segments, fullText };

  } catch (err: any) {
    logger.error({ err }, "Transkripsi gagal");
    return { success: false, error: `Gagal transkripsi: ${err.message?.slice(0, 120)}` };
  }
}

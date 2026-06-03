import { logger } from "./logger";
import { getConfigValue } from "./config";
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
    const parts = stdout.trim().split(",");
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

async function extractAudio(inputPath: string): Promise<string> {
  const audioPath = path.join(os.tmpdir(), `editai_audio_${Date.now()}.mp3`);
  await execAsync(
    `${ffmpeg()} -y -i "${inputPath}" -vn -ar 16000 -ac 1 -ab 64k -t 60 "${audioPath}"`,
    { timeout: 60000 }
  );
  return audioPath;
}

export async function transcribeVideo(inputPath: string): Promise<TranscriptResult> {
  const apiKey = getConfigValue("NVIDIA_API_KEY");
  if (!apiKey) {
    return { success: false, error: "NVIDIA API Key tidak dikonfigurasi." };
  }

  let audioPath: string | null = null;

  try {
    logger.info("Mengekstrak audio dari video...");
    audioPath = await extractAudio(inputPath);

    const audioBuffer = await fs.readFile(audioPath);
    const audioSize   = audioBuffer.byteLength;

    logger.info({ audioSize }, "Mengirim audio ke Whisper NVIDIA...");

    const boundary = `----EditAIBoundary${Date.now()}`;

    const parts: Buffer[] = [];

    const fileHeader = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.mp3"\r\nContent-Type: audio/mpeg\r\n\r\n`
    );
    const modelPart = Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nopenai/whisper-large-v3\r\n`
    );
    const formatPart = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\nverbose_json\r\n`
    );
    const tempPart = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="temperature"\r\n\r\n0\r\n`
    );
    const closePart = Buffer.from(`--${boundary}--\r\n`);

    parts.push(fileHeader, audioBuffer, modelPart, formatPart, tempPart, closePart);
    const body = Buffer.concat(parts);

    const response = await fetch("https://integrate.api.nvidia.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": String(body.byteLength),
      },
      body,
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      logger.warn({ status: response.status, errText: errText.slice(0, 200) }, "Whisper API error");
      return { success: false, error: `Whisper API error ${response.status}: ${errText.slice(0, 100)}` };
    }

    const data = await response.json() as any;
    logger.debug({ text: (data.text ?? "").slice(0, 100) }, "Whisper response");

    const rawSegments: TranscriptSegment[] = (data.segments ?? []).map((s: any) => ({
      start: Number(s.start ?? 0),
      end:   Number(s.end ?? 0),
      text:  String(s.text ?? "").trim(),
    })).filter((s: TranscriptSegment) => s.text.length > 0);

    if (rawSegments.length === 0 && data.text) {
      rawSegments.push({ start: 0, end: 999, text: String(data.text).trim() });
    }

    return {
      success:  true,
      segments: rawSegments,
      fullText: String(data.text ?? "").trim(),
      language: String(data.language ?? ""),
    };
  } catch (err: any) {
    logger.error({ err }, "Transcribe gagal");
    return { success: false, error: `Gagal transkripsi: ${err.message?.slice(0, 100)}` };
  } finally {
    if (audioPath) await fs.unlink(audioPath).catch(() => {});
  }
}

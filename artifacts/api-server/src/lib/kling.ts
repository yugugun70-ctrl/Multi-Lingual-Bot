import crypto from "node:crypto";
import { logger } from "./logger";

const KLING_BASE_URL = "https://api.klingai.com";

// Buat JWT untuk autentikasi Kling AI
function generateKlingJWT(accessKeyId: string, accessKeySecret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(
    JSON.stringify({
      iss: accessKeyId,
      exp: now + 1800, // berlaku 30 menit
      nbf: now - 5,
    })
  ).toString("base64url");

  const data = `${header}.${payload}`;
  const signature = crypto
    .createHmac("sha256", accessKeySecret)
    .update(data)
    .digest("base64url");

  return `${data}.${signature}`;
}

function getKlingAuth(): string | null {
  const accessKeyId = process.env.KLING_ACCESS_KEY;
  const accessKeySecret = process.env.KLING_SECRET_KEY;
  if (!accessKeyId || !accessKeySecret) return null;
  return generateKlingJWT(accessKeyId, accessKeySecret);
}

export interface KlingResult {
  success: boolean;
  taskId?: string;
  videoUrl?: string;
  error?: string;
}

async function pollKlingTask(
  endpoint: string,
  taskId: string,
  jwt: string,
  timeoutMs = 300000
): Promise<KlingResult> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));

    const res = await fetch(`${KLING_BASE_URL}${endpoint}/${taskId}`, {
      headers: {
        Authorization: `Bearer ${jwt}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const err = await res.text();
      logger.error({ taskId, err }, "Kling poll error");
      return { success: false, error: `Kling API error: ${err}` };
    }

    const data = (await res.json()) as {
      code: number;
      data?: {
        task_status: string;
        task_result?: {
          videos?: Array<{ url: string }>;
        };
      };
      message?: string;
    };

    if (data.code !== 0) {
      return { success: false, error: data.message ?? "Kling task gagal." };
    }

    const taskData = data.data;
    if (!taskData) continue;

    if (taskData.task_status === "succeed") {
      const videoUrl = taskData.task_result?.videos?.[0]?.url;
      if (videoUrl) {
        return { success: true, taskId, videoUrl };
      }
      return { success: false, error: "Video URL tidak ditemukan dari Kling." };
    }

    if (taskData.task_status === "failed") {
      return { success: false, error: "Kling video generation gagal." };
    }

    // status: processing / submitted → lanjut poll
    logger.info({ taskId, status: taskData.task_status }, "Kling task masih diproses...");
  }

  return { success: false, error: "Timeout: Kling video terlalu lama diproses." };
}

// Text-to-Video: buat video dari deskripsi teks
export async function klingTextToVideo(
  prompt: string,
  duration: "5" | "10" = "5",
  aspectRatio: "16:9" | "9:16" | "1:1" = "16:9"
): Promise<KlingResult> {
  const jwt = getKlingAuth();
  if (!jwt) {
    return {
      success: false,
      error: "KLING_ACCESS_KEY / KLING_SECRET_KEY belum dikonfigurasi di Secrets.",
    };
  }

  logger.info({ prompt, duration, aspectRatio }, "Membuat video dari teks via Kling AI");

  const res = await fetch(`${KLING_BASE_URL}/v1/videos/text2video`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_name: "kling-v1",
      prompt,
      negative_prompt: "low quality, blurry, artifacts",
      cfg_scale: 0.5,
      mode: "std",
      duration,
      aspect_ratio: aspectRatio,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error({ err }, "Kling text2video create error");
    return { success: false, error: `Kling API error: ${err}` };
  }

  const data = (await res.json()) as {
    code: number;
    data?: { task_id: string };
    message?: string;
  };

  if (data.code !== 0 || !data.data?.task_id) {
    return { success: false, error: data.message ?? "Kling gagal membuat task." };
  }

  return pollKlingTask("/v1/videos/text2video", data.data.task_id, jwt);
}

// Image-to-Video: konversi foto menjadi video
export async function klingImageToVideo(
  imageUrl: string,
  prompt: string = "cinematic camera movement, smooth motion",
  duration: "5" | "10" = "5"
): Promise<KlingResult> {
  const jwt = getKlingAuth();
  if (!jwt) {
    return {
      success: false,
      error: "KLING_ACCESS_KEY / KLING_SECRET_KEY belum dikonfigurasi di Secrets.",
    };
  }

  logger.info({ imageUrl, prompt, duration }, "Membuat video dari foto via Kling AI");

  const res = await fetch(`${KLING_BASE_URL}/v1/videos/image2video`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_name: "kling-v1",
      image: imageUrl,
      prompt,
      negative_prompt: "low quality, blurry, artifacts",
      cfg_scale: 0.5,
      mode: "std",
      duration,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error({ err }, "Kling image2video create error");
    return { success: false, error: `Kling API error: ${err}` };
  }

  const data = (await res.json()) as {
    code: number;
    data?: { task_id: string };
    message?: string;
  };

  if (data.code !== 0 || !data.data?.task_id) {
    return { success: false, error: data.message ?? "Kling gagal membuat task." };
  }

  return pollKlingTask("/v1/videos/image2video", data.data.task_id, jwt);
}

export function isKlingConfigured(): boolean {
  return !!(process.env.KLING_ACCESS_KEY && process.env.KLING_SECRET_KEY);
}

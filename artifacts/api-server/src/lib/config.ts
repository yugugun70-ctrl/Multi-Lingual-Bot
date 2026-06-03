import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const CONFIG_PATH = join(process.cwd(), ".bot-config.json");

export interface BotConfig {
  TELEGRAM_BOT_TOKEN?: string;
  ADMIN_ID?: string;
  NVIDIA_API_KEY?: string;
  KLING_ACCESS_KEY?: string;
  KLING_SECRET_KEY?: string;
  REMOVE_BG_API_KEY?: string;
}

let _cache: BotConfig = {};

export function loadConfig(): BotConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, "utf-8");
      _cache = JSON.parse(raw);
    }
  } catch (e) {
    console.warn("[Config] Gagal membaca config file:", e);
  }
  return _cache;
}

export function saveConfig(updates: Partial<BotConfig>): BotConfig {
  const merged: BotConfig = { ..._cache };
  for (const [k, v] of Object.entries(updates)) {
    const key = k as keyof BotConfig;
    const val = (v as string)?.trim();
    if (val) merged[key] = val;
  }
  _cache = merged;
  writeFileSync(CONFIG_PATH, JSON.stringify(_cache, null, 2), "utf-8");
  return _cache;
}

export function getConfigValue(key: keyof BotConfig): string | undefined {
  return (_cache[key] || process.env[key]) ?? undefined;
}

export function getConfigStatus(): Record<keyof BotConfig, boolean> {
  const keys: Array<keyof BotConfig> = [
    "TELEGRAM_BOT_TOKEN",
    "ADMIN_ID",
    "NVIDIA_API_KEY",
    "KLING_ACCESS_KEY",
    "KLING_SECRET_KEY",
    "REMOVE_BG_API_KEY",
  ];
  const result = {} as Record<keyof BotConfig, boolean>;
  for (const k of keys) {
    result[k] = !!(_cache[k] || process.env[k]);
  }
  return result;
}

loadConfig();

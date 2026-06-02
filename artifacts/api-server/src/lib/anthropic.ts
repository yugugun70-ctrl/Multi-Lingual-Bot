import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger";

let anthropicClient: Anthropic | null = null;

if (process.env.ANTHROPIC_API_KEY) {
  anthropicClient = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
} else {
  logger.warn("ANTHROPIC_API_KEY tidak diset — Anthropic client tidak aktif (opsional).");
}

export const anthropic = anthropicClient;

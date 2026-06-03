import { loadConfig, getConfigValue } from "./lib/config";
import app from "./app";
import { logger } from "./lib/logger";
import { createBot } from "./bot";
import { runMigrations } from "@workspace/db";

loadConfig();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

runMigrations()
  .then(() => {
    const token = getConfigValue("TELEGRAM_BOT_TOKEN");
    if (token) {
      const bot = createBot(token);
      bot.start({
        onStart: (botInfo) => {
          logger.info({ username: botInfo.username }, "Bot Telegram berjalan");
        },
      });
      process.once("SIGINT", () => bot.stop());
      process.once("SIGTERM", () => bot.stop());
    } else {
      logger.warn("TELEGRAM_BOT_TOKEN belum diset — isi di /api/setup lalu restart server.");
    }
  })
  .catch((err) => {
    logger.error({ err }, "Gagal migrasi DB — bot tidak akan berjalan");
  });

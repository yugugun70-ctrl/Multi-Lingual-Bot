import { Router } from "express";
import { getConfigStatus, saveConfig, loadConfig, getConfigValue } from "../lib/config";

const router = Router();

function renderPage(message?: string, msgType?: "success" | "error"): string {
  const status = getConfigStatus();
  const cfg = loadConfig();

  const dot = (ok: boolean) =>
    ok ? `<span class="dot ok">●</span>` : `<span class="dot err">●</span>`;

  const fieldHint = (key: string) => {
    const v = (cfg as any)[key] || "";
    if (!v) return "";
    if (key === "ADMIN_ID") return v;
    return v.slice(0, 6) + "••••";
  };

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>EditAI — Setup Bot</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#0f0f1a;color:#e0e0f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
  .card{background:#1a1a2e;border:1px solid #2a2a4a;border-radius:16px;padding:36px;width:100%;max-width:560px;box-shadow:0 8px 40px rgba(0,0,0,.5)}
  h1{font-size:1.5rem;font-weight:700;color:#7c82ff;margin-bottom:4px}
  .sub{color:#707090;font-size:.875rem;margin-bottom:28px}
  .status-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:28px;background:#0d0d1a;padding:14px;border-radius:10px}
  .status-item{display:flex;align-items:center;gap:6px;font-size:.8rem;color:#a0a0c0}
  .dot{font-size:.7rem}.dot.ok{color:#4ade80}.dot.err{color:#f87171}
  label{display:block;font-size:.8rem;color:#9090b0;margin-bottom:4px;margin-top:16px}
  input{width:100%;background:#0d0d1a;border:1px solid #2a2a4a;border-radius:8px;padding:10px 12px;color:#e0e0f0;font-size:.9rem;outline:none;transition:border .2s}
  input:focus{border-color:#7c82ff}
  input::placeholder{color:#404060}
  .hint{font-size:.73rem;color:#606080;margin-top:3px}
  .req{color:#f87171;margin-left:2px}
  .btn{width:100%;background:linear-gradient(135deg,#7c82ff,#5a60e0);border:none;border-radius:8px;padding:13px;color:#fff;font-size:1rem;font-weight:600;cursor:pointer;margin-top:24px;transition:opacity .2s}
  .btn:hover{opacity:.88}
  .alert{padding:12px 16px;border-radius:8px;margin-bottom:20px;font-size:.875rem}
  .alert.success{background:#1a3a2a;border:1px solid #4ade80;color:#4ade80}
  .alert.error{background:#3a1a1a;border:1px solid #f87171;color:#f87171}
  .sep{border:none;border-top:1px solid #2a2a4a;margin:24px 0}
  .sec{font-size:.8rem;font-weight:600;color:#7c82ff;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}
  .note{background:#1a2a1a;border:1px solid #2a4a2a;border-radius:8px;padding:12px;font-size:.8rem;color:#80b080;margin-top:20px}
</style>
</head>
<body>
<div class="card">
  <h1>⚙️ EditAI — Setup Bot</h1>
  <p class="sub">Isi API key untuk mengaktifkan semua fitur bot</p>

  ${message ? `<div class="alert ${msgType}">${message}</div>` : ""}

  <div class="status-grid">
    <div class="status-item">${dot(status.TELEGRAM_BOT_TOKEN)} Bot Token</div>
    <div class="status-item">${dot(status.ADMIN_ID)} Admin ID</div>
    <div class="status-item">${dot(status.NVIDIA_API_KEY)} NVIDIA API</div>
    <div class="status-item">${dot(status.KLING_ACCESS_KEY)} Kling Access</div>
    <div class="status-item">${dot(status.KLING_SECRET_KEY)} Kling Secret</div>
    <div class="status-item">${dot(status.REMOVE_BG_API_KEY)} Remove.bg</div>
  </div>

  <form method="POST" action="/api/setup">
    <div class="sec">🤖 Telegram Bot</div>

    <label>Token Bot Telegram <span class="req">*</span></label>
    <input type="password" name="TELEGRAM_BOT_TOKEN"
      placeholder="${status.TELEGRAM_BOT_TOKEN ? "Sudah diset — kosongkan jika tidak ingin ubah" : "123456:ABCdef..."}"/>
    <div class="hint">Dari @BotFather · Wajib</div>

    <label>User ID Admin <span class="req">*</span></label>
    <input type="text" name="ADMIN_ID"
      placeholder="${status.ADMIN_ID ? fieldHint("ADMIN_ID") : "1234567890"}"
      value="${fieldHint("ADMIN_ID")}"/>
    <div class="hint">ID Telegram kamu · Cek via @userinfobot</div>

    <hr class="sep"/>
    <div class="sec">🧠 NVIDIA AI (Chat + Teks→Foto)</div>

    <label>NVIDIA API Key</label>
    <input type="password" name="NVIDIA_API_KEY"
      placeholder="${status.NVIDIA_API_KEY ? "Sudah diset — kosongkan jika tidak ingin ubah" : "nvapi-..."}"/>
    <div class="hint">Dari build.nvidia.com · Untuk fitur AI chat &amp; generate foto</div>

    <hr class="sep"/>
    <div class="sec">🎬 Kling AI (Video Generation — Opsional)</div>

    <label>Kling Access Key</label>
    <input type="password" name="KLING_ACCESS_KEY"
      placeholder="${status.KLING_ACCESS_KEY ? "Sudah diset" : "kling-access-..."}"/>

    <label>Kling Secret Key</label>
    <input type="password" name="KLING_SECRET_KEY"
      placeholder="${status.KLING_SECRET_KEY ? "Sudah diset" : "kling-secret-..."}"/>
    <div class="hint">Dari platform.klingai.com · Tanpa ini video pakai FFmpeg (tetap bisa)</div>

    <hr class="sep"/>
    <div class="sec">🖼️ Remove.bg (Opsional)</div>

    <label>Remove.bg API Key</label>
    <input type="password" name="REMOVE_BG_API_KEY"
      placeholder="${status.REMOVE_BG_API_KEY ? "Sudah diset" : "removebg-..."}"/>
    <div class="hint">Dari remove.bg · Opsional — tanpa ini pakai engine lokal (tetap bisa)</div>

    <button class="btn" type="submit">💾 Simpan Konfigurasi</button>
  </form>

  <div class="note">
    ⚠️ Setelah menyimpan Token Bot yang baru, restart server agar perubahan aktif.<br/>
    API key lain (NVIDIA, Kling) langsung aktif tanpa restart.
  </div>
</div>
</body>
</html>`;
}

router.get("/setup", (_req, res) => {
  loadConfig();
  res.send(renderPage());
});

router.post("/setup", (req, res) => {
  try {
    const {
      TELEGRAM_BOT_TOKEN,
      ADMIN_ID,
      NVIDIA_API_KEY,
      KLING_ACCESS_KEY,
      KLING_SECRET_KEY,
      REMOVE_BG_API_KEY,
    } = req.body as Record<string, string>;

    saveConfig({
      TELEGRAM_BOT_TOKEN,
      ADMIN_ID,
      NVIDIA_API_KEY,
      KLING_ACCESS_KEY,
      KLING_SECRET_KEY,
      REMOVE_BG_API_KEY,
    });

    res.send(
      renderPage(
        "✅ Konfigurasi berhasil disimpan! API key langsung aktif. Jika mengubah Bot Token, restart server.",
        "success"
      )
    );
  } catch (e: any) {
    res.send(renderPage(`❌ Gagal menyimpan: ${e.message}`, "error"));
  }
});

export default router;

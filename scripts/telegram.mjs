// Telegram bot for MyManager: one-tap Approve/Deny on your phone, quick capture, and asking the assistant.
// Started by scripts/local.mjs when TELEGRAM_BOT_TOKEN is set. Uses long polling, so no public URL is needed.
// Pairing: message the bot "/start <pair code>" (code shown in MyManager (Settings, Alerts on your phone)). Only that chat is obeyed.
import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = process.env.TELEGRAM_API ?? "https://api.telegram.org"; // overridable for tests
const BASE = process.env.MANAGER_URL ?? "http://127.0.0.1:3000";
const KEY = process.env.MANAGER_KEY ?? "";
// Telegram only accepts public https links on buttons, so links are shown only when the app is online.
const PUBLIC = /^https:\/\//.test(process.env.APP_URL ?? "") ? process.env.APP_URL.replace(/\/$/, "") : null;
const STATE = process.env.TELEGRAM_STATE ?? path.join(process.cwd(), ".localdb", "telegram-state.json");
if (!TOKEN) { console.log("No TELEGRAM_BOT_TOKEN, bot not started."); process.exit(0); }

const tg = async (method, body) => {
  const r = await fetch(`${API}/bot${TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
};
const mgr = async (op, extra = {}) => {
  const r = await fetch(`${BASE}/api/bot`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-manager-key": KEY }, body: JSON.stringify({ op, ...extra }),
  });
  if (!r.ok) throw new Error(`MyManager ${r.status}`);
  return r.json();
};

let state = { notified: [], offset: 0, runId: null };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE, "utf8")) }; } catch {}
const save = () => { try { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(state)); } catch {} };

let chatId = null;
const money = (c) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]);

function approvalText(a) {
  return `🛡 <b>Approval needed</b>\n${esc(a.title)}\n<i>${a.cost_cents ? `${money(a.cost_cents)} · ` : ""}asked by ${a.requested_by === "agent" ? "MyManager" : "you"}</i>${a.reason ? `\n${esc(a.reason)}` : ""}`;
}

async function notifyPending() {
  if (!chatId) return;
  const pending = await mgr("pending");
  for (const a of pending) {
    if (state.notified.includes(a.id)) continue;
    await tg("sendMessage", {
      chat_id: chatId, text: approvalText(a), parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "✅ Approve", callback_data: `ap:${a.id}` }, { text: "✋ Deny", callback_data: `dn:${a.id}` }], ...(PUBLIC ? [[{ text: "Open Approvals", url: `${PUBLIC}/approvals` }]] : [])] },
    }).catch((e) => console.log(`[bot] ${e.message}`));
    state.notified.push(a.id);
  }
  state.notified = state.notified.slice(-300);
  save();
}

/** Runs the assistant through Manager's own /api/agent stream and returns the final summary. */
async function ask(text) {
  const r = await fetch(`${BASE}/api/agent`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: `mgr_session=${KEY}` },
    body: JSON.stringify({ goal: text, runId: state.runId ?? undefined }),
  });
  if (!r.ok || !r.body) throw new Error(`MyManager ${r.status}`);
  const dec = new TextDecoder();
  let buf = "", summary = "", steps = [];
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const l of lines) {
      if (!l.trim()) continue;
      const e = JSON.parse(l);
      if (e.type === "start") state.runId = e.runId;
      if (e.type === "tool_done") steps.push(e.label);
      if (e.type === "done") summary = e.summary;
      if (e.type === "error") summary = `⚠️ ${e.message}`;
    }
  }
  save();
  return { summary, steps };
}

async function onMessage(m) {
  const text = (m.text ?? "").trim();
  const from = String(m.chat.id);
  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1]?.toUpperCase();
    if (chatId && from !== chatId) return; // already paired with another chat: unpair in Manager first
    const ok = code ? (await mgr("pair", { chat_id: from, code }).catch(() => ({ ok: false }))).ok : false;
    if (ok) {
      chatId = from;
      await tg("sendMessage", { chat_id: from, text: "Paired ✅ I'll send approvals here.\n\nJust type to ask me anything.\n<b>+ text</b> quick-adds a task (<b>+ #punter text</b> for a project, <b>+ idea: text</b> for an idea).\n/new starts a fresh conversation. /pending lists what's waiting.", parse_mode: "HTML" });
      await notifyPending();
    } else {
      await tg("sendMessage", { chat_id: from, text: "Send /start followed by the pair code shown in MyManager (Settings, Alerts on your phone)." });
    }
    return;
  }
  if (from !== chatId) return; // ignore everyone else
  if (text === "/new") { state.runId = null; save(); await tg("sendMessage", { chat_id: from, text: "Fresh conversation. What's next?" }); return; }
  if (text === "/pending") {
    state.notified = [];
    const p = await mgr("pending");
    if (!p.length) await tg("sendMessage", { chat_id: from, text: "Nothing waiting for you 👌" });
    await notifyPending();
    return;
  }
  if (m.voice) { await tg("sendMessage", { chat_id: from, text: "Voice notes aren't supported yet. Use your keyboard's mic button and send it as text." }); return; }
  if (!text) return;
  // a reply to a "❓ … needs you" question goes straight back to that supervised mission
  const tag = (m.reply_to_message?.text ?? "").match(/#m:([0-9a-f]{8})/i);
  if (tag && text) {
    const r = await mgr("answer", { id: tag[1], text });
    await tg("sendMessage", { chat_id: from, text: r.ok ? "Thanks, passed on ✅ It's carrying on." : "That question is already closed. Ask me anything instead." });
    return;
  }
  if (text.startsWith("+")) {
    await mgr("capture", { text: text.slice(1).trim() });
    await tg("sendMessage", { chat_id: from, text: "Added ✅" });
    return;
  }
  const typing = setInterval(() => tg("sendChatAction", { chat_id: from, action: "typing" }).catch(() => {}), 4500);
  tg("sendChatAction", { chat_id: from, action: "typing" }).catch(() => {});
  try {
    const { summary, steps } = await ask(text);
    const did = steps.length ? `\n\n<i>${steps.slice(0, 8).map(esc).join(" · ")}</i>` : "";
    await tg("sendMessage", { chat_id: from, text: `${esc(summary || "Done.").replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")}${did}`.slice(0, 4000), parse_mode: "HTML" });
  } catch (e) {
    await tg("sendMessage", { chat_id: from, text: `⚠️ ${e.message}` });
  } finally {
    clearInterval(typing);
  }
  await notifyPending();
}

async function onCallback(q) {
  if (String(q.message?.chat?.id) !== chatId) return tg("answerCallbackQuery", { callback_query_id: q.id, text: "Not paired" });
  const [act, id] = String(q.data).split(":");
  try {
    const r = await mgr("decide", { id, approve: act === "ap" });
    const label = act === "ap" ? (r?.status === "executed" ? "✅ Approved and done" : r?.status === "failed" ? "⚠️ Approved but it failed" : "✅ Approved") + ` by you at ${new Date().toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" })}` : `✋ Denied by you at ${new Date().toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" })}`;
    await tg("editMessageText", { chat_id: chatId, message_id: q.message.message_id, text: `${esc(q.message.text)}\n\n<b>${label}</b>`, parse_mode: "HTML" });
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: label });
  } catch (e) {
    await tg("answerCallbackQuery", { callback_query_id: q.id, text: e.message });
  }
}

async function main() {
  const me = await tg("getMe");
  chatId = (await mgr("settings").catch(() => ({})))?.telegram_chat_id ?? null;
  console.log(`Telegram bot @${me.username} running.${chatId ? " Paired." : " Not paired: send it /start and the pair code shown in MyManager's Settings."}`);
  setInterval(() => notifyPending().catch((e) => console.log(`[bot] ${e.message}`)), 15000);
  for (;;) {
    try {
      const updates = await tg("getUpdates", { offset: state.offset, timeout: 30, allowed_updates: ["message", "callback_query"] });
      for (const u of updates) {
        state.offset = u.update_id + 1;
        save();
        if (u.message) onMessage(u.message).catch((e) => console.log(`[bot] ${e.message}`));
        if (u.callback_query) onCallback(u.callback_query).catch((e) => console.log(`[bot] ${e.message}`));
      }
    } catch (e) {
      console.log(`[bot] ${e.message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
main().catch((e) => { console.log(`[bot] stopped: ${e.message}`); process.exit(1); });

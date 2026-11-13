import "server-only";
import { db } from "@/lib/db";

/** Sends Thomas a message on his paired Telegram chat, if there is one. Returns true if sent. */
export async function notify(text: string, link?: { label: string; url: string }): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const { data } = await db().from("settings").select("telegram_chat_id").eq("id", 1).single();
  const chat = data?.telegram_chat_id as string | null;
  if (!chat) return false;
  const api = process.env.TELEGRAM_API ?? "https://api.telegram.org";
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  try {
    const r = await fetch(`${api}/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chat, parse_mode: "HTML",
        text: esc(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").slice(0, 4000),
        ...(link ? { reply_markup: { inline_keyboard: [[{ text: link.label, url: link.url }]] } } : {}),
      }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

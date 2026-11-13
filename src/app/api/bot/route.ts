import { cookies } from "next/headers";
import { COOKIE, managerKey, sameText, sessionToken } from "@/lib/auth";
import { quickCapture } from "@/app/actions";
import { decideAction } from "@/lib/action-queue";
import { getActions } from "@/lib/queries";
import { kindOf } from "@/lib/action-registry";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Small API for the phone bot (scripts/telegram.mjs). Auth: session cookie or x-manager-key header. */
async function authed(req: Request) {
  return sameText(req.headers.get("x-manager-key"), await managerKey()) || sameText((await cookies()).get(COOKIE)?.value, await sessionToken());
}

export async function POST(req: Request) {
  if (!(await authed(req))) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json()) as { op: string; id?: string; approve?: boolean; text?: string; chat_id?: string; code?: string };
  switch (body.op) {
    case "pending": {
      const rows = await getActions(["pending"]);
      return Response.json(rows.map((a) => ({ id: a.id, title: a.title, kind: kindOf(a.kind).label, reason: a.reason, cost_cents: a.cost_cents, requested_by: a.requested_by })));
    }
    case "decide": {
      if (!body.id) return new Response("Missing id", { status: 400 });
      await decideAction(body.id, !!body.approve);
      const { data } = await db().from("actions").select("status,result").eq("id", body.id).single();
      return Response.json(data);
    }
    case "capture": {
      const f = new FormData();
      f.set("text", body.text ?? "");
      await quickCapture(f);
      return Response.json({ ok: true });
    }
    case "answer": {
      // Thomas replied on his phone to a mission question ("#m:<8 chars>")
      const short = String(body.id ?? "").toLowerCase();
      const { data } = await db().from("missions").select("id").in("status", ["waiting", "running"]);
      const m = ((data ?? []) as { id: string }[]).find((x) => x.id.replace(/-/g, "").startsWith(short));
      if (!m || !body.text) return Response.json({ ok: false });
      const { answerMission } = await import("@/lib/missions");
      await answerMission(m.id, body.text);
      return Response.json({ ok: true });
    }
    case "pair": {
      // The phone sends the one-time code shown in Settings. It works once, for 30 minutes.
      const code = String(body.code ?? "").trim().toUpperCase();
      const { data: s } = await db().from("settings").select("telegram_pair_code,telegram_pair_expires").eq("id", 1).single();
      const live = s?.telegram_pair_code && s.telegram_pair_expires && new Date(s.telegram_pair_expires).getTime() > Date.now();
      if (!code || !live || !sameText(code, String(s.telegram_pair_code))) return Response.json({ ok: false });
      await db().from("settings").update({ telegram_chat_id: body.chat_id ?? null, telegram_pair_code: null, telegram_pair_expires: null }).eq("id", 1);
      return Response.json({ ok: true });
    }
    case "settings": {
      const { data } = await db().from("settings").select("telegram_chat_id").eq("id", 1).single();
      return Response.json(data);
    }
    default:
      return new Response("Unknown op", { status: 400 });
  }
}

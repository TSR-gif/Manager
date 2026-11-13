import { cookies } from "next/headers";
import { COOKIE, sessionToken } from "@/lib/auth";
import { decideAction, quickCapture } from "@/app/actions";
import { getActions } from "@/lib/queries";
import { kindOf } from "@/lib/action-registry";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Small API for the phone bot (scripts/telegram.mjs). Auth: session cookie or x-manager-key header. */
async function authed(req: Request) {
  const t = await sessionToken();
  return req.headers.get("x-manager-key") === t || (await cookies()).get(COOKIE)?.value === t;
}

export async function POST(req: Request) {
  if (!(await authed(req))) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json()) as { op: string; id?: string; approve?: boolean; text?: string; chat_id?: string };
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
    case "pair": {
      await db().from("settings").update({ telegram_chat_id: body.chat_id ?? null }).eq("id", 1);
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

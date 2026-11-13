import { cookies } from "next/headers";
import { COOKIE, sessionToken } from "@/lib/auth";
import { tick } from "@/lib/proactive";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** POST {op:"tick"} from the local launcher every few minutes; {op:"brief"|"checkin"} to run one now. */
export async function POST(req: Request) {
  const t = await sessionToken();
  if (req.headers.get("x-manager-key") !== t && (await cookies()).get(COOKIE)?.value !== t) return new Response("Unauthorized", { status: 401 });
  const { op } = (await req.json().catch(() => ({}))) as { op?: string };
  const r = await tick(op === "brief" || op === "checkin" ? op : undefined);
  return Response.json(r);
}

import "server-only";
import { db } from "@/lib/db";
import { ALWAYS_ASK, kindOf } from "@/lib/action-registry";
import { getSettings } from "@/lib/queries";

/** Straight approvals of this action type since the last rejection, and whether it has earned auto. */
export async function trustLevel(kind: string): Promise<{ streak: number; needed: number; trusted: boolean; eligible: boolean }> {
  const k = kindOf(kind);
  const s = await getSettings();
  const needed = s.trust_after ?? 3;
  const eligible = !!k.trustable && !ALWAYS_ASK.includes(k.kind) && needed > 0;
  if (!eligible) return { streak: 0, needed, trusted: false, eligible };
  const { data } = await db().from("actions").select("status,reason").eq("kind", k.kind)
    .in("status", ["approved", "executed", "rejected", "failed"]).order("created_at", { ascending: false }).limit(50);
  let streak = 0;
  for (const r of (data ?? []) as { status: string; reason: string | null }[]) {
    if (r.status === "rejected" || r.status === "failed") break;
    if (!r.reason?.includes("auto-approved by trust ladder")) streak++;
  }
  return { streak, needed, trusted: streak >= needed, eligible };
}


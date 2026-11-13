// The approval queue: queue an action, and approve or turn it down.
// Lives outside actions.ts so background jobs, agent tools and the phone bot can use it
// without going through a browser server action (those all check the login cookie).
import { revalidatePath } from "next/cache";
import { db, unwrap } from "@/lib/db";
import { kindOf } from "@/lib/action-registry";
import { trustLevel } from "@/lib/trust";
import type { Action } from "@/lib/types";

const refresh = () => { try { revalidatePath("/", "layout"); } catch { /* not in a request */ } };

export async function queueAction(input: {
  kind: string; title: string; reason?: string; payload?: Record<string, unknown>;
  cost_cents?: number; project_id?: string | null; requested_by?: string;
}): Promise<Action> {
  const k = kindOf(input.kind);
  const raw = Number(input.cost_cents ?? 0);
  if (!Number.isFinite(raw) || raw < 0 || raw > 100_000_000) throw new Error("The cost has to be a normal amount of money.");
  const cost = Math.round(raw);
  if (cost > 0) {
    // Paid: the database checks the caps and reserves the money in one locked step, so requests that arrive
    // at the same moment can't each see room for themselves (supabase/migrations/0020_review_fixes.sql).
    const [a] = unwrap(await db().rpc("mm_queue_paid_action", {
      p_kind: k.kind, p_title: input.title, p_reason: input.reason ?? null, p_payload: input.payload ?? {},
      p_cost: cost, p_project: input.project_id ?? null, p_requested_by: input.requested_by ?? "user",
    })) as Action[];
    refresh();
    return a;
  }
  let risk: Action["risk"] = k.risk;
  // Trust ladder: a trustable, free action type Thomas has approved N times in a row runs on its own.
  let trusted = false;
  if (risk === "approval" && (await trustLevel(k.kind)).trusted) { risk = "auto"; trusted = true; }

  const [a] = unwrap(await db().from("actions").insert({
    kind: k.kind, title: input.title, reason: input.reason ?? null, payload: input.payload ?? {},
    cost_cents: 0, risk, project_id: input.project_id ?? null,
    requested_by: input.requested_by ?? "user",
    status: "pending",
    ...(trusted ? { reason: `${input.reason ? input.reason + " · " : ""}auto-approved by trust ladder` } : {}),
  }).select());
  if (risk === "auto") return await execute(a);
  refresh();
  return a;
}

/** Keep an ad campaign's status in step with its approval: waiting → ready (approved) → live (you launched it). */
export async function syncCampaign(a: Pick<Action, "kind" | "payload">, step: "approved" | "rejected" | "done") {
  const id = (a.payload as { campaign_id?: string })?.campaign_id;
  if (!id || !a.kind.startsWith("ads.")) return;
  const p = a.payload as { daily_budget_cents?: number; days?: number };
  if (a.kind === "ads.launch") {
    const status = step === "approved" ? "ready" : step === "rejected" ? "draft" : "live";
    await db().from("campaigns").update({ status, ...(step === "done" ? { started_on: new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date()) } : {}) }).eq("id", id);
  } else if (a.kind === "ads.budget" && step === "approved") {
    await db().from("campaigns").update({ ...(p.daily_budget_cents != null ? { daily_budget_cents: p.daily_budget_cents } : {}), ...(p.days != null ? { days: p.days } : {}) }).eq("id", id);
  } else if (a.kind === "ads.pause" && step === "approved") {
    await db().from("campaigns").update({ status: "paused" }).eq("id", id);
  }
}

async function execute(a: Action): Promise<Action> {
  const k = kindOf(a.kind);
  const now = new Date().toISOString();
  await syncCampaign(a, "approved");
  if (!k.execute) {
    // Nothing automatic to run: approved and handed to the agent / PC helper / you.
    const [r] = unwrap(await db().from("actions").update({ status: "approved", decided_at: a.decided_at ?? now }).eq("id", a.id).select());
    refresh();
    return r;
  }
  try {
    const result = await k.execute(a);
    const [r] = unwrap(await db().from("actions").update({ status: "executed", result, executed_at: now, decided_at: a.decided_at ?? now }).eq("id", a.id).select());
    refresh();
    return r;
  } catch (e) {
    const [r] = unwrap(await db().from("actions").update({ status: "failed", result: { error: String(e) }, executed_at: now }).eq("id", a.id).select());
    refresh();
    return r;
  }
}

export async function decideAction(id: string, approve: boolean) {
  // Claim it in one locked database step, so a double tap (or the phone and the web at once) can't run it twice,
  // and a paid one is checked against the caps again right as it's approved.
  const { data: claimed, error } = await db().rpc("mm_claim_action", { p_id: id, p_approve: approve });
  if (error) throw new Error(`Couldn't record that decision: ${error.message}`);
  const a = (claimed as Action[] | null)?.[0];
  if (!a) return;
  if (a.status === "rejected") {
    if ((a.result as { blocked?: string } | null)?.blocked) { refresh(); return; } // over a cap now: nothing runs
    await syncCampaign(a, "rejected");
    if (a.kind === "runbook.step" || a.kind === "runbook.run") {
      const rb = await import("@/lib/runbooks");
      const p = a.payload as { runbook_id: string; step_id?: string };
      if (a.kind === "runbook.step" && p.step_id) await rb.resolveStep(p.runbook_id, p.step_id, "rejected");
      else await db().from("runbooks").update({ status: "stopped", last_update: "You said no, so nothing ran." }).eq("id", p.runbook_id);
    }
    refresh();
    void helpersHear(`Turned down: ${a.title}`, a.project_id);
    return;
  }
  await execute(a);
  void helpersHear(`Approved: ${a.title}`, a.project_id);
}

const helpersHear = (text: string, projectId: string | null) =>
  import("@/lib/missions").then((m) => m.wakeHelpers("approval_decided", text, projectId)).catch(() => {});

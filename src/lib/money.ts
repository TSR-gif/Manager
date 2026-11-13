import "server-only";
import { db, unwrap } from "@/lib/db";
import type { Project } from "@/lib/types";

export interface TimeEntry { id: string; project_id: string; worked_on: string; minutes: number; note: string | null; invoice_id: string | null; created_at: string }
export interface Invoice { id: string; project_id: string; number: string | null; amount_cents: number; status: "draft" | "sent" | "paid" | "void"; issued_on: string | null; due_on: string | null; paid_on: string | null; note: string | null; created_at: string }
export interface Subscription { id: string; name: string; project_id: string | null; amount_cents: number; currency: string; cycle: "monthly" | "yearly" | "weekly"; next_renewal: string | null; url: string | null; status: "active" | "cancelled" | "trial"; note: string | null }

export interface ClientJob {
  project: Project & { client_name?: string | null; hourly_rate_cents?: number | null };
  minutesTotal: number;
  minutesUnbilled: number;
  unbilledCents: number;   // unbilled hours × rate
  owedCents: number;       // sent, not yet paid
  overdueCents: number;    // sent and past due date
  paidCents: number;
  entries: TimeEntry[];
  invoices: Invoice[];
}

export const monthlyCents = (s: Pick<Subscription, "amount_cents" | "cycle">) =>
  s.cycle === "yearly" ? Math.round(s.amount_cents / 12) : s.cycle === "weekly" ? Math.round((s.amount_cents * 52) / 12) : s.amount_cents;

export async function getClientJobs(): Promise<ClientJob[]> {
  const projects = unwrap(await db().from("projects").select("*").eq("kind", "client").order("priority")) as ClientJob["project"][];
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);
  const [entries, invoices] = await Promise.all([
    db().from("time_entries").select("*").in("project_id", ids).order("worked_on", { ascending: false }),
    db().from("invoices").select("*").in("project_id", ids).order("created_at", { ascending: false }),
  ]);
  const E = unwrap(entries) as TimeEntry[];
  const I = unwrap(invoices) as Invoice[];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne" }).format(new Date());
  return projects.map((project) => {
    const entries = E.filter((e) => e.project_id === project.id);
    const invoices = I.filter((i) => i.project_id === project.id);
    const minutesTotal = entries.reduce((s, e) => s + e.minutes, 0);
    const minutesUnbilled = entries.filter((e) => !e.invoice_id).reduce((s, e) => s + e.minutes, 0);
    const sent = invoices.filter((i) => i.status === "sent");
    return {
      project, entries, invoices, minutesTotal, minutesUnbilled,
      unbilledCents: Math.round((minutesUnbilled / 60) * (project.hourly_rate_cents ?? 0)),
      owedCents: sent.reduce((s, i) => s + i.amount_cents, 0),
      overdueCents: sent.filter((i) => i.due_on && i.due_on < today).reduce((s, i) => s + i.amount_cents, 0),
      paidCents: invoices.filter((i) => i.status === "paid").reduce((s, i) => s + i.amount_cents, 0),
    };
  });
}

export async function getSubscriptions(): Promise<Subscription[]> {
  return unwrap(await db().from("subscriptions").select("*").order("amount_cents", { ascending: false })) as Subscription[];
}

export const hours = (m: number) => `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`;

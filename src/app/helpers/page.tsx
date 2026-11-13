import Link from "next/link";
import { Plus } from "lucide-react";
import { db } from "@/lib/db";
import { getProjects } from "@/lib/queries";
import { helperLook } from "@/lib/helper-look";
import { todayData } from "@/lib/today";
import { Head } from "@/components/nav";
import { TZ } from "@/components/ui";

export const dynamic = "force-dynamic";

const when = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  const days = (Date.now() - d.getTime()) / 86_400_000;
  return days < 1 && d.toLocaleDateString("en-CA", { timeZone: TZ }) === new Date().toLocaleDateString("en-CA", { timeZone: TZ })
    ? d.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", timeZone: TZ }).replace(/\s?[ap]m/i, "")
    : days < 7 ? d.toLocaleDateString("en-AU", { weekday: "short", timeZone: TZ }) : d.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: TZ });
};

export default async function Helpers() {
  const [projects, t, mq] = await Promise.all([
    getProjects(), todayData(),
    db().from("missions").select("project_id,last_update,last_check_at,status").order("last_check_at", { ascending: false, nullsFirst: false }).limit(200),
  ]);
  const missions = (mq.data ?? []) as { project_id: string | null; last_update: string | null; last_check_at: string | null; status: string }[];
  const line = (id: string) => {
    const q = t.asks.find((a) => a.project_id === id);
    if (q?.question) return { need: true, text: q.question };
    const a = t.approvals.find((x) => x.project_id === id);
    if (a) return { need: true, text: a.title };
    const s = t.steps.find((x) => x.project_id === id);
    if (s) return { need: true, text: s.label };
    const m = missions.find((x) => x.project_id === id && x.last_update);
    return { need: false, text: m?.last_update ?? "", at: m?.last_check_at };
  };
  const count = (id: string) => t.approvals.filter((a) => a.project_id === id).length + t.asks.filter((a) => a.project_id === id).length + t.steps.filter((a) => a.project_id === id).length;
  const active = projects.filter((p) => p.status === "active");
  const rest = projects.filter((p) => p.status === "paused" || p.status === "idea");
  const rows = active.map((p) => ({ p, l: line(p.id), n: count(p.id) })).sort((a, b) => Number(b.n > 0) - Number(a.n > 0));

  const Row = ({ p, text, n, at }: { p: (typeof projects)[number]; text: string; n: number; at?: string | null }) => {
    const look = helperLook(p.name);
    return (
      <Link href={`/projects/${p.id}`} className={`hrow ${n ? "need" : ""}`}>
        <div className="tile" style={{ background: look.bg }}>{look.emoji}</div>
        <div className="tx">
          <b>{p.name}<small>{when(at ?? p.last_touched_at)}</small></b>
          <span>{text || p.next_action || p.goal || "Nothing new. I'm keeping an eye on it."}</span>
        </div>
        {n > 0 && <span className="badge !ml-0">{n}</span>}
      </Link>
    );
  };

  return (
    <>
      <Head title="Helpers" right={<Link href="/projects/new" className="iconbtn" aria-label="New helper"><Plus size={18} strokeWidth={1.7} /></Link>} />
      <div className="pagewrap fade-in">
        <h1 className="ttl">Helpers</h1>
        <p className="mb-2 text-[14px] text-muted">One for each project or part of your life. Each one keeps an eye on its area and only comes to you for a decision or a result.</p>
        <div>
          {rows.map(({ p, l, n }) => <Row key={p.id} p={p} text={l.text} n={n} at={"at" in l ? l.at : null} />)}
          <Link href="/projects/new" className="hrow text-muted">
            <div className="tile" style={{ background: "#f6f6f4" }}><Plus size={20} strokeWidth={1.7} /></div>
            <div className="tx"><b>New helper</b><span>A project, or something like groceries, bills or the car</span></div>
          </Link>
        </div>

        <div className="sec">Everything else</div>
        {[
          { href: "/money", name: "Money", text: "Spending, bills, hours and invoices" },
          { href: "/marketing", name: "Marketing", text: "Posts, ads and weekly jobs" },
          { href: "/inbox", name: "Ideas", text: "Videos and links you've sent me" },
          { href: "/servers", name: "Servers", text: "Your sites and services" },
        ].map((o) => {
          const look = helperLook(o.name);
          return (
            <Link key={o.href} href={o.href} className="hrow">
              <div className="tile" style={{ background: look.bg }}>{look.emoji}</div>
              <div className="tx"><b>{o.name}</b><span>{o.text}</span></div>
            </Link>
          );
        })}

        {rest.length > 0 && (
          <details className="mt-6">
            <summary className="sec cursor-pointer list-none">Paused and ideas · {rest.length}</summary>
            {rest.map((p) => <Row key={p.id} p={p} text={p.status === "paused" ? "Paused" : "Just an idea for now"} n={0} />)}
          </details>
        )}
      </div>
    </>
  );
}

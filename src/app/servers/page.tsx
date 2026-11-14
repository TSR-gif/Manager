import Link from "next/link";
import { CheckCircle2, CircleAlert, CircleDashed } from "lucide-react";
import { getProjects } from "@/lib/queries";
import { getSignals } from "@/lib/signals";
import { helperLook } from "@/lib/helper-look";
import { vercelProblem } from "@/lib/vercel-auth";
import { Head } from "@/components/nav";
import { AskBar } from "@/components/ask-bar";
import { ago } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Servers: every site MyManager knows about, and whether its last deploy is OK. */
export default async function Servers() {
  const projects = (await getProjects()).filter((p) => p.vercel_project && p.status !== "archived");
  const signals = await getSignals(projects);
  const rows = projects.map((p) => {
    const v = signals[p.id]?.vercel;
    const state = v?.error ? "unknown" : v?.state === "READY" ? "ok" : v?.state === "ERROR" || v?.state === "CANCELED" ? "down" : v?.state ? "busy" : "unknown";
    return { p, v, state };
  });
  const down = rows.filter((r) => r.state === "down").length;
  const ok = rows.filter((r) => r.state === "ok").length;
  const look = helperLook("Servers");
  return (
    <>
      <Head title="Servers" />
      <div className="pagewrap fade-in">
        <div className="hh">
          <div className="tile lg" style={{ background: look.bg }}>{look.emoji}</div>
          <h1>Servers</h1>
          <div className="stl">{rows.length === 0 ? "No sites linked yet" : down ? `${down} need${down === 1 ? "s" : ""} a look` : ok === rows.length ? `All ${rows.length} fine` : ok ? `${ok} of ${rows.length} fine, the rest not checked` : "Not checked yet"}</div>
        </div>
        {rows.map(({ p, v, state }) => (
          <Link key={p.id} href={`/projects/${p.id}?tab=activity`} className="hrow">
            <div className="tile" style={{ background: helperLook(p.name).bg }}>{helperLook(p.name).emoji}</div>
            <div className="tx">
              <b>{p.name}<small>{v?.createdAt ? `deployed ${ago(v.createdAt)}` : ""}</small></b>
              <span>{state === "ok" ? `Up · ${v?.url?.replace(/^https?:\/\//, "") ?? p.vercel_project}` : state === "down" ? "Last deploy failed" : state === "busy" ? `Deploying (${v?.state?.toLowerCase()})` : v?.error ? `Couldn't check: ${vercelProblem(v.error)}` : "Not checked yet"}</span>
            </div>
            {state === "ok" ? <CheckCircle2 size={18} className="text-[#1a9b5c]" /> : state === "down" ? <CircleAlert size={18} className="text-bad" /> : <CircleDashed size={18} className="text-faint" />}
          </Link>
        ))}
        {rows.some((r) => r.v?.error) && <p className="mt-4 text-[13px] text-muted">To fix &quot;couldn&apos;t check&quot;, ask below to sign MyManager in to Vercel. A window opens and you just confirm it in the browser.</p>}
        <p className="mt-4 text-[13px] text-muted">These are the sites linked to a helper. Ask below to find the rest (Supabase, other hosts) from your project folders.</p>
        <AskBar placeholder="Ask about your servers" about="my servers" />
      </div>
    </>
  );
}

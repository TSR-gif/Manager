import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { DefaultHead, Nav, type HelperItem } from "@/components/nav";
import { CommandBar } from "@/components/command-bar";
import { UsageLog } from "@/components/usage-log";
import { db } from "@/lib/db";
import { helperLook } from "@/lib/helper-look";

export const metadata: Metadata = {
  title: "MyManager",
  description: "Thomas's manager",
  appleWebApp: { capable: true, title: "MyManager", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** What the sidebar shows: how many things need Thomas, one row per helper, and the "everything else" helpers. */
async function shellData() {
  try {
    const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
    const [a, m, r, p, ideas, st, spend] = await Promise.all([
      db().from("actions").select("id,project_id").eq("status", "pending"),
      db().from("missions").select("id,project_id,status").in("status", ["waiting", "running"]),
      db().from("runbooks").select("id,project_id,status").in("status", ["waiting", "running"]),
      db().from("projects").select("id,name,status,priority").eq("status", "active").order("priority"),
      db().from("ideas").select("id").eq("status", "inbox"),
      db().from("settings").select("monthly_cap_cents").eq("id", 1).maybeSingle(),
      db().from("actions").select("cost_cents").in("status", ["approved", "executed"]).gte("created_at", month.toISOString()),
    ]);
    const acts = (a.data ?? []) as { project_id: string | null }[];
    const ms = (m.data ?? []) as { project_id: string | null; status: string }[];
    const rs = (r.data ?? []) as { project_id: string | null; status: string }[];
    const projects = (p.data ?? []) as { id: string; name: string }[];
    const jobs = [...ms, ...rs];
    const needs = (id: string) => acts.filter((x) => x.project_id === id).length + jobs.filter((x) => x.status === "waiting" && x.project_id === id).length;
    const working = (id: string) => jobs.some((x) => x.status === "running" && x.project_id === id);
    const helpers: HelperItem[] = projects.map((x) => ({ id: x.id, name: x.name, ...helperLook(x.name), need: needs(x.id), working: working(x.id) }));
    const pending = acts.length + jobs.filter((x) => x.status === "waiting").length;
    const cap = (st.data as { monthly_cap_cents?: number } | null)?.monthly_cap_cents ?? 0;
    const spent = ((spend.data ?? []) as { cost_cents: number }[]).reduce((s, x) => s + x.cost_cents, 0);
    const left = Math.max(0, cap - spent) / 100;
    const ideaN = (ideas.data ?? []).length;
    const other = {
      money: cap ? `$${left >= 1000 ? `${(left / 1000).toFixed(1)}k` : Math.round(left)} left` : "",
      ideas: ideaN ? `${ideaN} new` : "",
    };
    return { pending, helpers, other, projects };
  } catch {
    return { pending: 0, helpers: [] as HelperItem[], other: { money: "", ideas: "" }, projects: [] as { id: string; name: string }[] };
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { pending, helpers, other, projects } = await shellData();
  return (
    // Browser extensions (LanguageTool, Grammarly) add attributes to <html>/<body> before React loads; that is not a real mismatch.
    <html lang="en-AU" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        <div className="app">
          <Nav pending={pending} helpers={helpers} other={other} />
          <main className="mainwrap"><DefaultHead />{children}</main>
        </div>
        <CommandBar projects={projects} />
        <UsageLog />
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{})}`,
          }}
        />
      </body>
    </html>
  );
}

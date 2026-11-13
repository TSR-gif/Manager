import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const inter = localFont({ src: "./fonts/InterVariable-latin.woff2", variable: "--font-geist-sans", weight: "400 700", display: "swap" });
import { Nav } from "@/components/nav";
import { CommandBar } from "@/components/command-bar";
import { UsageLog } from "@/components/usage-log";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "MyManager",
  description: "Thomas's command centre",
  appleWebApp: { capable: true, title: "MyManager", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#07080c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export type Dot = { id: string; name: string; state: "needs" | "working" | "quiet" };

/** What the sidebar shows: how many things need Thomas, and one "dot" per active project with its live state. */
async function shellData() {
  try {
    const [a, m, r, p] = await Promise.all([
      db().from("actions").select("id,project_id").eq("status", "pending"),
      db().from("missions").select("id,project_id,status").in("status", ["waiting", "running"]),
      db().from("runbooks").select("id,project_id,status").in("status", ["waiting", "running"]),
      db().from("projects").select("id,name,status,priority").neq("status", "archived").order("priority"),
    ]);
    const acts = (a.data ?? []) as { project_id: string | null }[];
    const ms = (m.data ?? []) as { project_id: string | null; status: string }[];
    const rs = (r.data ?? []) as { project_id: string | null; status: string }[];
    const projects = (p.data ?? []) as { id: string; name: string; status: string }[];
    const needs = new Set([...acts.map((x) => x.project_id), ...ms.filter((x) => x.status === "waiting").map((x) => x.project_id), ...rs.filter((x) => x.status === "waiting").map((x) => x.project_id)]);
    const working = new Set([...ms, ...rs].filter((x) => x.status === "running").map((x) => x.project_id));
    const dots: Dot[] = projects.filter((x) => x.status === "active").map((x) => ({ id: x.id, name: x.name, state: needs.has(x.id) ? "needs" : working.has(x.id) ? "working" : "quiet" }));
    const order = { needs: 0, working: 1, quiet: 2 };
    dots.sort((x, y) => order[x.state] - order[y.state]);
    const pending = acts.length + ms.filter((x) => x.status === "waiting").length + rs.filter((x) => x.status === "waiting").length;
    return { pending, dots, projects: projects.map(({ id, name }) => ({ id, name })) };
  } catch {
    return { pending: 0, dots: [] as Dot[], projects: [] as { id: string; name: string }[] };
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { pending, dots, projects } = await shellData();
  return (
    <html lang="en-AU" data-theme="console" className={`${inter.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh antialiased">
        <Nav pending={pending} dots={dots} />
        <main className="md:pl-[244px]">
          <div className="shell">
            <div className="pagewrap" style={{ paddingTop: "max(1.5rem, env(safe-area-inset-top))" }}>{children}</div>
          </div>
        </main>
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

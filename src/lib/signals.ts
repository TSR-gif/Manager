import "server-only";
import type { Project, Signals } from "./types";

const VERCEL_API = "https://api.vercel.com";

async function github(repo: string): Promise<Signals["github"]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { lastPushAt: null, openPRs: 0, openIssues: 0, error: "GITHUB_TOKEN not set" };
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  try {
    const [repoRes, prRes] = await Promise.all([
      fetch(`https://api.github.com/repos/${repo}`, { headers, next: { revalidate: 300 } }),
      fetch(`https://api.github.com/repos/${repo}/pulls?state=open&per_page=50`, { headers, next: { revalidate: 300 } }),
    ]);
    if (!repoRes.ok) return { lastPushAt: null, openPRs: 0, openIssues: 0, error: `GitHub ${repoRes.status}` };
    const r = await repoRes.json();
    const prs = prRes.ok ? ((await prRes.json()) as unknown[]).length : 0;
    return { lastPushAt: r.pushed_at ?? null, openPRs: prs, openIssues: Math.max(0, (r.open_issues_count ?? 0) - prs) };
  } catch (e) {
    return { lastPushAt: null, openPRs: 0, openIssues: 0, error: String(e) };
  }
}

async function vercel(project: string): Promise<Signals["vercel"]> {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { state: null, url: null, createdAt: null, error: "VERCEL_TOKEN not set" };
  const team = process.env.VERCEL_TEAM_ID ? `&teamId=${process.env.VERCEL_TEAM_ID}` : "";
  try {
    const res = await fetch(
      `${VERCEL_API}/v6/deployments?app=${encodeURIComponent(project)}&target=production&limit=1${team}`,
      { headers: { Authorization: `Bearer ${token}` }, next: { revalidate: 300 } },
    );
    if (!res.ok) return { state: null, url: null, createdAt: null, error: `Vercel ${res.status}` };
    const d = (await res.json()).deployments?.[0];
    if (!d) return { state: null, url: null, createdAt: null };
    return {
      state: d.state ?? d.readyState ?? null,
      url: d.url ? `https://${d.url}` : null,
      createdAt: d.created ? new Date(d.created).toISOString() : null,
    };
  } catch (e) {
    return { state: null, url: null, createdAt: null, error: String(e) };
  }
}

export async function getSignals(projects: Project[]): Promise<Record<string, Signals>> {
  const entries = await Promise.all(
    projects.map(async (p) => {
      const [g, v] = await Promise.all([
        p.github_repo ? github(p.github_repo) : Promise.resolve(undefined),
        p.vercel_project ? vercel(p.vercel_project) : Promise.resolve(undefined),
      ]);
      return [p.id, { github: g, vercel: v }] as const;
    }),
  );
  return Object.fromEntries(entries);
}

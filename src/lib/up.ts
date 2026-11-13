import "server-only";

/**
 * Up Bank (Australia) personal API: read-only balances and spending.
 * Token: Up app → Data sharing → Personal Access Token, saved as UP_TOKEN in .env.local. Never leaves the PC.
 * Docs: https://developer.up.com.au
 */
const API = process.env.UP_API ?? "https://api.up.com.au/api/v1"; // overridable for tests

export interface Money {
  configured: boolean;
  error?: string;
  /** set when the totals are incomplete (Up failed part-way, or too many transactions to fetch) */
  partial?: string;
  checkedAt?: string;
  balanceCents?: number;
  spent7dCents?: number;
  spent30dCents?: number;
  topCategories?: { name: string; cents: number }[];
}

type UpMoney = { valueInBaseUnits?: number };
interface UpTx {
  attributes?: { amount?: UpMoney; status?: string; createdAt?: string; description?: string };
  relationships?: { category?: { data?: { id?: string } | null }; transferAccount?: { data?: unknown } };
}

const nice = (id: string) => id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export async function getMoney(): Promise<Money> {
  const token = process.env.UP_TOKEN;
  if (!token) return { configured: false };
  const headers = { Authorization: `Bearer ${token}` };
  try {
    const acc = await fetch(`${API}/accounts?page[size]=50`, { headers, next: { revalidate: 300 } });
    if (!acc.ok) return { configured: true, error: acc.status === 401 ? "Up token was rejected" : `Up ${acc.status}` };
    const accounts = ((await acc.json()).data ?? []) as { attributes?: { balance?: UpMoney; accountType?: string } }[];
    const balanceCents = accounts.reduce((s, a) => s + (a.attributes?.balance?.valueInBaseUnits ?? 0), 0);

    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    let url: string | null = `${API}/transactions?page[size]=100&filter[since]=${encodeURIComponent(since)}`;
    const txs: UpTx[] = [];
    let partial: string | undefined;
    for (let i = 0; url; i++) {
      if (i >= 30) { partial = "Only the latest 3,000 transactions were counted, so spending totals may be low."; break; }
      const r: Response = await fetch(url, { headers, next: { revalidate: 300 } });
      if (!r.ok) { partial = `Up stopped answering part-way (${r.status}), so spending totals are incomplete.`; break; }
      const j = await r.json();
      txs.push(...(j.data ?? []));
      url = j.links?.next ?? null;
    }
    const weekAgo = Date.now() - 7 * 86_400_000;
    let spent7d = 0, spent30d = 0;
    const cats = new Map<string, number>();
    for (const t of txs) {
      const v = t.attributes?.amount?.valueInBaseUnits ?? 0;
      if (v >= 0 || t.relationships?.transferAccount?.data) continue; // only money going out, not transfers between his accounts
      const out = -v;
      spent30d += out;
      if (new Date(t.attributes?.createdAt ?? 0).getTime() >= weekAgo) spent7d += out;
      const c = t.relationships?.category?.data?.id ?? "uncategorised";
      cats.set(c, (cats.get(c) ?? 0) + out);
    }
    const topCategories = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, cents]) => ({ name: nice(name), cents }));
    return { configured: true, balanceCents, spent7dCents: spent7d, spent30dCents: spent30d, topCategories, checkedAt: new Date().toISOString(), ...(partial ? { partial } : {}) };
  } catch (e) {
    return { configured: true, error: `Couldn't reach Up (${e instanceof Error ? e.message : "network"})` };
  }
}

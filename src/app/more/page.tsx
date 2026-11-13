import Link from "next/link";
import { ChevronRight, FolderKanban, Lightbulb, Megaphone, Radar, RefreshCcw, Settings, UserRound, Wallet } from "lucide-react";
import { getIdeas } from "@/lib/queries";

import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function More() {
  const ideas = await getIdeas("inbox");
  const { data: wq } = await db().from("missions").select("id").eq("status", "waiting");
  const waiting = (wq ?? []).length;
  const rows = [
    { href: "/projects", icon: FolderKanban, title: "Projects", sub: "Every project, how it's going and what's next" },
    { href: "/money", icon: Wallet, title: "Money", sub: "What you're owed, hours, subscriptions" },
    { href: "/supervise", icon: Radar, title: "Supervise", sub: "Work it's seeing through to the end, and questions for you", badge: waiting },
    { href: "/marketing", icon: Megaphone, title: "Marketing", sub: "Posts, replies and ads for your apps" },
    { href: "/inbox", icon: Lightbulb, title: "Ideas", sub: "Ideas you've jotted down, ready to sort", badge: ideas.length },
    { href: "/review", icon: RefreshCcw, title: "Weekly review", sub: "10 minutes to reset your priorities" },
    { href: "/me", icon: UserRound, title: "About you", sub: "What your assistant knows about you" },
    { href: "/settings", icon: Settings, title: "Settings", sub: "Phone alerts, bank, spending limits" },
  ];
  return (
    <div className="fade-in space-y-4">
      <h1 className="display text-[26px] md:text-[30px]">More</h1>
      <ul className="card divide-y divide-line !p-0">
        {rows.map((r) => (
          <li key={r.href}>
            <Link href={r.href} className="flex min-h-[64px] items-center gap-3 px-4 py-3 active:bg-panel2">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-panel3 text-accent"><r.icon size={19} /></div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-medium">{r.title}</div>
                <div className="truncate text-[12.5px] text-muted">{r.sub}</div>
              </div>
              {!!r.badge && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-accent px-2 text-[12px] font-bold text-white">{r.badge}</span>}
              <ChevronRight size={18} className="text-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

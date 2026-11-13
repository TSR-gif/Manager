import Link from "next/link";
import { ChevronRight, Lightbulb, Megaphone, Radar, RefreshCcw, Settings, ShieldCheck, UserRound, Wallet } from "lucide-react";
import { getIdeas } from "@/lib/queries";


export const dynamic = "force-dynamic";

export default async function More() {
  const ideas = await getIdeas("inbox");
  const rows = [
    { href: "/supervise", icon: Radar, title: "What I'm working on", badge: 0 },
    { href: "/approvals", icon: ShieldCheck, title: "Waiting for your OK", badge: 0 },
    { href: "/inbox", icon: Lightbulb, title: "Ideas", badge: ideas.length },
    { href: "/marketing", icon: Megaphone, title: "Marketing", badge: 0 },
    { href: "/money", icon: Wallet, title: "Money", badge: 0 },
    { href: "/review", icon: RefreshCcw, title: "Weekly review", badge: 0 },
    { href: "/me", icon: UserRound, title: "About you", badge: 0 },
    { href: "/settings", icon: Settings, title: "Settings", badge: 0 },
  ];
  return (
    <div className="fade-in mx-auto max-w-[620px] space-y-4 pt-2 md:pt-8">
      <h1 className="display text-[26px] md:text-[30px]">More</h1>
      <ul className="card divide-y divide-line !p-0">
        {rows.map((r) => (
          <li key={r.href}>
            <Link href={r.href} className="flex min-h-[56px] items-center gap-3 px-4 py-3 active:bg-panel2">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-panel3 text-muted"><r.icon size={17} /></div>
              <div className="min-w-0 flex-1 text-[15px] font-medium">{r.title}</div>
              {!!r.badge && <span className="grid h-6 min-w-6 place-items-center rounded-full bg-accent px-2 text-[12px] font-bold text-white">{r.badge}</span>}
              <ChevronRight size={18} className="text-faint" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

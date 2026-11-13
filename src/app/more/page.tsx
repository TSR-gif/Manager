import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { logout } from "@/app/actions";

export const dynamic = "force-dynamic";

const ROWS = [
  { href: "/review", emoji: "🔁", bg: "#e6efff", title: "Weekly review", sub: "How the week went and what's next" },
  { href: "/me", emoji: "🙂", bg: "#fdf1dc", title: "About you", sub: "What MyManager remembers about you" },
  { href: "/settings", emoji: "⚙️", bg: "#eef0f3", title: "Settings", sub: "Messages, quiet hours, phone, PC access, spending limits" },
  { href: "/supervise", emoji: "🛠️", bg: "#e4f6ec", title: "Everything I'm working on", sub: "Every job, step and live output" },
  { href: "/approvals", emoji: "✅", bg: "#f6f6f4", title: "Approvals and history", sub: "Everything you've said yes or no to, and what I did" },
];

/** The menu under Thomas's name. */
export default function More() {
  return (
    <div className="pagewrap fade-in">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-[#e6dccd] text-[18px] font-semibold text-[#6b5434]">T</span>
        <h1 className="ttl !m-0">Thomas</h1>
      </div>
      {ROWS.map((r) => (
        <Link key={r.href} href={r.href} className="hrow">
          <div className="tile" style={{ background: r.bg }}>{r.emoji}</div>
          <div className="tx"><b>{r.title}</b><span>{r.sub}</span></div>
          <ChevronRight size={18} className="text-faint" />
        </Link>
      ))}
      <form action={logout} className="mt-6"><button className="btn">Log out</button></form>
    </div>
  );
}

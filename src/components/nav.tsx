"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, FolderKanban, Lightbulb, ShieldCheck, RefreshCcw, Plus, Sparkles, Wallet, UserRound, Settings, Menu, Megaphone, Radar } from "lucide-react";

const items = [
  { href: "/", label: "Today", icon: CalendarCheck },
  { href: "/agent", label: "Assistant", phoneLabel: "Ask", icon: Sparkles },
  { href: "#add", label: "Add", icon: Plus, phoneOnly: true },
  { href: "/projects", label: "Projects", icon: FolderKanban, desktopOnly: true },
  { href: "/money", label: "Money", icon: Wallet, desktopOnly: true },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/supervise", label: "Supervise", icon: Radar, desktopOnly: true },
  { href: "/marketing", label: "Marketing", icon: Megaphone, desktopOnly: true },
  { href: "/inbox", label: "Ideas", icon: Lightbulb, desktopOnly: true },
  { href: "/review", label: "Weekly review", icon: RefreshCcw, desktopOnly: true },
  { href: "/me", label: "About you", icon: UserRound, desktopOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, desktopOnly: true },
  { href: "/more", label: "More", icon: Menu, phoneOnly: true },
];
const MORE = ["/more", "/projects", "/money", "/marketing", "/supervise", "/inbox", "/review", "/me", "/settings"];

export function Nav({ pending = 0 }: { pending?: number }) {
  const path = usePathname();
  if (path.startsWith("/login")) return null;
  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-line bg-bg2 px-3.5 py-5 md:flex">
        <Link href="/" className="mb-8 flex items-center gap-2.5 px-2 pt-1">
          <span className="h-[26px] w-[26px] rounded-[9px] bg-[conic-gradient(from_200deg,#38bdf8,#818cf8,#22d3ee,#38bdf8)] shadow-[0_0_22px_rgba(56,189,248,.45)]" />
          <span className="text-[15px] font-semibold tracking-tight">MyManager</span>
        </Link>
        <nav className="flex flex-col gap-0.5">
          {items.filter((i) => !i.phoneOnly).map((i) => {
            const on = active(i.href);
            return (
              <Link key={i.href} href={i.href}
                className={`group flex items-center gap-3 rounded-[9px] px-2.5 py-[9px] text-[13.5px] font-medium transition ${on ? "bg-panel2 text-text shadow-[inset_0_0_0_1px_#1d2029]" : "text-muted hover:bg-panel2/60 hover:text-text"}`}>
                <i.icon size={17} className={on ? "text-text" : "text-faint group-hover:text-muted"} />
                <span className="flex-1">{i.label}</span>
                {i.href === "/approvals" && pending > 0 && (
                  <span className="rounded-md bg-[rgba(251,191,36,.1)] px-[7px] py-px font-mono text-[11px] font-semibold text-warn">{pending}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={() => window.dispatchEvent(new Event("open-command"))}
          className="mt-6 flex items-center gap-2 rounded-[10px] border border-line bg-panel px-3 py-2 text-left text-[13px] text-muted transition hover:border-line2 hover:text-text">
          <Plus size={15} /> <span className="flex-1">Quick add</span><span className="kbd">Ctrl K</span>
        </button>
        <div className="mt-auto px-2 text-[11px] text-faint">Nothing risky happens without your OK</div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[rgba(9,10,14,.94)] backdrop-blur-xl md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="grid grid-cols-5">
          {items.filter((i) => !i.desktopOnly).map((i) => {
            if (i.href === "#add") return (
              <button key="add" type="button" onClick={() => window.dispatchEvent(new Event("open-command"))} aria-label="Quick add"
                className="flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium text-faint">
                <span className="-mt-[15px] grid h-10 w-11 place-items-center rounded-[13px] bg-text text-bg"><Plus size={21} strokeWidth={2.4} /></span>
                Add
              </button>
            );
            const on = i.href === "/more" ? MORE.some((m) => path.startsWith(m)) : active(i.href);
            return (
              <Link key={i.href} href={i.href} className={`relative flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium ${on ? "text-text" : "text-faint"}`}>
                {on && <span className="absolute top-0 h-[2px] w-8 rounded-full bg-accent2 shadow-[0_0_10px_var(--accent-2)]" />}
                <span className="relative">
                  <i.icon size={21} />
                  {i.href === "/approvals" && pending > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-warn px-1 text-[10px] font-bold text-black">{pending}</span>
                  )}
                </span>
                {i.phoneLabel ?? i.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

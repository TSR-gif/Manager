"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, FolderKanban, Lightbulb, ShieldCheck, RefreshCcw, Plus, Sparkles, Wallet, UserRound, Settings, Menu } from "lucide-react";

const items = [
  { href: "/", label: "Today", icon: CalendarCheck },
  { href: "/agent", label: "Assistant", phoneLabel: "Ask", icon: Sparkles },
  { href: "#add", label: "Add", icon: Plus, phoneOnly: true },
  { href: "/projects", label: "Projects", icon: FolderKanban, desktopOnly: true },
  { href: "/money", label: "Money", icon: Wallet, desktopOnly: true },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/inbox", label: "Ideas", icon: Lightbulb, desktopOnly: true },
  { href: "/review", label: "Weekly review", icon: RefreshCcw, desktopOnly: true },
  { href: "/me", label: "About you", icon: UserRound, desktopOnly: true },
  { href: "/settings", label: "Settings", icon: Settings, desktopOnly: true },
  { href: "/more", label: "More", icon: Menu, phoneOnly: true },
];
const MORE = ["/more", "/projects", "/money", "/inbox", "/review", "/me", "/settings"];

export function Nav({ pending = 0 }: { pending?: number }) {
  const path = usePathname();
  if (path.startsWith("/login")) return null;
  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-line bg-bg2/80 p-4 backdrop-blur-xl md:flex">
        <Link href="/" className="mb-8 flex items-center gap-2.5 px-2 pt-1">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-gradient-to-br from-[#9a8bff] to-[#5ec8ff] shadow-[0_6px_20px_-6px_rgba(139,123,255,.8)]">
            <span className="h-3 w-3 rounded-full border-[2.5px] border-white" />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">MyManager</span>
        </Link>
        <nav className="flex flex-col gap-0.5">
          {items.filter((i) => !i.phoneOnly).map((i) => {
            const on = active(i.href);
            return (
              <Link key={i.href} href={i.href}
                className={`group flex items-center gap-3 rounded-[10px] px-2.5 py-2 text-[14px] transition ${on ? "bg-panel3 text-text shadow-[inset_0_0_0_1px_var(--line-2)]" : "text-muted hover:bg-panel2 hover:text-text"}`}>
                <i.icon size={17} className={on ? "text-accent" : "text-faint group-hover:text-muted"} />
                <span className="flex-1">{i.label}</span>
                {i.href === "/approvals" && pending > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-white">{pending}</span>
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

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg2 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="grid grid-cols-5">
          {items.filter((i) => !i.desktopOnly).map((i) => {
            if (i.href === "#add") return (
              <button key="add" type="button" onClick={() => window.dispatchEvent(new Event("open-command"))} aria-label="Quick add"
                className="flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium text-faint">
                <span className="-mt-[15px] grid h-9 w-11 place-items-center rounded-xl bg-gradient-to-br from-[#9a8bff] to-[#7363ff] text-white shadow-[0_8px_20px_-8px_rgba(139,123,255,.9)]"><Plus size={20} /></span>
                Add
              </button>
            );
            const on = i.href === "/more" ? MORE.some((m) => path.startsWith(m)) : active(i.href);
            return (
              <Link key={i.href} href={i.href} className={`relative flex min-h-[60px] flex-col items-center justify-center gap-1 text-[11px] font-medium ${on ? "text-text" : "text-faint"}`}>
                {on && <span className="absolute top-0 h-[2px] w-8 rounded-full bg-accent" />}
                <span className="relative">
                  <i.icon size={21} className={on ? "text-accent" : ""} />
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

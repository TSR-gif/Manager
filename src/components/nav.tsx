"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, FolderKanban, Lightbulb, ShieldCheck, RefreshCcw, Command } from "lucide-react";

const items = [
  { href: "/", label: "Today", icon: CalendarCheck },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/inbox", label: "Ideas", icon: Lightbulb },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/review", label: "Review", icon: RefreshCcw },
];

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
          <span className="text-[15px] font-semibold tracking-tight">Manager</span>
        </Link>
        <div className="label mb-2 px-2">Workspace</div>
        <nav className="flex flex-col gap-0.5">
          {items.map((i) => {
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
          <Command size={14} /> <span className="flex-1">Quick capture</span><span className="kbd">Ctrl K</span>
        </button>
        <div className="mt-auto px-2 text-[11px] text-faint">Every action is logged · caps on</div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg2/85 backdrop-blur-xl md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="grid grid-cols-5">
          {items.map((i) => {
            const on = active(i.href);
            return (
              <Link key={i.href} href={i.href} className={`relative flex flex-col items-center gap-1 pb-2 pt-2.5 text-[10.5px] font-medium ${on ? "text-text" : "text-faint"}`}>
                {on && <span className="absolute top-0 h-[2px] w-8 rounded-full bg-accent" />}
                <span className="relative">
                  <i.icon size={21} className={on ? "text-accent" : ""} />
                  {i.href === "/approvals" && pending > 0 && (
                    <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">{pending}</span>
                  )}
                </span>
                {i.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, FolderKanban, Inbox, Lightbulb, Menu, Megaphone, Plus, RefreshCcw, Search, Settings2, Sparkles, UserRound, Wallet } from "lucide-react";
import { ProjectChip } from "./ui";

type Dot = { id: string; name: string; state: "needs" | "working" | "quiet" };

const MAIN = [
  { href: "/", label: "Today", icon: Inbox },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/agent", label: "Ask", icon: Sparkles },
];
/** Everything else, tucked away so the main list stays short. */
export const MORE_ITEMS = [
  { href: "/marketing", label: "Marketing", icon: Megaphone },
  { href: "/money", label: "Money", icon: Wallet },
  { href: "/inbox", label: "Ideas", icon: Lightbulb },
  { href: "/review", label: "Weekly review", icon: RefreshCcw },
  { href: "/me", label: "About you", icon: UserRound },
  { href: "/settings", label: "Settings", icon: Settings2 },
];
const MORE = ["/more", "/supervise", "/approvals", ...MORE_ITEMS.map((m) => m.href)];
const open = () => window.dispatchEvent(new Event("open-command"));

export function Nav({ pending = 0, dots = [] }: { pending?: number; dots?: Dot[] }) {
  const path = usePathname();
  if (path.startsWith("/login")) return null;
  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  const shown = dots.filter((d) => d.state !== "quiet");
  const quiet = dots.length - shown.length;
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[244px] flex-col px-2.5 pb-3 pt-2.5 md:flex">
        <div className="flex h-9 items-center gap-2 pl-2 pr-0.5">
          <span className="grid h-5 w-5 place-items-center rounded-[6px] bg-gradient-to-br from-[#f4f5f7] to-[#b9bcc4] text-[11px] font-bold text-[#0b0c0e]">M</span>
          <span className="text-[13px] font-semibold">MyManager</span>
          <span className="flex-1" />
          <button onClick={open} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-panel3" aria-label="Search"><Search size={16} strokeWidth={1.75} /></button>
          <button onClick={open} className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-panel3" aria-label="Add"><Plus size={16} strokeWidth={1.75} /></button>
        </div>
        <nav className="mt-2.5 flex flex-col gap-px">
          {MAIN.map((i) => {
            const on = active(i.href);
            return (
              <Link key={i.href} href={i.href} className={`flex h-[30px] items-center gap-2.5 rounded-md px-2 font-medium ${on ? "bg-panel3 text-text" : "text-muted hover:bg-panel2"}`}>
                <i.icon size={16} strokeWidth={1.75} className={on ? "text-text" : "text-faint"} />
                <span className="flex-1">{i.label}</span>
                {i.href === "/" && pending > 0 && <span className="text-[12px] text-faint">{pending}</span>}
                {i.href === "/agent" && <span className="kbd">Ctrl K</span>}
              </Link>
            );
          })}
        </nav>
        {dots.length > 0 && (
          <>
            <div className="mt-6 flex items-center gap-1.5 px-2 pb-1 text-[12px] font-medium text-faint"><ChevronDown size={13} />Dots</div>
            <div className="flex flex-col gap-px">
              {shown.map((d) => (
                <Link key={d.id} href={`/projects/${d.id}`} title={d.state === "needs" ? "Needs you" : "Working on something"}
                  className={`flex h-[30px] items-center gap-2.5 rounded-md px-2 font-medium ${path === `/projects/${d.id}` ? "bg-panel3 text-text" : "text-muted hover:bg-panel2"}`}>
                  <ProjectChip name={d.name} /><span className="min-w-0 flex-1 truncate">{d.name}</span>
                  <span className={`light ${d.state === "needs" ? "light-a" : "light-g"}`} />
                </Link>
              ))}
              {quiet > 0 && (
                <Link href="/projects" className="flex h-[30px] items-center gap-2.5 rounded-md px-2 font-medium text-faint hover:bg-panel2">
                  <span className="pi bg-panel2 text-faint">{quiet}</span><span className="flex-1">{quiet} quiet</span><span className="light light-q" />
                </Link>
              )}
            </div>
          </>
        )}
        <div className="mt-auto flex items-center gap-2 px-2 py-1.5 font-medium text-muted">
          <span className="grid h-5 w-5 place-items-center rounded-full bg-[#2c3e66] text-[10px] font-semibold text-[#c9d6ff]">T</span>Thomas
          <span className="flex-1" />
          <Link href="/more" className={`grid h-7 w-7 place-items-center rounded-md hover:bg-panel3 ${MORE.some((m) => path.startsWith(m)) ? "text-text" : "text-faint"}`} aria-label="More"><Settings2 size={16} strokeWidth={1.75} /></Link>
        </div>
      </aside>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-[var(--nav-bg)] backdrop-blur-xl md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="grid grid-cols-5">
          {[...MAIN.slice(0, 2), { href: "#add", label: "Add", icon: Plus }, MAIN[2], { href: "/more", label: "More", icon: Menu }].map((i) => {
            if (i.href === "#add") return (
              <button key="add" type="button" onClick={open} aria-label="Add" className="flex min-h-[58px] flex-col items-center justify-center gap-1 text-[11px] font-medium text-faint">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-white"><Plus size={18} strokeWidth={2.2} /></span>
              </button>
            );
            const on = i.href === "/more" ? MORE.some((m) => path.startsWith(m)) : active(i.href);
            return (
              <Link key={i.href} href={i.href} className={`relative flex min-h-[58px] flex-col items-center justify-center gap-1 text-[11px] font-medium ${on ? "text-text" : "text-faint"}`}>
                <span className="relative">
                  <i.icon size={21} strokeWidth={1.75} />
                  {i.href === "/" && pending > 0 && <span className="absolute -right-2 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-warn px-1 text-[10px] font-bold text-black">{pending}</span>}
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

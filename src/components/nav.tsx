"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calendar, LayoutGrid, MessageCircle, MoreHorizontal, Plus, Search, SquarePen } from "lucide-react";

export type HelperItem = { id: string; name: string; emoji: string; bg: string; need: number; working: boolean };

/** The menu under Thomas's name (and the command bar's page list). */
export const MORE_ITEMS = [
  { href: "/review", label: "Weekly review" },
  { href: "/me", label: "About you" },
  { href: "/settings", label: "Settings" },
  { href: "/supervise", label: "Everything I'm working on" },
  { href: "/approvals", label: "Approvals and history" },
];
const OTHER = [
  { href: "/money", name: "Money", emoji: "💰", bg: "#e7f5ec", key: "money" as const },
  { href: "/marketing", name: "Marketing", emoji: "📣", bg: "#fdeee6", key: null },
  { href: "/inbox", name: "Ideas", emoji: "💡", bg: "#fff7d1", key: "ideas" as const },
  { href: "/servers", name: "Servers", emoji: "🖧", bg: "#eef0f3", key: null },
];
const open = () => window.dispatchEvent(new Event("open-command"));

export function Nav({ pending = 0, helpers = [], other = { money: "", ideas: "" } }: { pending?: number; helpers?: HelperItem[]; other?: { money: string; ideas: string } }) {
  const path = usePathname();
  if (path.startsWith("/login")) return null;
  const on = (h: string) => (h === "/" ? path === "/" : path === h || path.startsWith(h + "/"));
  const helpersOn = path.startsWith("/helpers") || path.startsWith("/projects") || OTHER.some((o) => on(o.href));
  return (
    <>
      <aside className="side">
        <div className="brand">
          <b>MyManager</b>
          <Link href="/agent" className="iconbtn" aria-label="New chat" title="New chat"><SquarePen size={18} strokeWidth={1.7} /></Link>
        </div>
        <Link href="/" className={`item ${on("/") ? "on" : ""}`}><MessageCircle size={18} strokeWidth={1.7} />Dashboard{pending > 0 && <span className="badge">{pending}</span>}</Link>
        <Link href="/calendar" className={`item ${on("/calendar") ? "on" : ""}`}><Calendar size={18} strokeWidth={1.7} />Calendar</Link>
        <button type="button" onClick={open} className="item w-full text-left"><Search size={18} strokeWidth={1.7} />Search</button>

        <div className="lbl">Helpers</div>
        {helpers.map((h) => (
          <Link key={h.id} href={`/projects/${h.id}`} className={`item ${path.startsWith(`/projects/${h.id}`) ? "on" : ""}`}>
            <span className="av" style={{ background: h.bg }}>{h.emoji}</span>
            <span className="min-w-0 truncate">{h.name}</span>
            {h.need > 0 ? <span className="badge">{h.need}</span> : h.working ? <span className="sub">working</span> : null}
          </Link>
        ))}
        <Link href="/projects/new" className="item" style={{ color: "var(--muted)" }}><Plus size={18} strokeWidth={1.7} />New helper</Link>

        <div className="lbl">Everything else</div>
        {OTHER.map((o) => (
          <Link key={o.href} href={o.href} className={`item ${on(o.href) ? "on" : ""}`}>
            <span className="av" style={{ background: o.bg }}>{o.emoji}</span>{o.name}
            {o.key && other[o.key] && <span className="sub">{other[o.key]}</span>}
          </Link>
        ))}

        <Link href="/more" className={`me ${on("/more") || MORE_ITEMS.some((m) => on(m.href)) ? "bg-[#efefed]" : ""}`}>
          <span className="p">T</span>Thomas<MoreHorizontal size={18} className="ml-auto text-faint" />
        </Link>
      </aside>

      <nav className="ptabs" aria-label="Main">
        <Link href="/" className={on("/") ? "on" : ""}><MessageCircle size={23} strokeWidth={1.7} />Dashboard{pending > 0 && <span className="badge">{pending}</span>}</Link>
        <Link href="/helpers" className={helpersOn ? "on" : ""}><LayoutGrid size={23} strokeWidth={1.7} />Helpers</Link>
        <Link href="/calendar" className={on("/calendar") ? "on" : ""}><Calendar size={23} strokeWidth={1.7} />Calendar</Link>
      </nav>
    </>
  );
}

/** The bar along the top of each screen: a title (or a back link) on the left, calendar and menu on the right. */
export function Head({ title, back, phoneTitle, right }: { title?: string; back?: { href: string; label: string }; phoneTitle?: string; right?: React.ReactNode }) {
  return (
    <div className="head">
      {back ? (
        <Link href={back.href} className="flex items-center gap-1.5 text-muted hover:text-text">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          {back.label}
        </Link>
      ) : (
        <span><span className="hidden md:inline">{title}</span><span className="md:hidden">{phoneTitle ?? title}</span></span>
      )}
      <div className="r">
        {right}
        <Link href="/calendar" className="iconbtn" aria-label="Calendar"><Calendar size={18} strokeWidth={1.7} /></Link>
        <Link href="/more" className="iconbtn" aria-label="More"><MoreHorizontal size={18} strokeWidth={1.7} /></Link>
      </div>
    </div>
  );
}

const TITLES: [string, string][] = [
  ["/money", "Money"], ["/marketing", "Marketing"], ["/inbox", "Ideas"], ["/review", "Weekly review"], ["/me", "About you"],
  ["/settings", "Settings"], ["/more", "Thomas"], ["/supervise", "Working on"], ["/approvals", "Approvals"], ["/agent", "Ask"],
];
/** Screens that don't draw their own top bar get this one. */
export function DefaultHead() {
  const path = usePathname();
  const t = TITLES.find(([h]) => path === h || path.startsWith(h + "/"));
  if (!t) return null;
  const back = ["/review", "/me", "/settings", "/supervise", "/approvals"].includes(t[0]) ? { href: "/more", label: "Thomas" } : undefined;
  return <Head title={t[1]} back={back} />;
}

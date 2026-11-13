"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Today", icon: "◎" },
  { href: "/projects", label: "Projects", icon: "▦" },
  { href: "/inbox", label: "Ideas", icon: "✦" },
  { href: "/approvals", label: "Approvals", icon: "✓" },
  { href: "/review", label: "Review", icon: "↻" },
];

export function Nav() {
  const path = usePathname();
  if (path.startsWith("/login")) return null;
  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  return (
    <>
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-52 flex-col gap-1 border-r border-line bg-panel p-4">
        <div className="mb-6 text-lg font-bold tracking-tight">Manager</div>
        {items.map((i) => (
          <Link key={i.href} href={i.href}
            className={`rounded-lg px-3 py-2 text-sm ${active(i.href) ? "bg-panel2 text-text" : "text-muted hover:text-text"}`}>
            <span className="mr-2">{i.icon}</span>{i.label}
          </Link>
        ))}
      </aside>
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 grid grid-cols-5 border-t border-line bg-panel/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        {items.map((i) => (
          <Link key={i.href} href={i.href}
            className={`flex flex-col items-center py-2 text-[11px] ${active(i.href) ? "text-accent" : "text-muted"}`}>
            <span className="text-lg leading-none">{i.icon}</span>{i.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

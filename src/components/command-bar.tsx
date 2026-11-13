"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowRight, CalendarCheck, FolderKanban, Hash, Lightbulb, ListTodo, Radar, ShieldCheck, Sparkles } from "lucide-react";
import { quickCapture } from "@/app/actions";
import { MORE_ITEMS } from "@/components/nav";

type Option = { id: string; label: string; hint?: string; icon: React.ComponentType<{ size?: number; className?: string }>; run: () => void };

const PAGES = [
  { href: "/", label: "Today", icon: CalendarCheck },
  { href: "/agent", label: "Assistant", icon: Sparkles },
  { href: "/helpers", label: "Helpers", icon: FolderKanban },
  { href: "/calendar", label: "Calendar", icon: CalendarCheck },
  { href: "/money", label: "Money", icon: Sparkles },
  { href: "/marketing", label: "Marketing", icon: Sparkles },
  { href: "/inbox", label: "Ideas", icon: Lightbulb },
  { href: "/servers", label: "Servers", icon: Radar },
  ...MORE_ITEMS.map((m) => ({ ...m, icon: m.href === "/approvals" ? ShieldCheck : m.href === "/supervise" ? Radar : Sparkles })),
];

/** Ctrl/Cmd+K anywhere (or + on the phone): jump to a screen or project, ask the assistant, or add a task or idea. */
export function CommandBar({ projects = [] }: { projects?: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sel, setSel] = useState(0);
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const path = usePathname();
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("open-command", onOpen); };
  }, []);
  useEffect(() => { if (open) { setText(""); setSel(0); setTimeout(() => ref.current?.focus(), 10); } }, [open]);

  const capture = (value: string, msg: string) => {
    const fd = new FormData();
    fd.set("text", value);
    start(async () => {
      await quickCapture(fd);
      setFlash(msg);
      setOpen(false);
      setTimeout(() => setFlash(null), 2200);
    });
  };
  const go = (href: string) => { setOpen(false); router.push(href); };

  const options = useMemo<Option[]>(() => {
    const q = text.trim().toLowerCase();
    const out: Option[] = [];
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    if (q) {
      out.push({ id: "ask", label: `Ask MyManager: “${text.trim()}”`, icon: Sparkles, run: () => go(`/agent?ask=${encodeURIComponent(text.trim())}`) });
      if (/^idea[:\s]/i.test(text)) out.push({ id: "idea", label: "Save as an idea", icon: Lightbulb, run: () => capture(text, "Idea saved") });
      else if (/^#\S+/.test(text)) out.push({ id: "ptask", label: "Add as a task on that project", icon: Hash, run: () => capture(text, "Task added to project") });
      else out.push({ id: "task", label: "Add as a task", hint: "Everyday", icon: ListTodo, run: () => capture(text, "Task added") });
    }
    for (const p of projects.filter((x) => q && match(x.name)).slice(0, 4)) out.push({ id: `p-${p.id}`, label: p.name, hint: "Helper", icon: FolderKanban, run: () => go(`/projects/${p.id}`) });
    for (const p of PAGES.filter((x) => match(x.label))) out.push({ id: p.href, label: p.label, hint: "Go to", icon: p.icon, run: () => go(p.href) });
    // a name that matches a screen or project goes there first; otherwise asking is the default
    if (q && out.length > 2 && (out[2].hint === "Helper" || out[2].hint === "Go to") && out[2].label.toLowerCase().startsWith(q)) out.unshift(out.splice(2, 1)[0]);
    return out.slice(0, 9);
  }, [text, projects]); // eslint-disable-line react-hooks/exhaustive-deps

  if (path.startsWith("/login")) return null;

  return (
    <>
      {flash && (
        <div className="fade-in fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full border border-line2 bg-panel3 px-4 py-2 text-sm shadow-xl">{flash}</div>
      )}

      {open && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="fade-in w-full max-w-xl overflow-hidden rounded-2xl border border-line2 bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <input
              ref={ref} value={text}
              onChange={(e) => { setText(e.target.value); setSel(0); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setSel((i) => Math.min(i + 1, options.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
                if (e.key === "Enter" && options[sel] && !pending) { e.preventDefault(); options[sel].run(); }
              }}
              placeholder="Go to, ask, or add a task…"
              className="!rounded-none !border-0 !border-b !border-line !bg-transparent !px-4 !py-4 !text-[17px] !shadow-none"
            />
            <ul className="max-h-[50vh] overflow-auto p-1.5">
              {options.map((o, i) => (
                <li key={o.id}>
                  <button type="button" onMouseEnter={() => setSel(i)} onClick={() => o.run()}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[14px] ${i === sel ? "bg-panel3 text-text" : "text-muted"}`}>
                    <o.icon size={16} className={i === sel ? "text-accent2" : "text-faint"} />
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && <span className="text-[12px] text-faint">{o.hint}</span>}
                    {i === sel && <ArrowRight size={14} className="text-faint" />}
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-4 py-2 text-[12px] text-faint">Start with <b className="text-muted">idea:</b> to save an idea, or <b className="text-muted">#project</b> to add a task to a project.</div>
          </div>
        </div>
      )}
    </>
  );
}

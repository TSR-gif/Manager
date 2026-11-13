"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { CornerDownLeft, Hash, Lightbulb, ListTodo, Plus } from "lucide-react";
import { quickCapture } from "@/app/actions";

/** Ctrl/Cmd+K anywhere (or the + button on phone) to capture a task or idea. */
export function CommandBar() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [flash, setFlash] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const path = usePathname();

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
  useEffect(() => { if (open) setTimeout(() => ref.current?.focus(), 10); }, [open]);

  if (path.startsWith("/login")) return null;

  const kind = /^idea[:\s]/i.test(text) ? "idea" : /^#\S+/.test(text) ? "project" : "task";
  const submit = () => {
    if (!text.trim()) return;
    const fd = new FormData();
    fd.set("text", text);
    start(async () => {
      await quickCapture(fd);
      setFlash(kind === "idea" ? "Idea saved to inbox" : kind === "project" ? "Task added to project" : "Added to Everyday");
      setText("");
      setOpen(false);
      setTimeout(() => setFlash(null), 2200);
    });
  };

  return (
    <>
      {!path.startsWith("/agent") && <button
        onClick={() => setOpen(true)}
        aria-label="Quick capture"
        className="fixed right-4 z-30 grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-[#9a8bff] to-[#7363ff] text-white shadow-[0_12px_30px_-8px_rgba(139,123,255,.8)] active:scale-95 md:hidden"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 76px)" }}>
        <Plus size={22} />
      </button>}

      {flash && (
        <div className="fade-in fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full border border-line2 bg-panel3 px-4 py-2 text-sm shadow-xl">
          {flash}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/60 px-4 pt-[14vh] backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="fade-in w-full max-w-xl overflow-hidden rounded-2xl border border-line2 bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b border-line px-4">
              {kind === "idea" ? <Lightbulb size={18} className="text-warn" /> : kind === "project" ? <Hash size={18} className="text-accent2" /> : <ListTodo size={18} className="text-accent" />}
              <input
                ref={ref} value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="What's on your mind?"
                className="!border-0 !bg-transparent !px-0 !py-4 !text-[17px] !shadow-none"
              />
              <button onClick={submit} disabled={pending} className="btn btn-primary btn-sm">
                {pending ? "Saving…" : <>Add <CornerDownLeft size={13} /></>}
              </button>
            </div>
            <div className="grid gap-1 p-3 text-[13px] text-muted">
              <div className="flex items-center gap-2"><ListTodo size={14} /> <span>Plain text</span><span className="text-faint">→ everyday task</span></div>
              <div className="flex items-center gap-2"><Hash size={14} /> <span><b className="text-text">#rewards</b> fix login</span><span className="text-faint">→ task on a project</span></div>
              <div className="flex items-center gap-2"><Lightbulb size={14} /> <span><b className="text-text">idea:</b> sneaker price bot</span><span className="text-faint">→ idea inbox</span></div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

"use client";
import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, History, Maximize2, Plus, X } from "lucide-react";
import { openChat, recentChats, type ChatSummary } from "@/app/actions";
import type { AgentEvent } from "@/lib/agent/run";
import { AgentConsole } from "./agent-console";
import { Orb } from "./orb";
import { ago } from "./ui";

/** What a page's ask box sends. The bubble answers it in place; with no bubble, the ask box goes to the chat page instead. */
export const ASK_EVENT = "mymanager:ask";
export type AskDetail = { text: string; voice?: boolean };

/**
 * The assistant on every page: a bubble in the corner that opens the chat over whatever he's looking at.
 * The conversation carries on as he moves between pages. Earlier chats can be opened and carried on from here,
 * and "Open full chat" continues the current one on the chat page.
 */
export function AssistantBubble({ name = "MyManager" }: { name?: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [chat, setChat] = useState(0); // bump for a new conversation
  const [runId, setRunId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const [incoming, setIncoming] = useState<{ text: string; voice?: boolean; n: number }>();
  const [loaded, setLoaded] = useState<{ id: string; goal: string; running: boolean; events: AgentEvent[] }>();
  const [list, setList] = useState<ChatSummary[] | null>(null); // null = showing the chat, not the list
  const [pending, start] = useTransition();
  const hidden = path === "/" || path === "/agent" || path.startsWith("/login"); // the Dashboard and the chat page answer in place

  // page ask boxes and quick buttons come here instead of leaving the page
  useEffect(() => {
    if (hidden) return;
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<AskDetail>).detail;
      if (!d?.text?.trim()) return;
      e.preventDefault();
      setOpen(true);
      setIncoming((p) => ({ text: d.text, voice: d.voice, n: (p?.n ?? 0) + 1 }));
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, [hidden]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (hidden) return null;
  const fresh = () => { setChat((c) => c + 1); setRunId(undefined); setIncoming(undefined); setLoaded(undefined); setList(null); };
  const showList = () => start(async () => setList(await recentChats()));
  const pick = (id: string) => start(async () => {
    const c = await openChat(id);
    if (!c) return;
    setLoaded(c); setRunId(c.id); setIncoming(undefined); setChat((n) => n + 1); setList(null);
  });

  return (
    <>
      {/* kept mounted while closed, so a reply still arrives if he closes it mid-answer */}
      <section className={`abox ${open ? "on" : ""}`} aria-label={`Chat with ${name}`} aria-hidden={!open}>
        <header>
          <Orb size={22} state={busy ? "working" : "idle"} />
          {list ? <button type="button" className="iconbtn" aria-label="Back to the chat" title="Back" onClick={() => setList(null)}><ChevronLeft size={18} /></button> : null}
          <b>{list ? "Earlier chats" : name}</b>
          <span className="sp" />
          {runId && <Link href={`/agent?run=${runId}`} className="iconbtn" title="Open full chat" aria-label="Open full chat" onClick={() => setOpen(false)}><Maximize2 size={16} /></Link>}
          {!list && <button type="button" className="iconbtn" title="Earlier chats" aria-label="Earlier chats" onClick={showList} disabled={busy || pending}><History size={17} /></button>}
          <button type="button" className="iconbtn" title="New chat" aria-label="New chat" onClick={fresh} disabled={busy}><Plus size={18} /></button>
          <button type="button" className="iconbtn" title="Close" aria-label="Close" onClick={() => setOpen(false)}><X size={18} /></button>
        </header>
        {list && (
          <ul className="alist">
            {list.length === 0 && <li className="none">No chats yet.</li>}
            {list.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => pick(c.id)} disabled={pending} className={c.id === runId ? "cur" : ""}>
                  <b className={c.unread ? "unread" : ""}>{c.title}</b>
                  <span>{c.status === "running" ? "working… · " : c.status === "failed" ? "didn't finish · " : c.status === "stopped" ? "stopped · " : ""}{ago(c.created_at)}</span>
                </button>
              </li>
            ))}
            <li><Link href="/agent" className="all" onClick={() => setOpen(false)}>Open the chat page</Link></li>
          </ul>
        )}
        <div className="abody" hidden={!!list}>
          {(open || runId) && (
            <AgentConsole key={chat} embedded name={name} incoming={incoming}
              initialEvents={loaded?.events ?? []} runId={loaded?.id} goal={loaded?.goal} running={loaded?.running}
              onRun={setRunId} onBusy={setBusy} onAnswer={() => setUnseen((u) => u || !document.querySelector(".abox.on"))} />
          )}
        </div>
      </section>
      {!open && (
        <button type="button" className="abub" onClick={() => { setOpen(true); setUnseen(false); }} aria-label={`Ask ${name}`} title={`Ask ${name}`}>
          <Orb size={30} state={busy ? "working" : "idle"} />
          {unseen && <span className="dot" aria-label="New answer" />}
        </button>
      )}
    </>
  );
}

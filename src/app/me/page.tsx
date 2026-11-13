import { Bot, Brain, Plus, Trash2, User } from "lucide-react";
import { addMemory, deleteMemory } from "@/app/actions";
import { db } from "@/lib/db";
import { ago } from "@/components/ui";

export const dynamic = "force-dynamic";

const CATS: [string, string][] = [
  ["preference", "How you like things done"], ["work", "Work and projects"], ["routine", "Routines"],
  ["person", "People"], ["money", "Money"], ["general", "General"],
];

interface Memory { id: string; fact: string; category: string; source: string; created_at: string }

export default async function MePage() {
  const { data } = await db().from("memories").select("*").order("created_at", { ascending: false });
  const memories = (data ?? []) as Memory[];
  const { data: s } = await db().from("settings").select("assistant_name").eq("id", 1).single();
  const name = (s?.assistant_name as string) || "MyManager";

  return (
    <div className="fade-in space-y-6">
      <header>
        <h1 className="display text-[26px] md:text-[30px]">What {name} knows about you</h1>
        <p className="mt-1 max-w-2xl text-[14px] text-muted">
          Everything here is given to the assistant every time it works for you. Add anything that helps it decide like you would. Delete anything that&apos;s wrong. It can add facts too when you tell it something worth remembering, and they show up here.
        </p>
      </header>

      <form action={addMemory} className="card flex flex-wrap items-end gap-2">
        <label className="min-w-[14rem] flex-1 space-y-1"><span className="label">Tell it something</span>
          <input name="fact" placeholder="e.g. I train Mon/Wed/Fri at 6am, don't book anything then" required maxLength={500} />
        </label>
        <label className="w-48 space-y-1"><span className="label">About</span>
          <select name="category" defaultValue="general">{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <button className="btn btn-primary"><Plus size={15} /> Remember</button>
      </form>

      <div className="grid gap-4 md:grid-cols-2">
        {CATS.map(([cat, label]) => {
          const list = memories.filter((m) => m.category === cat);
          if (!list.length) return null;
          return (
            <section key={cat} className="card">
              <div className="mb-2 flex items-center gap-2"><Brain size={15} className="text-accent" /><span className="font-semibold">{label}</span><span className="text-[12px] text-faint">{list.length}</span></div>
              <ul className="divide-y divide-line">
                {list.map((m) => (
                  <li key={m.id} className="group flex items-start gap-2.5 py-2.5 text-[14px]">
                    <span className="mt-0.5 text-faint" title={m.source === "assistant" ? `Learned by ${name}` : "Added by you"}>{m.source === "assistant" ? <Bot size={14} /> : <User size={14} />}</span>
                    <span className="flex-1 leading-relaxed">{m.fact}</span>
                    <span className="hidden text-[11.5px] text-faint sm:inline">{ago(m.created_at)}</span>
                    <form action={deleteMemory}>
                      <input type="hidden" name="id" value={m.id} />
                      <button className="text-faint opacity-60 transition hover:text-bad group-hover:opacity-100" aria-label="Forget this"><Trash2 size={14} /></button>
                    </form>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {memories.length === 0 && <p className="text-[14px] text-muted">Nothing yet.</p>}
    </div>
  );
}

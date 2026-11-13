import { Archive, FolderPlus, Lightbulb, Trash2 } from "lucide-react";
import { addIdea, triageIdea } from "@/app/actions";
import { getIdeas } from "@/lib/queries";
import { Empty, ago } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Inbox() {
  const ideas = await getIdeas();
  const inbox = ideas.filter((i) => i.status === "inbox");
  const parked = ideas.filter((i) => i.status === "parked");
  const killed = ideas.filter((i) => i.status === "killed").length;
  const promoted = ideas.filter((i) => i.status === "promoted").length;

  return (
    <div className="fade-in space-y-7">
      <header>
        <h1 className="text-[28px] font-semibold tracking-tight">Ideas</h1>
        <p className="mt-1 max-w-xl text-[14px] text-muted">Get ideas out of your head so they stop pulling you off what matters. Each one gets a decision: make it a project, park it, or kill it.</p>
      </header>

      <form action={addIdea} className="hero flex gap-2 !p-3">
        <input name="text" placeholder="New idea…" autoComplete="off" required className="!bg-bg2/60" />
        <button className="btn btn-primary">Capture</button>
      </form>

      <div className="flex gap-2 text-[12.5px]">
        <span className="chip chip-accent">{inbox.length} to triage</span>
        <span className="chip">{parked.length} parked</span>
        <span className="chip chip-good">{promoted} promoted</span>
        <span className="chip">{killed} killed</span>
      </div>

      <section>
        {inbox.length === 0 && <div className="card"><Empty icon={<Lightbulb size={18} />} title="Inbox zero" hint="Nice. Capture new ideas any time with Ctrl K." /></div>}
        <ul className="grid gap-3 md:grid-cols-2">
          {inbox.map((i) => (
            <li key={i.id} className="card flex flex-col">
              <div className="flex items-start gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[rgba(255,200,87,.1)] text-warn"><Lightbulb size={16} /></div>
                <div className="flex-1 text-[15px] leading-snug">{i.text}</div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <span className="mr-auto text-[12px] text-faint">{ago(i.created_at)}</span>
                <form action={triageIdea.bind(null, i.id, "promote")}><button className="btn btn-good btn-sm"><FolderPlus size={13} /> Project</button></form>
                <form action={triageIdea.bind(null, i.id, "park")}><button className="btn btn-sm"><Archive size={13} /> Park</button></form>
                <form action={triageIdea.bind(null, i.id, "kill")}><button className="btn btn-bad btn-sm"><Trash2 size={13} /> Kill</button></form>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {parked.length > 0 && (
        <section className="card">
          <div className="mb-2 font-semibold">Parked</div>
          <ul className="divide-y divide-line">
            {parked.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2 text-[14px]">
                <span className="flex-1 text-muted">{i.text}</span>
                <form action={triageIdea.bind(null, i.id, "promote")}><button className="btn btn-ghost btn-sm">Make project</button></form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

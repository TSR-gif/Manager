import { addIdea, triageIdea } from "@/app/actions";
import { getIdeas } from "@/lib/queries";
import { ago } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Inbox() {
  const ideas = await getIdeas();
  const inbox = ideas.filter((i) => i.status === "inbox");
  const parked = ideas.filter((i) => i.status === "parked");

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Ideas</h1>
      <p className="text-sm text-muted">Dump ideas here so they stop pulling at your focus. Every idea gets a decision: make it a project, park it for later, or kill it.</p>
      <form action={addIdea} className="flex gap-2">
        <input name="text" placeholder="New idea…" autoComplete="off" required />
        <button className="btn btn-primary">Add</button>
      </form>

      <section>
        <div className="label mb-2">To triage · {inbox.length}</div>
        <ul className="space-y-2">
          {inbox.map((i) => (
            <li key={i.id} className="card">
              <div>{i.text}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted mr-auto">{ago(i.created_at)}</span>
                <form action={triageIdea.bind(null, i.id, "promote")}><button className="btn btn-good">Make project</button></form>
                <form action={triageIdea.bind(null, i.id, "park")}><button className="btn">Park</button></form>
                <form action={triageIdea.bind(null, i.id, "kill")}><button className="btn btn-bad">Kill</button></form>
              </div>
            </li>
          ))}
          {inbox.length === 0 && <li className="text-sm text-muted">Inbox zero.</li>}
        </ul>
      </section>

      {parked.length > 0 && (
        <section>
          <div className="label mb-2">Parked · {parked.length}</div>
          <ul className="space-y-1">
            {parked.map((i) => (
              <li key={i.id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 text-muted">{i.text}</span>
                <form action={triageIdea.bind(null, i.id, "promote")}><button className="text-xs text-accent">promote</button></form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

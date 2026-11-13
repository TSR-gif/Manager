import { login } from "@/app/actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="mx-auto mt-24 max-w-sm md:-ml-0">
      <form action={login} className="card space-y-3">
        <h1 className="text-xl font-bold">Manager</h1>
        <input type="hidden" name="next" value={next ?? "/"} />
        <input type="password" name="password" placeholder="Password" autoFocus required />
        {error && <div className="text-sm text-red-400">Wrong password.</div>}
        <button className="btn btn-primary w-full">Unlock</button>
      </form>
    </div>
  );
}

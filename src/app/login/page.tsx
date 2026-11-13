import { Lock } from "lucide-react";
import { login } from "@/app/actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <div className="grid min-h-[80dvh] place-items-center md:-ml-[13rem]">
      <form action={login} className="hero fade-in w-full max-w-sm space-y-4 !p-7">
        <div className="flex flex-col items-center gap-3 pb-2 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#38bdf8] to-[#818cf8] shadow-[0_12px_30px_-8px_rgba(56,189,248,.8)]">
            <span className="h-5 w-5 rounded-full border-[3.5px] border-white" />
          </span>
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">MyManager</h1>
            <p className="text-[13px] text-muted">Your command centre</p>
          </div>
        </div>
        <input type="hidden" name="next" value={next ?? "/"} />
        <input type="password" name="password" placeholder="Password" autoFocus required />
        {error && <div className="text-[13px] text-bad">That password didn&apos;t match.</div>}
        <button className="btn btn-primary w-full !py-3"><Lock size={15} /> Unlock</button>
      </form>
    </div>
  );
}

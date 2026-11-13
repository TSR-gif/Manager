import { MessageCircle, Megaphone } from "lucide-react";
import { CopyButton } from "./copy-button";

interface Slide { heading: string; body: string; photo?: string | null }
export interface SocialPayload {
  channel?: string; caption?: string; hashtags?: string[]; slides?: Slide[]; reply_to?: string | null; post_at?: string | null; sources?: string | null;
}

const CHANNEL: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook", "tiktok+instagram": "TikTok + Instagram", reply: "Reply" };
const TONES = ["from-[#7c6cff] to-[#4b3fd6]", "from-[#2bb3a3] to-[#1f6f8b]", "from-[#ff8a5b] to-[#d6456b]", "from-[#4aa3ff] to-[#3554d1]"];

/** Phone-style preview of a drafted post: swipeable slides, caption and hashtags. */
export function SocialPreview({ p, compact = false }: { p: SocialPayload; compact?: boolean }) {
  const tags = (p.hashtags ?? []).map((t) => (t.startsWith("#") ? t : `#${t}`)).join(" ");
  if (p.channel === "reply") {
    return (
      <div className="space-y-2 text-[13.5px]">
        {p.reply_to && <div className="rounded-xl bg-panel3 px-3 py-2 text-muted"><MessageCircle size={12} className="mr-1 inline" />{p.reply_to}</div>}
        <div className="ml-6 rounded-xl border border-line px-3 py-2">{p.caption}</div>
        {!compact && <CopyButton text={p.caption ?? ""} label="Copy reply" />}
      </div>
    );
  }
  const slides = p.slides ?? [];
  return (
    <div className="space-y-2.5">
      {slides.length > 0 && (
        <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
          {(compact ? slides.slice(0, 3) : slides).map((s, i) => (
            <div key={i} className={`relative flex aspect-[9/16] w-[118px] shrink-0 snap-start flex-col justify-between rounded-xl bg-gradient-to-br p-2.5 text-white shadow-lg ${TONES[i % TONES.length]}`}>
              <div className="text-[9px] font-semibold uppercase tracking-wide opacity-80">{i + 1}/{slides.length}</div>
              <div>
                <div className="text-[12.5px] font-bold leading-tight">{s.heading}</div>
                <div className="mt-1 text-[11px] leading-snug opacity-95">{s.body}</div>
              </div>
              {s.photo ? <div className="truncate rounded bg-black/25 px-1.5 py-0.5 text-[9px]">📷 {s.photo}</div> : <span />}
            </div>
          ))}
          {compact && slides.length > 3 && <div className="grid w-12 shrink-0 place-items-center text-[12px] text-muted">+{slides.length - 3}</div>}
        </div>
      )}
      {p.caption && <div className={`whitespace-pre-wrap text-[13.5px] ${compact ? "line-clamp-2" : ""}`}>{p.caption}</div>}
      {tags && <div className="text-[12.5px] text-accent">{tags}</div>}
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-faint">
        <span className="chip"><Megaphone size={11} /> {CHANNEL[p.channel ?? ""] ?? p.channel}</span>
        {p.post_at && <span>Suggested: {p.post_at}</span>}
        {p.sources && !compact && <span>Numbers from: {p.sources}</span>}
      </div>
      {!compact && <CopyButton text={`${p.caption ?? ""}\n\n${tags}`.trim()} label="Copy caption" />}
    </div>
  );
}

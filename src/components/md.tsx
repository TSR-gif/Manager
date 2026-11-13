import { Fragment } from "react";

/** Tiny, safe markdown: paragraphs, - / 1. lists, **bold**, `code`, [links](https://…). No HTML passthrough. */
function inline(text: string, key = 0): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<b key={`${key}-${i++}`} className="font-semibold text-text">{t.slice(2, -2)}</b>);
    else if (t.startsWith("`")) out.push(<code key={`${key}-${i++}`} className="rounded bg-panel3 px-1 text-[0.92em]">{t.slice(1, -1)}</code>);
    else {
      const [, label, href] = t.match(/\[([^\]]+)\]\(([^)]+)\)/)!;
      out.push(<a key={`${key}-${i++}`} href={href} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">{label}</a>);
    }
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Md({ text, className = "" }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className={`space-y-2.5 ${className}`}>
      {blocks.map((b, bi) => {
        const lines = b.split("\n");
        const isUl = lines.every((l) => /^\s*[-*•]\s+/.test(l));
        const isOl = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
        if (isUl || isOl) {
          const Tag = isOl ? "ol" : "ul";
          return (
            <Tag key={bi} className={`space-y-1 pl-5 ${isOl ? "list-decimal" : "list-disc"} marker:text-faint`}>
              {lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""), li)}</li>)}
            </Tag>
          );
        }
        const h = b.match(/^#{1,4}\s+(.*)$/);
        if (h && lines.length === 1) return <div key={bi} className="font-semibold">{inline(h[1])}</div>;
        return <p key={bi}>{lines.map((l, li) => <Fragment key={li}>{li > 0 && <br />}{inline(l.replace(/^#{1,4}\s+/, ""), li)}</Fragment>)}</p>;
      })}
    </div>
  );
}

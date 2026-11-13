"use client";
export function OpenCommandButton({ children, className }: { children: React.ReactNode; className?: string }) {
  return <button type="button" className={className} onClick={() => window.dispatchEvent(new Event("open-command"))}>{children}</button>;
}

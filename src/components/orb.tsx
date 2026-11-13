/** The assistant's face: a live orb that breathes when idle and spins while it thinks or works. */
export function Orb({ size = 36, state = "idle" }: { size?: number; state?: "idle" | "thinking" | "working" | "done" }) {
  return <span className="orb" data-state={state} style={{ width: size, height: size }} aria-hidden />;
}

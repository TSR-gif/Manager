"use client";
/** Read text aloud with the browser's built-in voice (Australian English when available). */
export function speak(text: string, onEnd?: () => void) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  const plain = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .trim();
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(plain);
  const voices = window.speechSynthesis.getVoices();
  const v = voices.find((x) => x.lang === "en-AU") ?? voices.find((x) => x.lang?.startsWith("en"));
  if (v) u.voice = v;
  u.lang = v?.lang ?? "en-AU";
  u.rate = 1.03;
  u.onend = () => onEnd?.();
  u.onerror = () => onEnd?.();
  window.speechSynthesis.speak(u);
  return true;
}
export const stopSpeaking = () => { if (typeof window !== "undefined") window.speechSynthesis?.cancel(); };

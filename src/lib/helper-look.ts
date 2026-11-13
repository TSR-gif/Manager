// How each helper looks: an emoji on a soft coloured tile (from the approved design).
// Picked from the helper's name so Thomas never has to choose one; unknown names get their first letter.
const LOOKS: [RegExp, string, string][] = [
  [/grocer|shop|food/i, "🛒", "#fdf1dc"],
  [/punter|odds|tips|racing/i, "🏇", "#e6efff"],
  [/trad|stock|market data|invest/i, "📈", "#e4f6ec"],
  [/bill|invoice/i, "🧾", "#f2ecfb"],
  [/altona|sports? cent|job|work/i, "🏟️", "#fde8e6"],
  [/bargie|reward/i, "🎁", "#fff4d6"],
  [/car|rego/i, "🚗", "#eceff3"],
  [/rail|website|web site|site/i, "💻", "#e9f0fb"],
  [/manager/i, "🧭", "#eef0f3"],
  [/scrap/i, "🕸️", "#eef0f3"],
  [/cloth|brand|fashion/i, "👕", "#fde8f1"],
  [/ndis|scan/i, "🩺", "#e6f4f4"],
  [/holiday|travel|trip|america/i, "✈️", "#e6efff"],
  [/game|idle/i, "🎮", "#f2ecfb"],
  [/money|budget|bank/i, "💰", "#e7f5ec"],
  [/marketing|social|ads?\b/i, "📣", "#fdeee6"],
  [/idea/i, "💡", "#fff7d1"],
  [/server|host|uptime/i, "🖧", "#eef0f3"],
  [/health|gym|fit/i, "💪", "#e4f6ec"],
  [/home|house/i, "🏠", "#fdf1dc"],
];
const SOFT = ["#e9f0fb", "#fdf1dc", "#e6efff", "#e4f6ec", "#f2ecfb", "#fde8e6", "#fff4d6", "#eceff3"];

export function helperLook(name: string): { emoji: string; bg: string } {
  const hit = LOOKS.find(([re]) => re.test(name));
  if (hit) return { emoji: hit[1], bg: hit[2] };
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { emoji: (name.trim()[0] ?? "•").toUpperCase(), bg: SOFT[h % SOFT.length] };
}

/** Emoji for an approval or job when it isn't tied to a helper. */
export function kindLook(kind: string): { emoji: string; bg: string } {
  if (kind.startsWith("ads.") || kind.startsWith("social.")) return { emoji: "📣", bg: "#fdeee6" };
  if (kind === "purchase") return { emoji: "💳", bg: "#e7f5ec" };
  if (kind === "signup") return { emoji: "✍️", bg: "#e6efff" };
  if (kind === "email.send") return { emoji: "✉️", bg: "#e9f0fb" };
  if (kind === "pc.session" || kind.startsWith("runbook")) return { emoji: "🖥️", bg: "#eef0f3" };
  if (kind.startsWith("mission") || kind.startsWith("code") || kind.startsWith("github")) return { emoji: "💻", bg: "#e9f0fb" };
  if (kind.startsWith("vercel")) return { emoji: "🚀", bg: "#eef0f3" };
  return { emoji: "✅", bg: "#f6f6f4" };
}

/** The main button on a decision row says what will happen, not just "OK". */
export function approveLabel(kind: string, cost: number): string {
  if (kind === "purchase") return "Pay";
  if (kind === "signup") return "Sign up";
  if (kind === "email.send") return "Send";
  if (kind === "social.post" || kind === "social.reply") return "Post";
  if (kind === "ads.launch") return "Launch";
  if (kind === "ads.pause") return "Pause";
  if (kind === "code.push") return "Push";
  if (kind === "vercel.redeploy") return "Redeploy";
  if (kind === "runbook.run" || kind === "runbook.step") return "Run it";
  if (kind === "mission.code") return "Go ahead";
  if (kind === "pc.session") return "Allow";
  return cost > 0 ? "Pay" : "OK";
}

import "server-only";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";

/**
 * A notes file inside each project folder: .claude/skills/<slug>-notes/SKILL.md.
 * Any Claude Code session Thomas opens in that folder picks it up, so it knows the project, his rules and
 * what MyManager has learned, without him explaining it again. MyManager only ever writes its own file:
 * if one exists without our marker (Thomas wrote it), it's left alone.
 */
const MARK = "<!-- Written by MyManager. Edit the brief or rules in MyManager instead; this file is rewritten. -->";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";

type P = { id: string; name: string; local_path?: string | null; brief?: string | null; rules?: string | null; lessons?: string | null; goal?: string | null };

export function notesPath(p: P) {
  return p.local_path ? path.join(p.local_path, ".claude", "skills", `${slug(p.name)}-notes`, "SKILL.md") : null;
}

export function notesText(p: P) {
  const lessons = (p.lessons ?? "").trim();
  return `---
name: ${slug(p.name)}-notes
description: What ${p.name} is, how to run it, where it's at, Thomas's rules for it, and lessons learned. Read before working on ${p.name}.
---
${MARK}

# ${p.name}
${p.goal ? `\nGoal: ${p.goal}\n` : ""}
${p.rules ? `## Thomas's rules (always follow)\n${p.rules}\n` : ""}
${p.brief ? `${p.brief}\n` : "## Brief\nNot written yet.\n"}
${lessons ? `## Lessons learned\n${lessons}\n` : ""}`.replace(/\n{3,}/g, "\n\n");
}

/** Write (or refresh) the notes file. Returns what happened, in plain words. */
export async function writeNotes(projectId: string): Promise<string> {
  const { data } = await db().from("projects").select("id,name,local_path,brief,rules,lessons,goal").eq("id", projectId).maybeSingle();
  const p = data as P | null;
  if (!p) return "No such project.";
  const file = notesPath(p);
  if (!file || !p.local_path || !fs.existsSync(p.local_path)) return "No folder on this PC for this project.";
  if (fs.existsSync(file) && !fs.readFileSync(file, "utf8").includes(MARK)) return "A notes file is already there that Thomas wrote, so I left it alone.";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, notesText(p));
  return `Saved ${path.relative(p.local_path, file)}`;
}

/** Add one lesson (newest last, last 30 kept) and refresh the file. */
export async function remember(projectId: string | null, lesson: string) {
  if (!projectId) return;
  const { data } = await db().from("projects").select("lessons").eq("id", projectId).maybeSingle();
  const line = `- ${new Date().toISOString().slice(0, 10)}: ${lesson.replace(/\s+/g, " ").slice(0, 300)}`;
  const lines = [...String(data?.lessons ?? "").split("\n").filter(Boolean), line].slice(-30);
  await db().from("projects").update({ lessons: lines.join("\n") }).eq("id", projectId);
  await writeNotes(projectId).catch(() => "");
}

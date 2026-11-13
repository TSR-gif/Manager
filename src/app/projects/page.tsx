import { redirect } from "next/navigation";

// Projects are helpers now: one helper per project or life area.
export default function Projects() {
  redirect("/helpers");
}

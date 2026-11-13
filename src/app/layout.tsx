import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Nav } from "@/components/nav";
import { CommandBar } from "@/components/command-bar";
import { UsageLog } from "@/components/usage-log";
import { db } from "@/lib/db";

export const metadata: Metadata = {
  title: "MyManager",
  description: "Thomas's command centre",
  appleWebApp: { capable: true, title: "MyManager", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#07080c",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

async function pendingCount() {
  try {
    const { count } = await db().from("actions").select("id", { count: "exact", head: true }).eq("status", "pending");
    return count ?? 0;
  } catch {
    return 0;
  }
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pending = await pendingCount();
  return (
    <html lang="en-AU" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh antialiased">
        <Nav pending={pending} />
        <main className="mx-auto max-w-[1100px] px-4 pb-32 pt-5 md:pb-12 md:pl-[17rem] md:pr-8 md:pt-8"
          style={{ paddingTop: "max(1.25rem, env(safe-area-inset-top))" }}>
          {children}
        </main>
        <CommandBar />
        <UsageLog />
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(()=>{})}`,
          }}
        />
      </body>
    </html>
  );
}

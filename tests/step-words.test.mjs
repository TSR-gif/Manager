// Plain words for runbook steps: one sentence for Thomas, never a tool's raw output. Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { looksRaw, plainFailure, plainSuccess, signInCommandFor, stepNote } from "../src/lib/step-words.ts";

const SUPA = `   
  LINKED | ORG ID               | REFERENCE ID         | NAME               | REGION                     | CREATED AT (UTC)
  --------|----------------------|----------------------|--------------------|----------------------------|---------------------
          | oztzhvlmqktosvgwmizv | lftrtbbinimjlrwoovjk | Points Rewards App | Southeast Asia (Singapore) | 2026-11-03 19:19:09

Cannot find project ref. Have you run supabase link?`;

test("a Supabase project list becomes one sentence, and 'not linked' is explained, not a failure", () => {
  const t = plainSuccess("npx supabase projects list", SUPA);
  assert.match(t, /signed in to Supabase and can see "Points Rewards App"/);
  assert.match(t, /isn't linked/);
  assert.doesNotMatch(t, /\|/);
});

test("vercel whoami and project ls", () => {
  assert.equal(plainSuccess("npx vercel whoami", "Vercel CLI 65.16.0\ntsrailfabrication-3703\n"), "MyManager is signed in to Vercel as tsrailfabrication-3703.");
  assert.match(plainSuccess("npx vercel project ls", "punteriq\thttps://punteriq.app\t2026\nlong-reign\thttps://x\t2026\nVercel CLI 65.16.0\n> Projects found under tscida"), /2 Vercel projects: punteriq, long-reign/);
});

test("sign-in failures are plain", () => {
  assert.match(plainFailure("npx vercel whoami", "npm warn exec The following package\nVercel CLI 65.15.0\nError: The specified token is not valid. Use `vercel login` to generate a new token."), /isn't signed in to Vercel/);
});

test("old raw notes on saved steps are shown as sentences", () => {
  const old = "npm warn exec The following package was not found / Vercel CLI 65.15.0 / Error: The specified token is not valid. Use `vercel login` to generate a new token.";
  assert.ok(looksRaw(old));
  assert.match(stepNote({ status: "failed", note: old, command: "npx vercel whoami" }), /isn't signed in to Vercel/);
  assert.equal(stepNote({ status: "done", note: "Nothing new to commit." }), "Nothing new to commit.");
  assert.ok(!looksRaw("Signed in to Vercel. I checked, it works."));
});

test("a sign-in planned without its command is still recognised", () => {
  assert.equal(signInCommandFor("Sign in to Supabase"), "npx supabase login");
  assert.equal(signInCommandFor("Sign in to Vercel"), "npx vercel login");
  assert.equal(signInCommandFor("Pick your Supabase project"), null);
});

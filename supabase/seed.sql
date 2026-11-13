-- Seed: Thomas's projects as of 2026-11-13, filled in from his repos.
-- Goals / next actions are Claude's best read of each repo; edit them in the app.
insert into projects (name, status, priority, github_repo, vercel_project, goal, next_action, notes) values
 ('Manager', 'active', 1, 'TSR-gif/Manager', 'manager',
  'One app that tells me what to work on and does the busywork for me',
  'Use Manager every day this week and tell it what gets in your way',
  'This app. Next.js + Supabase on Vercel. Agent runs on Claude.'),
 ('Rewards App', 'active', 2, 'TSR-gif/RewardsApp', 'rewardsapp',
  'Bargie (bargie.app): find Qantas / Everyday Rewards points and grocery savings each week',
  'Pick the next feature from real weekly use and ship it',
  'Static site + Supabase ("Points Rewards App"). Very active: 540+ PRs. Weekly deal finder, Shop plan, Meals, points log.'),
 ('TSRail Website', 'active', 2, 'TSR-gif/TSRailWebsite', 'ts-rail-website',
  'TS Rail Operations Portal (tsrail.com.au) for running the business',
  'List the top 3 pain points from this week''s jobs and fix one',
  'Plain HTML/JS on Vercel + Supabase. Calendar, documents, records, push notifications, incident PDFs. Version-bumped releases (v162+).'),
 ('PunterIQ', 'active', 3, 'TSR-gif/PunterIQ', 'punteriq',
  'Betting analytics + tracking app for Australian punters (prices, saved bets, bankroll), no fake "edge"',
  'Decide: resume AFL model-data work or ship the tracking shell to a few users',
  'Static app, develop branch for work. Odds cache refresh paused 28 Oct. Roadmap: AFL Official Team List source handoff.'),
 ('Day trader', 'active', 3, 'TSR-gif/DayTrader', null,
  'Find out if any trading rule beats buy-and-hold, using pretend money only',
  'Read FINDINGS.md short version and decide whether to keep going or switch to index investing',
  'Python backtester + paper trader (Alpaca). Findings 12 Nov: buy-and-hold SPY/QQQ beat every day-trading rule; ML1-preview FAIL. Never real money unless Thomas says so.'),
 ('Idle Game', 'active', 4, 'TSR-gif/long-reign', 'long-reign',
  'The Long Reign: an idle village-building game',
  'Play the latest build for 30 minutes and note what feels slow',
  'TypeScript + Vite. Save point 3 (chapters + Journey screen). Balance bot in npm run stages. Local copy at C:\LongReign.'),
 ('NDIS Scanner', 'active', 3, null, null,
  'Define what the NDIS Scanner should do and who it''s for',
  'Write a one-paragraph brief and the first 3 tasks',
  'No GitHub repo yet. A folder exists on his PC: C:\Users\tomsc\NDISScanner.'),
 ('Altona Sports Centre', 'active', 3, null, null,
  'Deliver the Altona Sports Centre job on time and get paid',
  'Write down the scope, deadline and agreed price',
  'Client job (paid work for Altona Sports Centre). Track scope, deliverables, hours, invoice and payment here.'),
 ('Web Scrapers', 'active', 4, null, null,
  'Reusable scrapers that feed my other apps (deals, prices, odds)',
  'List which scrapers exist and which app each one feeds',
  'No repo yet. Likely related to Bargie deal finder and PunterIQ odds cache.'),
 ('America Holiday', 'paused', 5, 'TSR-gif/AmericaHolidayWebsite', 'americaholidaywebsite',
  'USA trip planner for Thomas and Nathan, 8 to 23 Oct 2026',
  'Trip is over: export photos and notes, then archive',
  'Static site + Firebase. Map, daily plans, bookings, money, offline. Trip ended 23 Oct 2026.'),
 ('Clothing Brand', 'idea', 4, null, null,
  'Launch a small clothing brand',
  'Write a one-page plan: name, style, first 3 products, budget',
  null),
 ('TradingProgram', 'archived', 5, 'TSR-gif/TradingProgram', null,
  null, null, 'Empty repo (initial commit 12 Nov). Probably superseded by Day trader.');

update projects set kind = 'client' where name = 'Altona Sports Centre';

-- Starter tasks from the 13 Nov 2026 research (manager/research/manager-ideas-apps-tools.md).
-- Idempotent: each task is only added once, and only if its project exists.
with t(project, title, priority) as (values
  ('Day trader',        'Check Alpaca accepts Australian accounts before going past paper trading', 2),
  ('Day trader',        'Try NautilusTrader: same code for backtest and live, supports Interactive Brokers (AU)', 3),
  ('Day trader',        'Add a Day trader tile to Manager using the Alpha Vantage connector', 4),
  ('Web Scrapers',      'Pick the base: Crawlee (Node, fits Manager) or Crawl4AI (Python, Markdown output)', 3),
  ('Web Scrapers',      'Set up changedetection.io for price/page alerts (could feed Bargie)', 3),
  ('NDIS Scanner',      'Download the 2026-27 NDIS Support Catalogue spreadsheet (prices from 1 Jul 2026)', 2),
  ('NDIS Scanner',      'Prototype: send a plan or invoice PDF to Claude, check item codes against the catalogue', 3),
  ('NDIS Scanner',      'Find the NDIA bulk-claim CSV spec for PRODA uploads', 4),
  ('Clothing Brand',    'Compare AU print-on-demand: Printful (Melbourne), Gelato, OGO (AS Colour blanks)', 3),
  ('Clothing Brand',    'Order one sample tee before choosing a printer', 4),
  ('Altona Sports Centre', 'Write down the scope, deadline and agreed price', 1),
  ('Altona Sports Centre', 'Start logging hours worked', 2),
  ('Altona Sports Centre', 'Plan when to invoice and how they pay', 3)
)
insert into tasks (title, project_id, priority)
select t.title, p.id, t.priority
from t join projects p on p.name = t.project
where not exists (select 1 from tasks x where x.title = t.title and x.project_id = p.id);

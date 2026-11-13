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

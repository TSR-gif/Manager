-- Agent runs can be powered by the Claude Code app on Thomas's PC; remember its session to continue a run.
alter table agent_runs add column if not exists cc_session_id text;
alter table agent_runs add column if not exists backend text not null default 'api';
-- How much the agent may decide on its own: ask (always ask), balanced (default), decide (acts on anything low-stakes and reversible).
alter table settings add column if not exists autonomy text not null default 'balanced';

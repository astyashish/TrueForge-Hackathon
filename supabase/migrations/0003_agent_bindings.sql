-- Threshold: agent bindings and approval events tables
-- Additive only — does not modify games / game_scenes / profiles

-- ---------------------------------------------------------------------------
-- agent_bindings
-- Maps each district (game_id + scene_id) to a live TrueForge session.
-- ---------------------------------------------------------------------------

create table public.agent_bindings (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games (id) on delete cascade,
  district_id text not null,          -- scene_id within the game (e.g. "b0")
  trueforge_session_id text not null, -- TrueForge session UUID
  archetype text not null default 'cloud-cost-janitor',
  mcp_server_id text,                 -- TrueForge MCP server id used by this session
  created_at timestamptz not null default now(),
  unique (game_id, district_id)
);

create index agent_bindings_game_idx on public.agent_bindings (game_id);
create index agent_bindings_session_idx on public.agent_bindings (trueforge_session_id);

alter table public.agent_bindings enable row level security;

create policy "agent_bindings_select_authenticated"
on public.agent_bindings
for select
to authenticated
using (
  exists (
    select 1 from public.games g
    where g.id = game_id
  )
);

create policy "agent_bindings_insert_owner"
on public.agent_bindings
for insert
to authenticated
with check (
  exists (
    select 1 from public.games g
    where g.id = game_id
      and g.owner = auth.uid()
  )
);

create policy "agent_bindings_update_owner"
on public.agent_bindings
for update
to authenticated
using (
  exists (
    select 1 from public.games g
    where g.id = game_id
      and g.owner = auth.uid()
  )
);

-- ---------------------------------------------------------------------------
-- approval_events
-- Log of every Threshold Card decision (approve / deny) by the Operator.
-- ---------------------------------------------------------------------------

create table public.approval_events (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  game_id uuid references public.games (id) on delete cascade,
  tool_name text not null,
  summary text not null,              -- plain-language description shown on the card
  risk_level text not null default 'reversible' check (risk_level in ('reversible', 'irreversible', 'catastrophic')),
  decision text not null check (decision in ('approved', 'denied')),
  reviewed_detail boolean not null default false,  -- did the Operator expand the detail panel?
  blast_radius_delta integer not null default 0,   -- blast radius change this decision caused
  resolved_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index approval_events_session_idx on public.approval_events (session_id);
create index approval_events_game_idx on public.approval_events (game_id);

alter table public.approval_events enable row level security;

create policy "approval_events_select_authenticated"
on public.approval_events
for select
to authenticated
using (
  game_id is null
  or exists (
    select 1 from public.games g
    where g.id = game_id
  )
);

create policy "approval_events_insert_authenticated"
on public.approval_events
for insert
to authenticated
with check (true);

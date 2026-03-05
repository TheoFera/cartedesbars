-- Replace legacy reviews/review_scores with bar_notes for MVP.
create extension if not exists "pgcrypto";

drop view if exists public.bar_avg_by_criteria;
drop view if exists public.bar_overall;
drop table if exists public.review_scores;
drop table if exists public.reviews;

create table if not exists public.bar_notes (
  id uuid primary key default gen_random_uuid(),
  bar_id uuid not null references public.bars(id) on delete cascade,
  criteria_id uuid not null references public.criteria(id) on delete restrict,
  value_int int null check (value_int between 1 and 5),
  comment text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_bar_notes_bar_id on public.bar_notes(bar_id);
create index if not exists idx_bar_notes_criteria_id on public.bar_notes(criteria_id);
create index if not exists idx_bar_notes_created_at on public.bar_notes(created_at desc);

create or replace view public.bar_overall as
select
  b.id as bar_id,
  avg(n.value_int)::numeric(4, 2) as avg_value,
  count(n.value_int) as notes_count
from public.bars b
left join public.bar_notes n
  on n.bar_id = b.id
 and n.value_int is not null
group by b.id;

create or replace view public.bar_avg_by_criteria as
select
  n.bar_id,
  n.criteria_id,
  avg(n.value_int)::numeric(4, 2) as avg_value,
  count(n.value_int) as notes_count
from public.bar_notes n
where n.value_int is not null
group by n.bar_id, n.criteria_id;

grant select on public.bars, public.criteria, public.bar_notes to anon;
grant insert on public.bar_notes to anon;
grant select on public.bar_overall, public.bar_avg_by_criteria to anon;

alter table public.bars enable row level security;
alter table public.criteria enable row level security;
alter table public.bar_notes enable row level security;

drop policy if exists bars_select_anon on public.bars;
create policy bars_select_anon
on public.bars
for select
to anon
using (true);

drop policy if exists criteria_select_anon on public.criteria;
create policy criteria_select_anon
on public.criteria
for select
to anon
using (true);

drop policy if exists bar_notes_select_anon on public.bar_notes;
create policy bar_notes_select_anon
on public.bar_notes
for select
to anon
using (true);

drop policy if exists bar_notes_insert_anon on public.bar_notes;
create policy bar_notes_insert_anon
on public.bar_notes
for insert
to anon
with check (true);

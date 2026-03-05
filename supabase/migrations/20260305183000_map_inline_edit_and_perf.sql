-- Enable true inline editing (upsert by bar_id + criteria_id) and map performance indexes.

-- Keep only the most recent note row per (bar_id, criteria_id) before adding uniqueness.
delete from public.bar_notes older
using public.bar_notes newer
where older.bar_id = newer.bar_id
  and older.criteria_id = newer.criteria_id
  and (
    older.created_at < newer.created_at
    or (older.created_at = newer.created_at and older.id::text < newer.id::text)
  );

create unique index if not exists uq_bar_notes_bar_criteria
  on public.bar_notes(bar_id, criteria_id);

grant update on public.bar_notes to anon;

drop policy if exists bar_notes_update_anon on public.bar_notes;
create policy bar_notes_update_anon
on public.bar_notes
for update
to anon
using (true)
with check (true);

create index if not exists idx_bars_lat on public.bars(lat);
create index if not exists idx_bars_lng on public.bars(lng);
create index if not exists idx_bars_name_lower on public.bars(lower(name));

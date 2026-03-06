-- Optimize map loading with a single query source and better geo indexes.

create index if not exists idx_bars_lat_lng_not_null
  on public.bars(lat, lng)
  where lat is not null and lng is not null;

create index if not exists idx_bar_notes_bar_id_value_int_not_null
  on public.bar_notes(bar_id)
  where value_int is not null;

drop view if exists public.bars_map;

create view public.bars_map
with (security_invoker = true) as
select
  b.id,
  b.name,
  b.lat,
  b.lng,
  b.address,
  stats.overall_avg
from public.bars b
left join lateral (
  select avg(n.value_int)::numeric(4, 2) as overall_avg
  from public.bar_notes n
  where n.bar_id = b.id
    and n.value_int is not null
) stats on true
where b.lat is not null
  and b.lng is not null;

grant select on public.bars_map to anon;

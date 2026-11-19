-- 在 Supabase 後台：SQL Editor → New query → 貼上後 Run
-- 建立日記表，並開放匿名讀寫（此專案尚未做登入）

create table if not exists public.diaries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  "date" text not null default '',
  title text not null default '',
  content text not null default ''
);

alter table public.diaries enable row level security;

drop policy if exists "diaries_select_public" on public.diaries;
drop policy if exists "diaries_insert_public" on public.diaries;
drop policy if exists "diaries_update_public" on public.diaries;
drop policy if exists "diaries_delete_public" on public.diaries;

create policy "diaries_select_public"
  on public.diaries for select
  to anon, authenticated
  using (true);

create policy "diaries_insert_public"
  on public.diaries for insert
  to anon, authenticated
  with check (true);

create policy "diaries_update_public"
  on public.diaries for update
  to anon, authenticated
  using (true)
  with check (true);

create policy "diaries_delete_public"
  on public.diaries for delete
  to anon, authenticated
  using (true);

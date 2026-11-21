-- HOTEL BOOKING APP — SETUP FOR A NEW, EMPTY SUPABASE PROJECT
-- Based on the app.js interface: hp_profiles, hp_rooms, hp_bookings,
-- save_booking_if_version(id, data, expected_version), realtime.
-- IMPORTANT: Run ONLY on a NEW project. Do not run on production without review.
-- This creates the structure, NOT old booking data or Auth accounts.

begin;

create table if not exists public.hp_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null check (role in ('manager', 'staff'))
);

create table if not exists public.hp_rooms (
  id text primary key,
  data jsonb not null
);

create table if not exists public.hp_bookings (
  id text primary key,
  data jsonb not null,
  version bigint not null default 1 check (version >= 1)
);

create index if not exists hp_bookings_room_idx on public.hp_bookings ((data->>'roomId'));

-- Helper: only existing, assigned staff/manager accounts may access hotel data.
create or replace function public.hp_is_member()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hp_profiles
    where id = (select auth.uid()) and role in ('manager', 'staff')
  );
$$;

create or replace function public.hp_is_manager()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hp_profiles
    where id = (select auth.uid()) and role = 'manager'
  );
$$;

revoke all on function public.hp_is_member() from public;
revoke all on function public.hp_is_manager() from public;
grant execute on function public.hp_is_member() to authenticated;
grant execute on function public.hp_is_manager() to authenticated;

alter table public.hp_profiles enable row level security;
alter table public.hp_rooms enable row level security;
alter table public.hp_bookings enable row level security;

-- A user may read their own profile; managers can view/manage other profiles.
drop policy if exists hp_profiles_read on public.hp_profiles;
create policy hp_profiles_read on public.hp_profiles for select to authenticated
using (id = (select auth.uid()) or (select public.hp_is_manager()));

drop policy if exists hp_profiles_manager_insert on public.hp_profiles;
create policy hp_profiles_manager_insert on public.hp_profiles for insert to authenticated
with check ((select public.hp_is_manager()));

drop policy if exists hp_profiles_manager_update on public.hp_profiles;
create policy hp_profiles_manager_update on public.hp_profiles for update to authenticated
using ((select public.hp_is_manager())) with check ((select public.hp_is_manager()));

drop policy if exists hp_profiles_manager_delete on public.hp_profiles;
create policy hp_profiles_manager_delete on public.hp_profiles for delete to authenticated
using ((select public.hp_is_manager()));

-- Rooms are readable by all assigned users; only managers can edit them.
drop policy if exists hp_rooms_read on public.hp_rooms;
create policy hp_rooms_read on public.hp_rooms for select to authenticated
using ((select public.hp_is_member()));

drop policy if exists hp_rooms_insert on public.hp_rooms;
create policy hp_rooms_insert on public.hp_rooms for insert to authenticated
with check ((select public.hp_is_manager()));

drop policy if exists hp_rooms_update on public.hp_rooms;
create policy hp_rooms_update on public.hp_rooms for update to authenticated
using ((select public.hp_is_manager())) with check ((select public.hp_is_manager()));

drop policy if exists hp_rooms_delete on public.hp_rooms;
create policy hp_rooms_delete on public.hp_rooms for delete to authenticated
using ((select public.hp_is_manager()));

-- Bookings are read by assigned users. Write through the version-checking RPC.
drop policy if exists hp_bookings_read on public.hp_bookings;
create policy hp_bookings_read on public.hp_bookings for select to authenticated
using ((select public.hp_is_member()));

drop policy if exists hp_bookings_delete on public.hp_bookings;
create policy hp_bookings_delete on public.hp_bookings for delete to authenticated
using ((select public.hp_is_member()));

revoke all on public.hp_profiles, public.hp_rooms, public.hp_bookings from anon;
grant select, insert, update, delete on public.hp_profiles to authenticated;
grant select, insert, update, delete on public.hp_rooms to authenticated;
grant select, delete on public.hp_bookings to authenticated;
revoke insert, update on public.hp_bookings from authenticated;

-- Booking times are JavaScript epoch milliseconds stored in JSONB.
-- Match the app's effectiveTimes() logic for wait/dep/in/out/cancel.
create or replace function public.hp_effective_start(b jsonb)
returns numeric language sql stable set search_path = ''
as $$
  select case when b->>'status' = 'in'
    then coalesce(nullif(b->>'actualStart','')::numeric, (b->>'start')::numeric)
    else (b->>'start')::numeric end;
$$;

create or replace function public.hp_effective_end(b jsonb)
returns numeric language sql stable set search_path = ''
as $$
  select case
    when b->>'status' = 'cancel' then coalesce(nullif(b->>'cancelledAt','')::numeric, (b->>'end')::numeric)
    when b->>'status' = 'out' then coalesce(nullif(b->>'actualEnd','')::numeric, (b->>'end')::numeric)
    when b->>'status' = 'in' then greatest((b->>'end')::numeric, floor(extract(epoch from clock_timestamp()) * 1000)::numeric)
    else (b->>'end')::numeric
  end;
$$;

-- The trigger prevents conflicting bookings even if a privileged writer bypasses the RPC.
create or replace function public.hp_check_booking_overlap()
returns trigger language plpgsql security definer
set search_path = ''
as $$
declare
  v_start numeric;
  v_end numeric;
  v_room text;
begin
  v_room := new.data->>'roomId';
  if v_room is null or v_room = '' or
     nullif(new.data->>'start','') is null or
     nullif(new.data->>'end','') is null then
    raise exception 'INVALID_BOOKING: roomId/start/end required';
  end if;
  if (new.data->>'end')::numeric <= (new.data->>'start')::numeric then
    raise exception 'INVALID_BOOKING: end must be after start';
  end if;

  -- Serialize simultaneous writes to the same room.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_room, 0));

  v_start := public.hp_effective_start(new.data);
  v_end := public.hp_effective_end(new.data);
  if v_end > v_start and exists (
    select 1 from public.hp_bookings b
    where b.id <> new.id
      and b.data->>'roomId' = v_room
      and public.hp_effective_start(b.data) < v_end
      and public.hp_effective_end(b.data) > v_start
  ) then
    raise exception 'BOOKING_OVERLAP: room already reserved' using errcode = '23P01';
  end if;
  return new;
end;
$$;

drop trigger if exists hp_no_overlap on public.hp_bookings;
create trigger hp_no_overlap
before insert or update of data on public.hp_bookings
for each row execute function public.hp_check_booking_overlap();

-- Optimistic locking: expected_version=0 creates a booking; matching version updates it.
-- NULL means another device already changed the booking.
create or replace function public.save_booking_if_version(
  p_id text, p_data jsonb, p_expected_version bigint
)
returns bigint language plpgsql security definer
set search_path = ''
as $$
declare
  v_current bigint;
  v_new bigint;
begin
  if not public.hp_is_member() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_id is null or p_id = '' or p_data is null then
    raise exception 'INVALID_BOOKING';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'INVALID_VERSION';
  end if;

  -- Serialize writes to this booking ID (including simultaneous creation).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('booking:' || p_id, 0));
  select version into v_current from public.hp_bookings where id = p_id for update;

  if not found then
    if p_expected_version <> 0 then return null; end if;
    insert into public.hp_bookings(id, data, version)
    values (p_id, p_data, 1);
    return 1;
  end if;

  if v_current <> p_expected_version then return null; end if;
  update public.hp_bookings
  set data = p_data, version = version + 1
  where id = p_id
  returning version into v_new;
  return v_new;
end;
$$;

revoke all on function public.save_booking_if_version(text,jsonb,bigint) from public;
grant execute on function public.save_booking_if_version(text,jsonb,bigint) to authenticated;

-- Enable Realtime for both tables, without duplicating publication membership.
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hp_rooms'
    ) then
      alter publication supabase_realtime add table public.hp_rooms;
    end if;
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hp_bookings'
    ) then
      alter publication supabase_realtime add table public.hp_bookings;
    end if;
  end if;
end $$;

commit;

-- AFTER RUNNING: Supabase > Authentication > Users: create an admin user.
-- Then run the following in SQL Editor, replacing BOTH values:
-- insert into public.hp_profiles(id, email, role)
-- values ('USER_UUID_FROM_AUTH_USERS', 'admin@example.com', 'manager');
-- Do NOT insert passwords into hp_profiles.
-- Then configure Auth Site URL / Redirect URLs and update app.js URL/key.
-- NOTE: This setup does not migrate old bookings, rooms, profiles or passwords.

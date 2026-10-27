-- =====================================================================
-- Flunify — Skema Supabase (jalankan di Supabase SQL Editor)
-- =====================================================================

-- ---------- Extension Pgcrypto ----------
create extension if not exists pgcrypto;

-- ---------- Helper: cek admin dari JWT app_metadata ----------
create or replace function public.is_admin()
returns boolean
language sql stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;

-- ---------- Profiles (Sinkronisasi akun dengan auth.users & manajemen tim) ----------
create table if not exists public.profiles (
  id           uuid primary key default gen_random_uuid(),
  full_name    text not null default '',
  username     text unique,
  email        text not null,
  account_type text not null default 'therapist' check (account_type in ('therapist', 'student', 'admin')),
  status       text not null default 'active'    check (status in ('active', 'inactive')),
  raw_password text,
  created_at   timestamptz not null default now()
);

-- Pastikan id default gen_random_uuid(), raw_password ada, & lepaskan constraint foreign key kaku jika sebelumnya ada
alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles add column if not exists raw_password text;
alter table public.profiles drop constraint if exists profiles_id_fkey;

-- Fungsi trigger saat user baru mendaftar di Supabase Auth
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  target_username text;
  base_username text;
  counter int := 1;
begin
  base_username := coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1));
  target_username := base_username;

  -- Jika username sudah dipakai oleh id lain, berikan akhiran nomor agar tidak bentrok
  while exists (select 1 from public.profiles where username = target_username and id <> new.id) loop
    target_username := base_username || '.' || counter::text;
    counter := counter + 1;
  end loop;

  insert into public.profiles (id, full_name, username, email, account_type, status)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    target_username,
    new.email,
    case when new.raw_app_meta_data ->> 'role' = 'admin' then 'admin'
         when new.raw_user_meta_data ->> 'account_type' = 'student' then 'student'
         else 'therapist' end,
    'active'
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    username = excluded.username,
    email = excluded.email,
    account_type = excluded.account_type;

  return new;
exception when others then
  -- Pengaman agar tidak pernah menggagalkan pembuatan user di auth.users
  return new;
end;
$$;

-- Pasang trigger on_auth_user_created jika belum terpasang (tanpa error izin)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user();
  end if;
exception when others then
  null;
end $$;

-- ---------- Clients (tanpa nama asli — hanya kode & usia) ----------
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  client_code text not null unique,
  age         int  not null check (age between 0 and 120),
  created_at  timestamptz not null default now()
);

-- ---------- Assessments ----------
create table if not exists public.assessments (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients (id) on delete cascade,
  therapist_id        uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  assessment_date     date not null,
  case_history        text not null default '',
  therapist_notes     text not null default '',
  total_syllables     int  not null check (total_syllables > 0),
  stuttered_syllables int  not null check (stuttered_syllables >= 0 and stuttered_syllables <= total_syllables),
  ss_percentage       numeric(5, 2) generated always as
                        (round(stuttered_syllables::numeric / total_syllables::numeric * 100, 2)) stored,
  created_at          timestamptz not null default now()
);
create index if not exists assessments_therapist_idx on public.assessments (therapist_id);
create index if not exists assessments_client_idx on public.assessments (client_id);

-- ---------- Observations (tugas bicara & jenis ketidaklancaran) ----------
create table if not exists public.observations (
  id            uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  category      text not null check (category in ('speech_task', 'disfluency')),
  label         text not null,
  created_at    timestamptz not null default now()
);
create index if not exists observations_assessment_idx on public.observations (assessment_id);

-- ---------- Audio recordings (file di Storage, metadata di sini) ----------
create table if not exists public.audio_recordings (
  id               uuid primary key default gen_random_uuid(),
  assessment_id    uuid not null references public.assessments (id) on delete cascade,
  file_reference   text not null,
  duration_seconds int  not null default 0,
  size_bytes       bigint not null default 0,
  mime_type        text,
  recorded_at      timestamptz not null default now()
);
create index if not exists audio_assessment_idx on public.audio_recordings (assessment_id);

-- ---------- Master data opsi checklist ----------
create table if not exists public.master_options (
  id         uuid primary key default gen_random_uuid(),
  category   text not null check (category in ('speech_task', 'disfluency')),
  label      text not null,
  sort_order int  not null default 0,
  unique (category, label)
);

insert into public.master_options (category, label, sort_order) values
  ('speech_task', 'Bicara spontan', 0),
  ('speech_task', 'Bercerita', 1),
  ('speech_task', 'Menjawab pertanyaan', 2),
  ('speech_task', 'Membaca', 3),
  ('disfluency', 'Pengulangan bunyi/suku kata', 0),
  ('disfluency', 'Pengulangan kata utuh', 1),
  ('disfluency', 'Pengulangan frasa', 2),
  ('disfluency', 'Pemanjangan bunyi (prolongation)', 3),
  ('disfluency', 'Blocking', 4),
  ('disfluency', 'Interjeksi / jeda', 5),
  ('disfluency', 'Perilaku penyerta', 6)
on conflict (category, label) do nothing;

-- ---------- Login History / Audit Trail (Masa simpan 30 hari) ----------
create table if not exists public.login_history (
  id         uuid primary key default gen_random_uuid(),
  username   text not null,
  role       text not null default 'therapist',
  status     text not null check (status in ('success', 'failed')),
  ip_address text not null default '-',
  user_agent text not null default '-',
  logged_at  timestamptz not null default now()
);
create index if not exists login_history_logged_at_idx on public.login_history (logged_at desc);

-- Pembersihan otomatis catatan login lampau (> 30 hari)
create or replace function public.purge_old_login_history()
returns trigger
language plpgsql
security definer
as $$
begin
  delete from public.login_history
  where logged_at < now() - interval '30 days';
  return new;
end;
$$;

drop trigger if exists trg_purge_old_login_history on public.login_history;
create trigger trg_purge_old_login_history
  after insert on public.login_history
  for each statement
  execute function public.purge_old_login_history();

-- =====================================================================
-- Row Level Security (RLS)
-- =====================================================================
alter table public.profiles         enable row level security;
alter table public.login_history    enable row level security;
alter table public.clients          enable row level security;
alter table public.assessments      enable row level security;
alter table public.observations     enable row level security;
alter table public.audio_recordings enable row level security;
alter table public.master_options   enable row level security;

-- Profiles: Akses tim klinik (Select, Insert, Update, Delete)
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated
  using (true);

drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert" on public.profiles for insert to authenticated
  with check (true);

drop policy if exists "profiles_admin_update" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
create policy "profiles_update" on public.profiles for update to authenticated
  using (true) with check (true);

drop policy if exists "profiles_delete" on public.profiles;
create policy "profiles_delete" on public.profiles for delete to authenticated
  using (true);

-- Login History: Simpan log login dan baca riwayat audit
drop policy if exists "login_history_select" on public.login_history;
create policy "login_history_select" on public.login_history for select to authenticated
  using (true);

drop policy if exists "login_history_insert" on public.login_history;
create policy "login_history_insert" on public.login_history for insert to anon, authenticated
  with check (true);

drop policy if exists "login_history_admin_delete" on public.login_history;
drop policy if exists "login_history_delete" on public.login_history;
create policy "login_history_delete" on public.login_history for delete to authenticated
  using (true);

-- Clients: dipakai bersama oleh tim klinik.
drop policy if exists "clients_select" on public.clients;
create policy "clients_select" on public.clients for select to authenticated using (true);

drop policy if exists "clients_insert" on public.clients;
create policy "clients_insert" on public.clients for insert to authenticated with check (true);

drop policy if exists "clients_update" on public.clients;
create policy "clients_update" on public.clients for update to authenticated using (true) with check (true);

-- Assessments: terapis melihat miliknya, admin melihat semua.
drop policy if exists "assessments_select" on public.assessments;
create policy "assessments_select" on public.assessments for select to authenticated
  using (therapist_id = auth.uid() or public.is_admin());

drop policy if exists "assessments_insert" on public.assessments;
create policy "assessments_insert" on public.assessments for insert to authenticated
  with check (therapist_id = auth.uid());

drop policy if exists "assessments_admin_delete" on public.assessments;
create policy "assessments_admin_delete" on public.assessments for delete to authenticated
  using (public.is_admin());

-- Observations & audio mengikuti hak akses asesmen induk.
drop policy if exists "observations_select" on public.observations;
create policy "observations_select" on public.observations for select to authenticated
  using (exists (select 1 from public.assessments a where a.id = assessment_id
                 and (a.therapist_id = auth.uid() or public.is_admin())));

drop policy if exists "observations_insert" on public.observations;
create policy "observations_insert" on public.observations for insert to authenticated
  with check (exists (select 1 from public.assessments a where a.id = assessment_id and a.therapist_id = auth.uid()));

drop policy if exists "audio_select" on public.audio_recordings;
create policy "audio_select" on public.audio_recordings for select to authenticated
  using (exists (select 1 from public.assessments a where a.id = assessment_id
                 and (a.therapist_id = auth.uid() or public.is_admin())));

drop policy if exists "audio_insert" on public.audio_recordings;
create policy "audio_insert" on public.audio_recordings for insert to authenticated
  with check (exists (select 1 from public.assessments a where a.id = assessment_id and a.therapist_id = auth.uid()));

-- Master data: semua bisa baca, admin mengelola
drop policy if exists "master_select" on public.master_options;
create policy "master_select" on public.master_options for select to authenticated using (true);

drop policy if exists "master_admin_insert" on public.master_options;
create policy "master_admin_insert" on public.master_options for insert to authenticated with check (public.is_admin());

drop policy if exists "master_admin_update" on public.master_options;
create policy "master_admin_update" on public.master_options for update to authenticated using (public.is_admin());

drop policy if exists "master_admin_delete" on public.master_options;
create policy "master_admin_delete" on public.master_options for delete to authenticated using (public.is_admin());

-- =====================================================================
-- Realtime: Sinkronisasi Otomatis Antara Localhost & Vercel
-- =====================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;

  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'login_history'
  ) then
    alter publication supabase_realtime add table public.login_history;
  end if;
exception when others then
  null;
end $$;

-- =====================================================================
-- Storage: Bucket untuk sampel audio
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('audio_samples', 'audio_samples', true)
on conflict (id) do update set public = true;

drop policy if exists "audio_upload_policy" on storage.objects;
create policy "audio_upload_policy" on storage.objects for insert to authenticated
  with check (bucket_id = 'audio_samples');

drop policy if exists "audio_select_policy" on storage.objects;
create policy "audio_select_policy" on storage.objects for select to authenticated, anon
  using (bucket_id = 'audio_samples');

drop policy if exists "audio_delete_policy" on storage.objects;
create policy "audio_delete_policy" on storage.objects for delete to authenticated
  using (bucket_id = 'audio_samples');

-- =====================================================================
-- Helper RPC: Tambah, Update Sandi, & Hapus Pengguna oleh Admin
-- =====================================================================
create or replace function public.admin_create_user(
  p_email text,
  p_password text,
  p_full_name text,
  p_username text,
  p_role text default 'therapist'
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  new_user_id uuid := gen_random_uuid();
  encrypted_pw text;
begin
  encrypted_pw := crypt(p_password, gen_salt('bf'));

  -- Masukkan ke auth.users (langsung terkonfirmasi, token non-null untuk GoTrue)
  insert into auth.users (
    id, instance_id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, role, aud, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new
  ) values (
    new_user_id, '00000000-0000-0000-0000-000000000000',
    p_email, encrypted_pw, now(),
    jsonb_build_object('provider', 'email', 'providers', array['email'], 'role', p_role),
    jsonb_build_object('full_name', p_full_name, 'username', p_username, 'title', case when p_role = 'admin' then 'Administrator' else 'Terapis Wicara' end),
    'authenticated', 'authenticated', now(), now(),
    '', '', '', ''
  );

  -- Masukkan ke auth.identities
  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values (
    new_user_id, new_user_id, new_user_id::text,
    jsonb_build_object('sub', new_user_id::text, 'email', p_email),
    'email', now(), now(), now()
  );

  -- Masukkan / update ke public.profiles
  insert into public.profiles (id, full_name, username, email, account_type, status)
  values (
    new_user_id, p_full_name, p_username, p_email, p_role, 'active'
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    username = excluded.username,
    email = excluded.email,
    account_type = excluded.account_type,
    status = 'active';

  return new_user_id;
end;
$$;

create or replace function public.admin_update_user_password(
  p_user_id uuid,
  p_new_password text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  -- 1. Update hash kata sandi di auth.users agar bisa langsung login
  update auth.users
  set encrypted_password = crypt(p_new_password, gen_salt('bf')),
      updated_at = now()
  where id = p_user_id;

  -- 2. Update raw_password di public.profiles agar Admin bisa melihat kredensial terbaru
  update public.profiles
  set raw_password = p_new_password
  where id = p_user_id;

  return true;
end;
$$;

create or replace function public.admin_delete_user(
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  delete from auth.users where id = p_user_id;
  delete from public.profiles where id = p_user_id;
  return true;
end;
$$;

grant execute on function public.admin_create_user(text, text, text, text, text) to authenticated, anon;
grant execute on function public.admin_update_user_password(uuid, text) to authenticated, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated, anon;

-- =====================================================================
-- SEED DATA AWAL: Akun Auth Supabase (Admin & Terapis)
-- =====================================================================

-- Perbaiki nilai NULL pada kolom token di auth.users yang menyebabkan GoTrue 'Database error querying schema'
update auth.users
set 
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change = coalesce(email_change, ''),
  email_change_token_new = coalesce(email_change_token_new, '');

-- Bersihkan data lama jika ada bentrok
delete from public.profiles where username in ('aku.admin', 'terapis.wicara', 'oceanz') or email in ('aku.admin@flunify.id', 'terapis.wicara@flunify.id', 'oceanz@flunify.id');
delete from auth.identities where user_id in ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444') or identity_data ->> 'email' in ('aku.admin@flunify.id', 'terapis.wicara@flunify.id', 'oceanz@flunify.id');
delete from auth.users where id in ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444') or email in ('aku.admin@flunify.id', 'terapis.wicara@flunify.id', 'oceanz@flunify.id');

-- Masukkan akun ke auth.users dengan token non-null ('')
insert into auth.users (
  id, instance_id, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, role, aud, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
) values
  (
    '22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
    'aku.admin@flunify.id', crypt('Poltekkes@Admin2026', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"],"role":"admin"}'::jsonb,
    '{"full_name":"Azzahrah","username":"aku.admin","title":"Administrator"}'::jsonb,
    'authenticated', 'authenticated', now(), now(),
    '', '', '', ''
  ),
  (
    '33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
    'oceanz@flunify.id', crypt('Terapis@Flunify2026', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"],"role":"therapist"}'::jsonb,
    '{"full_name":"Achmad Agam","username":"oceanz","title":"Terapis Wicara"}'::jsonb,
    'authenticated', 'authenticated', now(), now(),
    '', '', '', ''
  ),
  (
    '44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
    'terapis.wicara@flunify.id', crypt('Terapis@Flunify2026', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"],"role":"therapist"}'::jsonb,
    '{"full_name":"Someone","username":"terapis.wicara","title":"Terapis Wicara"}'::jsonb,
    'authenticated', 'authenticated', now(), now(),
    '', '', '', ''
  );

-- Masukkan ke auth.identities
insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
  ('22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', '22222222-2222-2222-2222-222222222222', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'email', 'aku.admin@flunify.id'), 'email', now(), now(), now()),
  ('33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', '33333333-3333-3333-3333-333333333333', json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'email', 'oceanz@flunify.id'), 'email', now(), now(), now()),
  ('44444444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', '44444444-4444-4444-4444-444444444444', json_build_object('sub', '44444444-4444-4444-4444-444444444444', 'email', 'terapis.wicara@flunify.id'), 'email', now(), now(), now())
on conflict (id) do nothing;

-- Masukkan profil ke public.profiles
insert into public.profiles (id, full_name, username, email, account_type, status)
values
  ('22222222-2222-2222-2222-222222222222', 'Azzahrah', 'aku.admin', 'aku.admin@flunify.id', 'admin', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'Achmad Agam', 'oceanz', 'oceanz@flunify.id', 'therapist', 'active'),
  ('44444444-4444-4444-4444-444444444444', 'Someone', 'terapis.wicara', 'terapis.wicara@flunify.id', 'therapist', 'active')
on conflict (id) do update set
  full_name = excluded.full_name,
  username = excluded.username,
  email = excluded.email,
  account_type = excluded.account_type,
  status = excluded.status;

-- =====================================================================
-- SEED DATA AWAL: Klien & Asesmen Percontohan (Table Editor Terisi)
-- =====================================================================
do $$
declare
  t_id uuid;
  c1_id uuid;
  c2_id uuid;
  c3_id uuid;
  a1_id uuid := 'aaaaaaaa-1111-1111-1111-111111111111';
  a2_id uuid := 'aaaaaaaa-2222-2222-2222-222222222222';
  a3_id uuid := 'aaaaaaaa-3333-3333-3333-333333333333';
begin
  select id into t_id from auth.users where email = 'terapis.wicara@flunify.id' limit 1;

  if t_id is not null then
    -- Clients percontohan
    insert into public.clients (client_code, age)
    values ('C001', 8)
    on conflict (client_code) do update set age = excluded.age
    returning id into c1_id;

    insert into public.clients (client_code, age)
    values ('C002', 14)
    on conflict (client_code) do update set age = excluded.age
    returning id into c2_id;

    insert into public.clients (client_code, age)
    values ('C003', 6)
    on conflict (client_code) do update set age = excluded.age
    returning id into c3_id;

    if c1_id is null then select id into c1_id from public.clients where client_code = 'C001'; end if;
    if c2_id is null then select id into c2_id from public.clients where client_code = 'C002'; end if;
    if c3_id is null then select id into c3_id from public.clients where client_code = 'C003'; end if;

    -- Asesmen percontohan
    insert into public.assessments (id, client_id, therapist_id, assessment_date, case_history, therapist_notes, total_syllables, stuttered_syllables)
    values 
      (a1_id, c1_id, t_id, current_date - 5, 'Keluhan gagap mulai muncul usia 5 tahun, meningkat saat berbicara di depan kelas.', 'Menunjukkan perbaikan pada tugas membaca santai.', 320, 24),
      (a2_id, c2_id, t_id, current_date - 3, 'Gagap berupa blocking dan pemanjangan suara saat gugup atau menjawab pertanyaan guru.', 'Perlu latihan kontrol pernapasan diafragma dan teknik prolongation.', 280, 14),
      (a3_id, c3_id, t_id, current_date - 1, 'Pengulangan suku kata awal kata cukup sering pada percakapan spontan.', 'Responsif terhadap pendekatan penguatan kelancaran bicara.', 300, 33)
    on conflict (id) do nothing;

    -- Observasi tugas bicara & ketidaklancaran
    insert into public.observations (assessment_id, category, label)
    values
      (a1_id, 'speech_task', 'Bicara spontan'),
      (a1_id, 'speech_task', 'Membaca'),
      (a1_id, 'disfluency', 'Pengulangan bunyi/suku kata'),
      (a1_id, 'disfluency', 'Perilaku penyerta'),
      (a2_id, 'speech_task', 'Menjawab pertanyaan'),
      (a2_id, 'disfluency', 'Blocking'),
      (a2_id, 'disfluency', 'Pemanjangan bunyi (prolongation)'),
      (a3_id, 'speech_task', 'Bercerita'),
      (a3_id, 'disfluency', 'Pengulangan kata utuh'),
      (a3_id, 'disfluency', 'Interjeksi / jeda')
    on conflict do nothing;
  end if;
end $$;

-- Izin schema public
grant usage on schema public to anon, authenticated;
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant all on all routines in schema public to anon, authenticated;

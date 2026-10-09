-- ============================================================================
-- Atlas — Supabase schema
-- ----------------------------------------------------------------------------
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query -> paste this whole
-- file -> press "Run". It is idempotent (safe to run more than once).
--
-- What this replaces: the six Base44 entities (University, Essay, Material,
-- Profile, RoadmapTask, CollegeKnowledge) with Postgres tables, plus the
-- Base44 "UploadPublicFile" integration with a public Storage bucket.
-- applicant_knowledge (the AI Knowledge Base) has no Base44 original; it is new.
-- Row-level security mirrors the old Base44 RLS: every row is visible and
-- editable only by the user who created it (created_by_id = auth.uid()).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. universities  (entity: University)
-- ---------------------------------------------------------------------------
create table if not exists public.universities (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  name text not null,
  country text not null check (country in ('US', 'UK')),
  major text,
  application_type text,
  deadline date,
  status text not null default 'researching'
    check (status in ('researching', 'in_progress', 'submitted', 'decided')),
  notes text,
  color text not null default '#1e293b'
);

-- ---------------------------------------------------------------------------
-- 2. essays  (entity: Essay)
-- ---------------------------------------------------------------------------
create table if not exists public.essays (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  university_id text,
  university_name text,
  title text not null,
  prompt text,
  word_limit numeric,
  content text,
  status text not null default 'not_started'
    check (status in ('not_started', 'drafting', 'in_review', 'polishing', 'final')),
  type text not null default 'supplemental'
    check (type in ('personal_statement', 'supplemental', 'why_this_school', 'activity', 'scholarship', 'other')),
  scope text not null default 'university_specific'
    check (scope in ('university_specific', 'common')),
  application_platform text not null default 'common_app'
    check (application_platform in ('common_app', 'uc', 'coalition', 'ucas', 'direct', 'other')),
  review_notes text
);

-- ---------------------------------------------------------------------------
-- 3. materials  (entity: Material)
-- ---------------------------------------------------------------------------
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  type text not null default 'document'
    check (type in ('document', 'link', 'essay', 'sample_essay', 'resume', 'transcript', 'award', 'note', 'other')),
  content text,
  file_url text,
  link_url text,
  notes text
);

-- ---------------------------------------------------------------------------
-- 4. profiles  (entity: Profile — one logical applicant profile per user)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  nationality text,
  school_system text default 'Japanese Public'
    check (school_system in ('Japanese Public', 'Japanese Private', 'US', 'UK', 'IB World School', 'Other')),
  graduation_year text,
  background_summary text,
  ib_predicted_score numeric,
  ib_subjects text,
  gpa_value text,
  gpa_scale text,
  sat_math numeric,
  sat_ebrw numeric,
  additional_test_info text,
  ielts_listening numeric,
  ielts_reading numeric,
  ielts_writing numeric,
  ielts_speaking numeric,
  activities jsonb default '[]'::jsonb,
  honors jsonb default '[]'::jsonb,
  activities_awards text,
  requires_financial_aid boolean default true,
  financial_aid_notes text,
  education_notes text,
  additional_context text
);

-- ---------------------------------------------------------------------------
-- 5. roadmap_tasks  (entity: RoadmapTask)
-- ---------------------------------------------------------------------------
create table if not exists public.roadmap_tasks (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  university_id text not null,
  title text not null,
  description text,
  category text not null default 'application_platform'
    check (category in ('testing', 'application_platform', 'academic_records', 'essays',
                        'recommendations', 'financial', 'interview', 'portfolio',
                        'submission', 'post_submission')),
  completed boolean not null default false,
  "order" numeric not null default 0
);

-- ---------------------------------------------------------------------------
-- 6. college_knowledge  (entity: CollegeKnowledge — deep research per college)
-- ---------------------------------------------------------------------------
create table if not exists public.college_knowledge (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  university_name text not null,
  knowledge text,
  last_updated timestamptz,
  source_url text,
  source_text text,
  research_provider text,
  research_model text,
  grounded boolean not null default false
);

-- ---------------------------------------------------------------------------
-- 7. applicant_knowledge  (entity: ApplicantKnowledge — the AI Knowledge Base)
--    kind:   brief    = about you (personality, actions, mindset, goals)
--            evidence = personal points you can draw on in an essay
--            pattern  = what successful applications share (from sample essays)
--    origin: ai       = written by Atlas; a rebuild replaces these rows, but only
--                       for the kinds it rebuilds
--            manual   = written or edited by you; a rebuild never removes these
-- ---------------------------------------------------------------------------
create table if not exists public.applicant_knowledge (
  id uuid primary key default gen_random_uuid(),
  created_by_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  kind text not null check (kind in ('brief', 'evidence', 'pattern')),
  category text not null default 'other',
  text text not null,
  origin text not null default 'manual' check (origin in ('ai', 'manual')),
  source_label text,
  source_id text,
  platform text not null default 'General',
  sort_order integer not null default 0,
  data jsonb
);

create index if not exists applicant_knowledge_owner_idx
  on public.applicant_knowledge (created_by_id, kind, sort_order);

-- ---------------------------------------------------------------------------
-- RLS + updated_at triggers for all seven tables
-- (Policies mirror the old Base44 entity RLS: own rows only.)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['universities','essays','materials','profiles','roadmap_tasks','college_knowledge','applicant_knowledge'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists own_select on public.%I', t);
    execute format('drop policy if exists own_insert on public.%I', t);
    execute format('drop policy if exists own_update on public.%I', t);
    execute format('drop policy if exists own_delete on public.%I', t);

    execute format('create policy own_select on public.%I for select using (created_by_id = (select auth.uid()))', t);
    execute format('create policy own_insert on public.%I for insert with check (created_by_id = (select auth.uid()))', t);
    execute format('create policy own_update on public.%I for update using (created_by_id = (select auth.uid())) with check (created_by_id = (select auth.uid()))', t);
    execute format('create policy own_delete on public.%I for delete using (created_by_id = (select auth.uid()))', t);

    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- ===========================================================================
-- 7. Upgrades (idempotent, and safe to skip entirely)
-- ===========================================================================
-- ---------------------------------------------------------------------------
-- The app runs correctly without the columns below: anything not present is
-- simply skipped on save, and the UI shows a one-line reminder instead of
-- failing. Re-running this whole file is always safe.
--
--   universities.application_platform -> which application system the school
--                                          uses, so shared essays attach to
--                                          the right schools (Common App / UC /
--                                          UCAS / Coalition / direct).
--   essays.limit_unit                 -> 'words' (default) or 'characters'.
--                                          UCAS is character-counted; without
--                                          the column Atlas still counts UCAS
--                                          essays in characters.
--   materials.analysis                -> the saved AI analysis of the document
--                                          (read from the uploaded file or link).
--   profiles.*                        -> the extra applicant context that makes
--                                          a review accurate for international
--                                          applicants (citizenship status,
--                                          curriculum, class rank, ACT, TOEFL,
--                                          Duolingo, first-generation, funding).

alter table public.universities add column if not exists application_platform text;

alter table public.essays add column if not exists limit_unit text;

alter table public.materials add column if not exists analysis jsonb;

-- Knowledge Base source and provider provenance; safe to apply repeatedly.
alter table public.college_knowledge add column if not exists source_url text;
alter table public.college_knowledge add column if not exists source_text text;
alter table public.college_knowledge add column if not exists research_provider text;
alter table public.college_knowledge add column if not exists research_model text;
alter table public.college_knowledge add column if not exists grounded boolean not null default false;

alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists citizenship_status text;
alter table public.profiles add column if not exists curriculum text;
alter table public.profiles add column if not exists first_generation text;
alter table public.profiles add column if not exists rank text;
alter table public.profiles add column if not exists act_score numeric;
alter table public.profiles add column if not exists toefl_total numeric;
alter table public.profiles add column if not exists duolingo_english numeric;
alter table public.profiles add column if not exists test_policy text;
alter table public.profiles add column if not exists funding_source text;

-- materials.type must accept sample_essay (someone else's successful essay).
-- The original inline check does not, and create table if not exists will not
-- update it. Drop whichever type check is present and replace it.
do $$
declare cname text;
begin
  for cname in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.materials'::regclass
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%type%'
  loop
    execute format('alter table public.materials drop constraint %I', cname);
  end loop;
end $$;

alter table public.materials
  add constraint materials_type_check
  check (type in ('document', 'link', 'essay', 'sample_essay', 'resume', 'transcript', 'award', 'note', 'other'));

-- ---------------------------------------------------------------------------
-- Storage: public "uploads" bucket (replaces Base44 UploadPublicFile)
-- Files are stored under {user-id}/{timestamp}-{filename}; users can only
-- write inside their own folder. Downloads are public (readable file URLs).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do nothing;

drop policy if exists "uploads_insert_own" on storage.objects;
drop policy if exists "uploads_update_own" on storage.objects;
drop policy if exists "uploads_delete_own" on storage.objects;
drop policy if exists "uploads_select_all" on storage.objects;

create policy "uploads_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "uploads_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "uploads_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "uploads_select_all" on storage.objects
  for select
  using (bucket_id = 'uploads');

-- PostgREST caches the schema. Without this, a column or check added above
-- is invisible until the project restarts, and the app reports it as missing.
notify pgrst, 'reload schema';

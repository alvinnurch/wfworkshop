-- ══════════════════════════════════════════════════════════════
--  Platform Workshop Terintegrasi — skema basis data Supabase
--  Jalankan SEKALI di Supabase → SQL Editor → New query → Run.
--  Aman dijalankan ulang (memakai "if not exists" / "or replace").
-- ══════════════════════════════════════════════════════════════

-- ── 1. Susunan workshop (sesi + materi) ──────────────────────
-- Disimpan sebagai satu dokumen JSON: admin menyimpan utuh saat
-- menekan "Simpan perubahan", jadi tidak ada masalah geser kolom.
create table if not exists workshop_config (
  id         int primary key default 1,
  doc        jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into workshop_config (id, doc) values (1, '{}'::jsonb)
  on conflict (id) do nothing;

-- ── 2. Status langsung (dipakai peserta & proyektor) ─────────
create table if not exists live_state (
  id                int primary key default 1,
  active_session_id text,
  active_block_id   text,
  run               jsonb,
  open_blocks       jsonb not null default '{}'::jsonb,
  updated_at        timestamptz not null default now()
);
insert into live_state (id) values (1) on conflict (id) do nothing;

-- ── 3. Peserta ───────────────────────────────────────────────
create table if not exists participants (
  id     text primary key,
  name   text not null,
  code   text not null,
  grp    text,
  org    text,
  phone  text,
  email  text
);
create unique index if not exists participants_code_idx on participants (upper(code));

-- ── 4. Jawaban & kehadiran ───────────────────────────────────
create table if not exists checkins (
  session_id     text not null,
  participant_id text not null,
  at_label       text,
  method         text,
  created_at     timestamptz not null default now(),
  primary key (session_id, participant_id)
);

create table if not exists quiz_answers (
  session_id     text not null,
  block_id       text not null,
  participant_id text not null,
  score          int  not null default 0,
  answers        jsonb not null default '[]'::jsonb,
  tries          int  not null default 1,
  updated_at     timestamptz not null default now(),
  primary key (session_id, block_id, participant_id)
);

create table if not exists words (
  id             bigserial primary key,
  session_id     text not null,
  block_id       text not null,
  participant_id text not null,
  word           text not null,
  created_at     timestamptz not null default now()
);
create index if not exists words_block_idx on words (session_id, block_id);

create table if not exists feedback (
  session_id     text not null,
  block_id       text not null,
  participant_id text not null,
  emoji          text,
  note           text,
  updated_at     timestamptz not null default now(),
  primary key (session_id, block_id, participant_id)
);

create table if not exists form_answers (
  session_id     text not null,
  block_id       text not null,
  participant_id text not null,
  field_id       text not null,
  value          text,
  file_name      text,
  updated_at     timestamptz not null default now(),
  primary key (session_id, block_id, participant_id, field_id)
);

-- ── 5. Kata sandi admin ──────────────────────────────────────
-- Tabel ini TIDAK bisa dibaca publik; hanya dipakai fungsi di bawah.
create table if not exists admin_secret (
  id       int primary key default 1,
  password text not null
);
insert into admin_secret (id, password) values (1, 'gantiSandiIni')
  on conflict (id) do nothing;

-- ── 6. Fungsi tulis yang butuh sandi admin ───────────────────
create or replace function save_config(p_password text, p_doc jsonb)
returns void language plpgsql security definer as $$
begin
  if p_password is null or p_password <> (select password from admin_secret where id = 1) then
    raise exception 'unauthorized';
  end if;
  update workshop_config set doc = p_doc, updated_at = now() where id = 1;
end $$;

create or replace function save_participants(p_password text, p_rows jsonb)
returns void language plpgsql security definer as $$
begin
  if p_password is null or p_password <> (select password from admin_secret where id = 1) then
    raise exception 'unauthorized';
  end if;
  delete from participants;
  insert into participants (id, name, code, grp, org, phone, email)
  select x->>'id', x->>'name', x->>'code', x->>'group', x->>'org', x->>'phone', x->>'email'
  from jsonb_array_elements(p_rows) as x;
end $$;

create or replace function save_live(
  p_password text, p_session text, p_block text, p_run jsonb, p_open jsonb
) returns void language plpgsql security definer as $$
begin
  if p_password is null or p_password <> (select password from admin_secret where id = 1) then
    raise exception 'unauthorized';
  end if;
  update live_state
     set active_session_id = p_session, active_block_id = p_block,
         run = p_run, open_blocks = coalesce(p_open, '{}'::jsonb), updated_at = now()
   where id = 1;
end $$;

-- Kirim jawaban kuis dengan penegakan batas pengulangan di server.
create or replace function submit_quiz(
  p_session text, p_block text, p_participant text, p_answers jsonb, p_score int, p_max_tries int
) returns int language plpgsql security definer as $$
declare v_tries int;
begin
  select tries into v_tries from quiz_answers
   where session_id = p_session and block_id = p_block and participant_id = p_participant;
  v_tries := coalesce(v_tries, 0) + 1;
  if v_tries > greatest(1, coalesce(p_max_tries, 1)) then
    raise exception 'Kesempatan mengerjakan kuis sudah terpakai (%x).', greatest(1, coalesce(p_max_tries, 1));
  end if;
  insert into quiz_answers (session_id, block_id, participant_id, score, answers, tries, updated_at)
  values (p_session, p_block, p_participant, coalesce(p_score, 0), coalesce(p_answers, '[]'::jsonb), v_tries, now())
  on conflict (session_id, block_id, participant_id)
  do update set score = excluded.score, answers = excluded.answers, tries = excluded.tries, updated_at = now();
  return v_tries;
end $$;

create or replace function reset_responses(p_password text)
returns void language plpgsql security definer as $$
begin
  if p_password is null or p_password <> (select password from admin_secret where id = 1) then
    raise exception 'unauthorized';
  end if;
  delete from checkins; delete from quiz_answers; delete from words;
  delete from feedback; delete from form_answers;
end $$;

-- ── 7. Keamanan baris (RLS) ──────────────────────────────────
alter table workshop_config enable row level security;
alter table live_state      enable row level security;
alter table participants    enable row level security;
alter table checkins        enable row level security;
alter table quiz_answers    enable row level security;
alter table words           enable row level security;
alter table feedback        enable row level security;
alter table form_answers    enable row level security;
alter table admin_secret    enable row level security;   -- tanpa policy = tertutup rapat

do $$
declare t text;
begin
  -- semua orang boleh MEMBACA (peserta & proyektor butuh ini)
  foreach t in array array['workshop_config','live_state','participants','checkins','quiz_answers','words','feedback','form_answers']
  loop
    execute format('drop policy if exists "baca_publik" on %I', t);
    execute format('create policy "baca_publik" on %I for select using (true)', t);
  end loop;

  -- peserta boleh MENULIS hanya di tabel jawaban
  foreach t in array array['checkins','quiz_answers','words','feedback','form_answers']
  loop
    execute format('drop policy if exists "tulis_peserta" on %I', t);
    execute format('drop policy if exists "ubah_peserta" on %I', t);
    execute format('create policy "tulis_peserta" on %I for insert with check (true)', t);
    execute format('create policy "ubah_peserta" on %I for update using (true)', t);
  end loop;
end $$;

-- Susunan sesi, daftar peserta, dan status langsung HANYA bisa diubah
-- lewat fungsi di atas (butuh sandi admin), bukan langsung dari halaman.

-- ── 8. Realtime ──────────────────────────────────────────────
do $$
begin
  begin execute 'alter publication supabase_realtime add table workshop_config'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table live_state';      exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table participants';    exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table checkins';        exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table quiz_answers';    exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table words';           exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table feedback';        exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table form_answers';    exception when others then null; end;
end $$;

-- ══════════════════════════════════════════════════════════════
--  Selesai. Jangan lupa ganti sandi admin:
--    update admin_secret set password = 'SandiPanitiaAnda' where id = 1;
-- ══════════════════════════════════════════════════════════════

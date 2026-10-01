-- 001_esquema.sql — esquema do LUCAS no Supabase.
-- SPEC secao 10. O Supabase apenas arquiva e compartilha; nunca processa.
-- Nenhuma tabela tem campo para chave de API (principio P3).
-- Rodar no editor SQL do projeto ou via `supabase db push`.

-- =====================================================================
-- Tabelas
-- =====================================================================

create table if not exists perfis (
  id uuid primary key references auth.users on delete cascade,
  nome text not null,
  unidade text,
  criado_em timestamptz default now()
);

create table if not exists documentos (
  id uuid primary key default gen_random_uuid(),
  dono uuid not null references auth.users on delete cascade,
  titulo text not null,
  origem text not null check (origem in ('docx','pdf','txt','colado','digitado')),
  estado jsonb not null,          -- parágrafos, versões, notas, apêndice
  arquivo_path text,              -- caminho no Storage, se houver original
  metricas jsonb,                 -- índice do documento e distribuição
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

create table if not exists prompts (
  id uuid primary key default gen_random_uuid(),
  dono uuid references auth.users on delete cascade,   -- nulo = oficial
  codigo text,                    -- P1..P7 para oficiais
  nome text not null,
  descricao text not null,
  instrucao text not null,
  oficial boolean not null default false,
  compartilhado boolean not null default false,
  criado_em timestamptz default now()
);

create table if not exists verbetes (
  id uuid primary key default gen_random_uuid(),
  dono uuid references auth.users on delete cascade,   -- nulo = oficial
  termo text not null,
  variantes text[] default '{}',
  tratamento text not null check (tratamento in ('substituir','explicar')),
  simples text,
  explicacao text not null,
  exemplo text,
  sinonimos text[] default '{}',
  categoria text,
  fonte text,
  oficial boolean not null default false,
  compartilhado boolean not null default false,
  criado_em timestamptz default now(),
  -- Implementa o principio P9 no banco: termo protegido nunca tem substituicao.
  constraint simples_coerente check (
    (tratamento = 'substituir' and simples is not null) or
    (tratamento = 'explicar'   and simples is null)
  )
);

create table if not exists registro_revisao (
  id uuid primary key default gen_random_uuid(),
  dono uuid not null references auth.users on delete cascade,
  documento_id uuid references documentos on delete set null,
  paragrafo text,
  acao text not null,             -- versao_ia, troca_dicionario, nota, apendice, sinonimo
  prompt_codigo text,
  provedor text,
  modelo text,
  faixa_antes text,
  faixa_depois text,
  facilidade_antes numeric,
  facilidade_depois numeric,
  alertas jsonb,
  decisao text not null check (decisao in ('aceita','descartada','aceita_com_alerta')),
  revisor text,
  observacao text,
  criado_em timestamptz default now()
);

-- =====================================================================
-- Row Level Security (SPEC 10.4). Ativar em todas as tabelas.
-- =====================================================================

alter table perfis            enable row level security;
alter table documentos        enable row level security;
alter table prompts           enable row level security;
alter table verbetes          enable row level security;
alter table registro_revisao  enable row level security;

-- perfis: o próprio usuário lê e escreve o seu.
create policy perfis_sel on perfis for select using (auth.uid() = id);
create policy perfis_ins on perfis for insert with check (auth.uid() = id);
create policy perfis_upd on perfis for update using (auth.uid() = id) with check (auth.uid() = id);
create policy perfis_del on perfis for delete using (auth.uid() = id);

-- documentos: somente o dono, em tudo.
create policy documentos_sel on documentos for select using (auth.uid() = dono);
create policy documentos_ins on documentos for insert with check (auth.uid() = dono);
create policy documentos_upd on documentos for update using (auth.uid() = dono) with check (auth.uid() = dono);
create policy documentos_del on documentos for delete using (auth.uid() = dono);

-- prompts: oficiais para todos; próprios para o dono; compartilhados para autenticados.
-- Escrita: somente o dono, e apenas em não oficiais.
create policy prompts_sel on prompts for select using (
  oficial = true
  or auth.uid() = dono
  or (compartilhado = true and auth.role() = 'authenticated')
);
create policy prompts_ins on prompts for insert with check (auth.uid() = dono and oficial = false);
create policy prompts_upd on prompts for update using (auth.uid() = dono and oficial = false)
  with check (auth.uid() = dono and oficial = false);
create policy prompts_del on prompts for delete using (auth.uid() = dono and oficial = false);

-- verbetes: oficiais para todos, inclusive anônimo; próprios e compartilhados para autenticados.
-- Escrita: somente o dono, e apenas em não oficiais.
create policy verbetes_sel on verbetes for select using (
  oficial = true
  or auth.uid() = dono
  or (compartilhado = true and auth.role() = 'authenticated')
);
create policy verbetes_ins on verbetes for insert with check (auth.uid() = dono and oficial = false);
create policy verbetes_upd on verbetes for update using (auth.uid() = dono and oficial = false)
  with check (auth.uid() = dono and oficial = false);
create policy verbetes_del on verbetes for delete using (auth.uid() = dono and oficial = false);

-- registro_revisao: somente o dono; apenas inserção (trilha de auditoria imutável).
create policy registro_sel on registro_revisao for select using (auth.uid() = dono);
create policy registro_ins on registro_revisao for insert with check (auth.uid() = dono);
-- Sem policy de update nem de delete: com RLS ativo, a ausência de policy proíbe a operação.

-- =====================================================================
-- Storage: bucket privado para os arquivos originais (SPEC 10.5).
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('originais', 'originais', false, 20971520)  -- 20 MB
on conflict (id) do nothing;

-- Cada usuário lê e grava apenas sob o próprio identificador (path: <uid>/<doc>/<arquivo>).
create policy originais_sel on storage.objects for select
  using (bucket_id = 'originais' and (storage.foldername(name))[1] = auth.uid()::text);
create policy originais_ins on storage.objects for insert
  with check (bucket_id = 'originais' and (storage.foldername(name))[1] = auth.uid()::text);
create policy originais_upd on storage.objects for update
  using (bucket_id = 'originais' and (storage.foldername(name))[1] = auth.uid()::text);
create policy originais_del on storage.objects for delete
  using (bucket_id = 'originais' and (storage.foldername(name))[1] = auth.uid()::text);

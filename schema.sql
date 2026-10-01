-- =============================================================
--  LUCAS · Enquetes de Linguagem Simples
--  schema.sql  ·  rode este arquivo inteiro no SQL Editor do Supabase
-- =============================================================
--  Arquitetura de segurança (leia antes de mudar qualquer coisa):
--
--  • As 5 tabelas ficam com RLS LIGADO e SEM POLICIES.
--    Isso, no Postgres, significa: o papel "anon" (a chave pública
--    que vai no index.html) NÃO consegue ler nem escrever direto
--    em tabela nenhuma. Zero acesso direto.
--
--  • TODO acesso passa por funções RPC marcadas como SECURITY DEFINER.
--    Elas rodam com o dono do banco (que ignora RLS) e devolvem
--    APENAS o que cada tela precisa — nunca o hash da chave, nunca
--    o e-mail de quem criou. É aqui que a segurança mora.
--
--  • A "chave de autor" nasce no servidor, é devolvida UMA vez em
--    texto puro e guardada só como hash (bcrypt). Formato:
--        LS-CODIGO-SEGREDO        ex.: LS-7K2P9X-A3F8Q1
--    O CODIGO também é o que vai no link de votar (?e=CODIGO),
--    então a função consegue achar a enquete sem varrer a tabela.
--
--  • Resgate de chave perdida: função admin_reemitir_chave(), que
--    NÃO é executável por anon. Você roda direto no SQL Editor
--    (que age como dono). Não existe tela de admin no app.
-- =============================================================

-- pgcrypto: no Supabase já vem habilitado no schema "extensions".
-- O "if not exists" só garante idempotência.
create extension if not exists pgcrypto with schema extensions;


-- =========================== TABELAS ===========================

-- quem cria enquetes (nome + e-mail servem só para o resgate de chave;
-- nunca são expostos a quem vota)
create table if not exists autores (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  email      text not null,
  criado_em  timestamptz not null default now()
);

create table if not exists enquetes (
  id                 uuid primary key default gen_random_uuid(),
  codigo             text unique not null,          -- vai no link ?e=CODIGO (público)
  chave_codigo       text unique,                   -- código DA CHAVE (LS-<chave_codigo>-<segredo>);
                                                     -- independente do código do link, nunca exposto
  titulo             text not null,                 -- "o que você quer deixar mais claro?"
  contexto           text,                          -- explicação opcional
  autor_id           uuid references autores(id),
  chave_hash         text not null,                 -- bcrypt do segredo (nunca o segredo)
  tipo_voto          text not null default 'aprovacao'  check (tipo_voto in ('aprovacao','unico')),
  mostrar_resultado  text not null default 'fim'        check (mostrar_resultado in ('fim','vivo')),
  prazo              timestamptz,
  encerrada          boolean not null default false,
  criada_em          timestamptz not null default now()
);

-- migração idempotente: bancos criados ANTES do desacoplamento da chave não
-- têm a coluna chave_codigo (o "create table if not exists" acima é no-op neles).
-- Estas três linhas adicionam a coluna, preservam as chaves já emitidas
-- (chave_codigo = codigo) e garantem a unicidade. Rodar de novo não faz mal.
alter table enquetes add column if not exists chave_codigo text;
update enquetes set chave_codigo = codigo where chave_codigo is null;
create unique index if not exists enquetes_chave_codigo_key on enquetes (chave_codigo);

-- cada forma de dizer a mesma coisa; pendentes precisam ser aprovadas pelo autor
create table if not exists redacoes (
  id             uuid primary key default gen_random_uuid(),
  enquete_id     uuid not null references enquetes(id) on delete cascade,
  texto          text not null,
  status         text not null default 'aprovada'  check (status in ('aprovada','pendente','recusada')),
  sugerida_por   text,                            -- nome de quem sugeriu (se veio de votante)
  sugerido_email text,                            -- e-mail de quem sugeriu (responsabilização; só o autor vê)
  criada_em      timestamptz not null default now()
);

-- migração idempotente: bancos antigos ganham a coluna de e-mail do sugeridor
alter table redacoes add column if not exists sugerido_email text;

-- um voto = uma pessoa/navegador. O token vem do localStorage.
create table if not exists votos (
  id          uuid primary key default gen_random_uuid(),
  enquete_id  uuid not null references enquetes(id) on delete cascade,
  token       text not null,
  nome        text,
  comentario  text,
  criado_em   timestamptz not null default now(),
  unique (enquete_id, token)                      -- 1 voto por navegador por enquete
);

-- ligação N:N — é o que permite o "voto de aprovação" (marcar várias)
-- e a expansão futura (comentários, distribuição) sem migrar nada.
create table if not exists voto_redacao (
  voto_id    uuid not null references votos(id) on delete cascade,
  redacao_id uuid not null references redacoes(id) on delete cascade,
  primary key (voto_id, redacao_id)
);

-- índices que importam para as consultas das telas
create index if not exists idx_redacoes_enquete on redacoes (enquete_id, status);
create index if not exists idx_votos_enquete     on votos (enquete_id);
create index if not exists idx_vr_redacao        on voto_redacao (redacao_id);


-- ===================== RLS: TRANCA TUDO ========================
-- RLS ligado + nenhuma policy = anon não acessa tabela direto.
-- (As RPCs abaixo é que fazem o trabalho, com SECURITY DEFINER.)
alter table autores      enable row level security;
alter table enquetes     enable row level security;
alter table redacoes     enable row level security;
alter table votos        enable row level security;
alter table voto_redacao enable row level security;


-- ========================= HELPERS =============================

-- código curto e legível (sem caracteres ambíguos: 0/O, 1/I/L)
create or replace function gerar_codigo()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  out   text := '';
  i     int;
begin
  for i in 1..6 loop
    out := out || substr(chars, floor(random()*length(chars))::int + 1, 1);
  end loop;
  return out;
end;
$$;

-- valida a chave de autor (LS-CODIGO-SEGREDO) e devolve a enquete.
-- INTERNA: não é executável por anon (ver grants no fim).
create or replace function _validar_chave(p_chave text)
returns enquetes
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  partes  text[];
  v_enq   enquetes;
begin
  partes := string_to_array(coalesce(p_chave,''), '-');
  if array_length(partes,1) <> 3 or partes[1] <> 'LS' then
    raise exception 'Chave inválida';
  end if;

  -- a chave referencia chave_codigo (NÃO o código público do link)
  select * into v_enq from enquetes where chave_codigo = upper(partes[2]);
  if not found then
    raise exception 'Chave inválida';
  end if;

  if crypt(partes[3], v_enq.chave_hash) <> v_enq.chave_hash then
    raise exception 'Chave inválida';
  end if;

  return v_enq;
end;
$$;


-- ===================== RPCs PÚBLICAS ===========================

-- criar enquete (até 8 versões iniciais). Devolve { codigo, chave }.
-- (o param de prazo mudou de p_prazo_horas para p_prazo_min; o Postgres não
--  deixa renomear parâmetro num "create or replace", então dropamos antes.)
drop function if exists criar_enquete(text, text, text, text, text[], text, text, int);
create or replace function criar_enquete(
  p_titulo            text,
  p_contexto          text,
  p_nome              text,
  p_email             text,
  p_redacoes          text[],
  p_tipo_voto         text default 'aprovacao',
  p_mostrar_resultado text default 'fim',
  p_prazo_min         int  default 2880   -- prazo em MINUTOS (5 min … 7 dias)
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_autor        uuid;
  v_codigo       text;
  v_chave_codigo text;
  v_segredo      text;
  v_enq          uuid;
  v_txt          text;
  v_n            int;
begin
  -- validações
  if length(trim(coalesce(p_titulo,''))) = 0 then
    raise exception 'Diga o que você quer deixar mais claro';
  end if;
  if length(trim(coalesce(p_nome,''))) = 0 or length(trim(coalesce(p_email,''))) = 0 then
    raise exception 'Preencha seu nome e e-mail';
  end if;

  -- versões iniciais são OPCIONAIS: o autor pode abrir só com o texto difícil
  -- (modo "coleta de sugestões"). Só limita o teto de 8.
  v_n := coalesce(array_length(p_redacoes, 1), 0);
  if v_n > 8 then
    raise exception 'Máximo de 8 versões por enquete';
  end if;
  if p_tipo_voto not in ('aprovacao','unico') then
    raise exception 'Tipo de voto inválido';
  end if;
  if p_mostrar_resultado not in ('fim','vivo') then
    raise exception 'Opção de resultado inválida';
  end if;
  -- teto anti-abuso: ninguém cola um livro inteiro
  if length(coalesce(p_titulo,'')) > 800 or length(coalesce(p_contexto,'')) > 800 then
    raise exception 'Texto longo demais (máx. 800 caracteres)';
  end if;

  insert into autores (nome, email)
    values (trim(p_nome), lower(trim(p_email)))
    returning id into v_autor;

  -- código público único (vai no link)
  loop
    v_codigo := gerar_codigo();
    exit when not exists (select 1 from enquetes where codigo = v_codigo);
  end loop;

  -- código DA CHAVE: independente do código público, único entre as chaves
  loop
    v_chave_codigo := gerar_codigo();
    exit when not exists (select 1 from enquetes where chave_codigo = v_chave_codigo);
  end loop;

  -- segredo nasce aqui, guardamos só o hash
  v_segredo := upper(substr(encode(gen_random_bytes(6),'hex'), 1, 6));

  insert into enquetes
    (codigo, chave_codigo, titulo, contexto, autor_id, chave_hash, tipo_voto, mostrar_resultado, prazo)
  values
    (v_codigo, v_chave_codigo, trim(p_titulo), nullif(trim(coalesce(p_contexto,'')),''), v_autor,
     crypt(v_segredo, gen_salt('bf')), p_tipo_voto, p_mostrar_resultado,
     now() + make_interval(mins => least(10080, greatest(5, coalesce(p_prazo_min, 2880)))))
  returning id into v_enq;

  foreach v_txt in array p_redacoes loop
    if length(trim(coalesce(v_txt,''))) > 800 then
      raise exception 'Versão longa demais (máx. 800 caracteres)';
    end if;
    if length(trim(coalesce(v_txt,''))) > 0 then
      insert into redacoes (enquete_id, texto, status)
        values (v_enq, trim(v_txt), 'aprovada');
    end if;
  end loop;

  return json_build_object(
    'codigo', v_codigo,
    'chave',  'LS-' || v_chave_codigo || '-' || v_segredo
  );
end;
$$;

-- dados para a tela de votar (sem nada sensível)
create or replace function obter_para_votar(p_codigo text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enq      enquetes;
  v_redacoes json;
begin
  select * into v_enq from enquetes where codigo = upper(p_codigo);
  if not found then raise exception 'Enquete não encontrada'; end if;

  select coalesce(json_agg(json_build_object('id', id, 'texto', texto) order by criada_em), '[]'::json)
    into v_redacoes
    from redacoes where enquete_id = v_enq.id and status = 'aprovada';

  return json_build_object(
    'codigo',    v_enq.codigo,
    'titulo',    v_enq.titulo,
    'contexto',  v_enq.contexto,
    'tipo_voto', v_enq.tipo_voto,
    'encerrada', v_enq.encerrada or (v_enq.prazo is not null and v_enq.prazo < now()),
    'redacoes',  v_redacoes
  );
end;
$$;

-- registrar voto de aprovação (substitui voto anterior do mesmo token)
create or replace function registrar_voto(
  p_codigo      text,
  p_token       text,
  p_redacao_ids uuid[],
  p_nome        text default null,
  p_comentario  text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enq  enquetes;
  v_voto uuid;
  v_rid  uuid;
begin
  select * into v_enq from enquetes where codigo = upper(p_codigo);
  if not found then raise exception 'Enquete não encontrada'; end if;
  if v_enq.encerrada or (v_enq.prazo is not null and v_enq.prazo < now()) then
    raise exception 'Esta votação já encerrou';
  end if;
  if p_redacao_ids is null or array_length(p_redacao_ids,1) is null then
    raise exception 'Marque ao menos uma versão';
  end if;
  if v_enq.tipo_voto = 'unico' and array_length(p_redacao_ids,1) > 1 then
    raise exception 'Esta enquete aceita só uma escolha';
  end if;

  -- todas as redações têm de ser desta enquete e estar aprovadas
  if exists (
    select 1 from unnest(p_redacao_ids) rid
    where not exists (
      select 1 from redacoes r
      where r.id = rid and r.enquete_id = v_enq.id and r.status = 'aprovada'
    )
  ) then
    raise exception 'Versão inválida';
  end if;

  if length(coalesce(p_comentario,'')) > 800 then
    raise exception 'Comentário longo demais (máx. 800 caracteres)';
  end if;

  delete from votos where enquete_id = v_enq.id and token = p_token;
  insert into votos (enquete_id, token, nome, comentario)
    values (v_enq.id, p_token, nullif(trim(coalesce(p_nome,'')),''), nullif(trim(coalesce(p_comentario,'')),''))
    returning id into v_voto;

  foreach v_rid in array p_redacao_ids loop
    insert into voto_redacao (voto_id, redacao_id) values (v_voto, v_rid);
  end loop;

  return json_build_object('ok', true);
end;
$$;

-- votante sugere uma versão nova (entra como pendente).
-- Exige nome + e-mail: responsabiliza quem sugere (anti-troll) e dá ao autor
-- como avaliar/contatar. O e-mail nunca é exposto ao público, só ao autor.
-- (dropamos a assinatura antiga de 3 args pra não deixar overload órfão)
drop function if exists sugerir_redacao(text, text, text);
create or replace function sugerir_redacao(
  p_codigo text,
  p_texto  text,
  p_nome   text default null,
  p_email  text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enq enquetes;
  v_pend int;
begin
  select * into v_enq from enquetes where codigo = upper(p_codigo);
  if not found then raise exception 'Enquete não encontrada'; end if;
  if v_enq.encerrada or (v_enq.prazo is not null and v_enq.prazo < now()) then
    raise exception 'Esta votação já encerrou';
  end if;
  if length(trim(coalesce(p_texto,''))) = 0 then
    raise exception 'Escreva a sua versão';
  end if;
  if length(trim(coalesce(p_texto,''))) > 800 then
    raise exception 'Versão longa demais (máx. 800 caracteres)';
  end if;
  if length(trim(coalesce(p_nome,''))) = 0 or length(trim(coalesce(p_email,''))) = 0 then
    raise exception 'Informe seu nome e e-mail para sugerir';
  end if;
  if position('@' in p_email) = 0 then
    raise exception 'Confira o e-mail';
  end if;

  select count(*) into v_pend from redacoes where enquete_id = v_enq.id and status = 'pendente';
  if v_pend >= 20 then
    raise exception 'Há muitas sugestões aguardando; tente mais tarde';
  end if;

  insert into redacoes (enquete_id, texto, status, sugerida_por, sugerido_email)
    values (v_enq.id, trim(p_texto), 'pendente',
            trim(p_nome), lower(trim(p_email)));

  return json_build_object('ok', true);
end;
$$;

-- painel do autor (precisa da chave). Traz pendentes + contagem.
create or replace function obter_painel(p_chave text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enq       enquetes;
  v_aprovadas json;
  v_pendentes json;
  v_votos     int;
begin
  v_enq := _validar_chave(p_chave);

  select count(*) into v_votos from votos where enquete_id = v_enq.id;

  select coalesce(json_agg(json_build_object('id', id, 'texto', texto) order by criada_em), '[]'::json)
    into v_aprovadas
    from redacoes where enquete_id = v_enq.id and status = 'aprovada';

  select coalesce(json_agg(json_build_object('id', id, 'texto', texto, 'sugerida_por', sugerida_por, 'sugerido_email', sugerido_email) order by criada_em), '[]'::json)
    into v_pendentes
    from redacoes where enquete_id = v_enq.id and status = 'pendente';

  return json_build_object(
    'codigo',            v_enq.codigo,
    'titulo',            v_enq.titulo,
    'contexto',          v_enq.contexto,
    'tipo_voto',         v_enq.tipo_voto,
    'mostrar_resultado', v_enq.mostrar_resultado,
    'prazo',             v_enq.prazo,
    'encerrada',         v_enq.encerrada or (v_enq.prazo is not null and v_enq.prazo < now()),
    'votos',             v_votos,
    'redacoes',          v_aprovadas,
    'pendentes',         v_pendentes
  );
end;
$$;

-- aprovar/recusar uma sugestão (precisa da chave)
create or replace function curar_redacao(
  p_chave      text,
  p_redacao_id uuid,
  p_acao       text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enq enquetes;
begin
  v_enq := _validar_chave(p_chave);
  if p_acao not in ('aprovar','recusar') then
    raise exception 'Ação inválida';
  end if;

  if p_acao = 'aprovar'
     and (select count(*) from redacoes where enquete_id = v_enq.id and status = 'aprovada') >= 8 then
    raise exception 'Limite de 8 versões atingido';
  end if;

  update redacoes
     set status = case when p_acao = 'aprovar' then 'aprovada' else 'recusada' end
   where id = p_redacao_id and enquete_id = v_enq.id and status = 'pendente';

  if not found then raise exception 'Sugestão não encontrada'; end if;
  return json_build_object('ok', true);
end;
$$;

-- encerrar a votação antes do prazo (precisa da chave)
create or replace function encerrar_enquete(p_chave text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enq enquetes;
begin
  v_enq := _validar_chave(p_chave);
  update enquetes set encerrada = true where id = v_enq.id;
  return json_build_object('ok', true);
end;
$$;

-- editar APENAS o contexto da enquete (precisa da chave).
-- O título (texto em votação) é IMUTÁVEL de propósito: mudar o que está
-- em jogo depois de gente ter votado desprestigia a votação. Para trocar
-- o texto ou as versões, cria-se uma nova enquete.
create or replace function editar_enquete(
  p_chave    text,
  p_contexto text
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_enq enquetes;
begin
  v_enq := _validar_chave(p_chave);
  if length(coalesce(p_contexto,'')) > 800 then
    raise exception 'Contexto longo demais (máx. 800 caracteres)';
  end if;
  update enquetes
     set contexto = nullif(trim(coalesce(p_contexto,'')),'')
   where id = v_enq.id;
  return json_build_object('ok', true);
end;
$$;

-- NÃO existe editar_redacao: o autor não pode alterar o texto proposto por
-- outra pessoa (só pode tirá-lo da votação via remover_redacao). Removemos
-- assinaturas antigas, se existirem, por garantia.
drop function if exists editar_redacao(text, uuid, text);
drop function if exists editar_enquete(text, text, text);

-- remover uma versão (precisa da chave). Não deixa a votação sem nenhuma.
create or replace function remover_redacao(
  p_chave      text,
  p_redacao_id uuid
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_enq enquetes;
begin
  v_enq := _validar_chave(p_chave);
  -- pode remover qualquer versão; ficar com 0 é válido (volta ao modo "coleta")
  delete from redacoes where id = p_redacao_id and enquete_id = v_enq.id;
  if not found then raise exception 'Versão não encontrada'; end if;
  return json_build_object('ok', true);
end;
$$;

-- excluir a enquete inteira (precisa da chave). Cascata apaga versões e votos.
create or replace function excluir_enquete(p_chave text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_enq enquetes;
begin
  v_enq := _validar_chave(p_chave);
  delete from enquetes where id = v_enq.id;
  return json_build_object('ok', true);
end;
$$;

-- status em lote para a lista "minhas enquetes" (público, sem nada sensível).
-- Recebe os códigos do link e devolve [{codigo, titulo, encerrada}].
create or replace function status_enquetes(p_codigos text[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res json;
begin
  if p_codigos is null or array_length(p_codigos,1) is null then
    return '[]'::json;
  end if;
  select coalesce(json_agg(json_build_object(
            'codigo',    codigo,
            'titulo',    titulo,
            'encerrada', encerrada or (prazo is not null and prazo < now())
         )), '[]'::json)
    into v_res
    from enquetes
   where codigo = any (select upper(c) from unnest(p_codigos) c);
  return v_res;
end;
$$;

-- resultado/ranking. Respeita "só no fim": só libera se encerrada,
-- se for "ao vivo", ou se quem pede passou a chave de autor.
create or replace function obter_resultado(
  p_codigo text,
  p_chave  text default null
)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_enq     enquetes;
  v_total   int;
  v_pode    boolean := false;
  v_ranking json;
begin
  select * into v_enq from enquetes where codigo = upper(p_codigo);
  if not found then raise exception 'Enquete não encontrada'; end if;

  if v_enq.mostrar_resultado = 'vivo' then v_pode := true; end if;
  if v_enq.encerrada or (v_enq.prazo is not null and v_enq.prazo < now()) then v_pode := true; end if;
  if p_chave is not null then
    begin
      perform _validar_chave(p_chave);
      v_pode := true;
    exception when others then
      null;  -- chave errada não libera, mas não derruba a chamada
    end;
  end if;

  if not v_pode then
    raise exception 'O resultado aparece quando a votação encerrar';
  end if;

  select count(*) into v_total from votos where enquete_id = v_enq.id;

  select coalesce(json_agg(j order by (j->>'votos')::int desc), '[]'::json)
    into v_ranking
    from (
      select json_build_object(
        'id',    r.id,
        'texto', r.texto,
        'votos', (select count(*) from voto_redacao vr where vr.redacao_id = r.id),
        'pct',   case when v_total = 0 then 0
                      else round(100.0 * (select count(*) from voto_redacao vr where vr.redacao_id = r.id) / v_total)
                 end
      ) as j
      from redacoes r
      where r.enquete_id = v_enq.id and r.status = 'aprovada'
    ) sub;

  return json_build_object(
    'codigo',      v_enq.codigo,
    'titulo',      v_enq.titulo,
    'total_votos', v_total,
    'ranking',     v_ranking
  );
end;
$$;


-- ============== RESGATE DE CHAVE (só no SQL Editor) =============
-- Use quando alguém perder a chave. No painel do Supabase:
--   1) Table Editor → autores: ache a pessoa por nome/e-mail
--      e a enquete dela em "enquetes" (anote o codigo).
--   2) SQL Editor:  select admin_reemitir_chave('CODIGO');
--   3) Entregue a chave nova; a antiga deixa de funcionar.
create or replace function admin_reemitir_chave(p_codigo text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_enq          enquetes;
  v_segredo      text;
  v_chave_codigo text;
begin
  select * into v_enq from enquetes where codigo = upper(p_codigo);
  if not found then raise exception 'Enquete não encontrada'; end if;

  -- garante um chave_codigo (enquetes antigas, anteriores ao desacoplamento)
  v_chave_codigo := v_enq.chave_codigo;
  if v_chave_codigo is null then
    loop
      v_chave_codigo := gerar_codigo();
      exit when not exists (select 1 from enquetes where chave_codigo = v_chave_codigo);
    end loop;
  end if;

  v_segredo := upper(substr(encode(gen_random_bytes(6),'hex'), 1, 6));
  update enquetes
     set chave_hash = crypt(v_segredo, gen_salt('bf')),
         chave_codigo = v_chave_codigo
   where id = v_enq.id;

  return 'LS-' || v_chave_codigo || '-' || v_segredo;
end;
$$;


-- ===================== ARTIGOS (aba "Artigos") =================
-- Lista curada de links/textos sobre Linguagem Simples.
-- COMO ADICIONAR UM ARTIGO (você opera direto no Supabase):
--   Table Editor → tabela "artigos" → Insert row.
--   Preencha: titulo, url (obrigatórios) · autor, fonte, ordem (opcionais).
--   'ordem' maior aparece primeiro. Pronto — o app já mostra na aba Artigos.
create table if not exists artigos (
  id           uuid primary key default gen_random_uuid(),
  titulo       text not null,
  url          text not null unique,
  autor        text,
  fonte        text,          -- ex.: 'TCE-SP', 'PDF · TCE-SP', 'Blog'
  publicado_em date,
  ordem        int  not null default 0,
  criado_em    timestamptz not null default now()
);
-- RLS ligado e SEM policy: anon não lê/escreve direto. Você insere pelo
-- Table Editor (que age como dono); o app lê pela função abaixo.
alter table artigos enable row level security;

-- leitura pública (o front chama esta RPC)
create or replace function listar_artigos()
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce((
    select json_agg(json_build_object(
             'id', id, 'titulo', titulo, 'url', url,
             'autor', autor, 'fonte', fonte, 'publicado_em', publicado_em
           ) order by ordem desc, criado_em desc)
    from artigos
  ), '[]'::json);
end;
$$;

-- artigos iniciais (idempotente: rodar de novo não duplica)
insert into artigos (titulo, url, autor, fonte, ordem) values
  ('Agora é lei: Simples fica melhor',
   'https://www.tce.sp.gov.br/publicacoes/artigo-agora-e-lei-simplesfica-melhor',
   'Marcus Cerávolo', 'TCE-SP', 20),
  ('Linguagem Simples no serviço público (PDF)',
   'https://www.tce.sp.gov.br/sites/default/files/noticias/Artigo_Marcus%20Cer%C3%A1volo_0.pdf',
   'Marcus Cerávolo', 'PDF · TCE-SP', 10)
on conflict (url) do nothing;


-- ===================== CURSOS (aba "Cursos") ===================
-- Cursos sobre Linguagem Simples (gratuitos ou pagos).
-- Adicionar: Table Editor → tabela "cursos" → Insert row.
--   titulo, url (obrigatórios) · descricao, instituicao, carga ('20h'),
--   gratuito (bool), certificado (bool), ordem. 'ordem' maior aparece primeiro.
create table if not exists cursos (
  id          uuid primary key default gen_random_uuid(),
  titulo      text not null,
  url         text not null unique,
  descricao   text,
  instituicao text,
  carga       text,
  gratuito    boolean not null default true,
  certificado boolean not null default false,
  ordem       int not null default 0,
  criado_em   timestamptz not null default now()
);
alter table cursos enable row level security;

create or replace function listar_cursos()
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce((
    select json_agg(json_build_object(
             'id', id, 'titulo', titulo, 'url', url, 'descricao', descricao,
             'instituicao', instituicao, 'carga', carga,
             'gratuito', gratuito, 'certificado', certificado
           ) order by ordem desc, criado_em desc)
    from cursos
  ), '[]'::json);
end;
$$;

insert into cursos (titulo, url, descricao, instituicao, carga, gratuito, certificado, ordem) values
  ('Primeiros passos para uso de Linguagem Simples',
   'https://www.escolavirtual.gov.br/curso/315',
   'Curso aberto, gratuito e com certificado, desenvolvido pela Enap com a jornalista e pesquisadora Heloisa Fischer (Comunica Simples). Voltado a servidores e cidadãos; comece imediatamente.',
   'Enap', 'autoinstrucional', true, true, 30),
  ('Linguagem Simples (Prefeitura de SP / Enap)',
   'https://www.escolavirtual.gov.br/curso/332',
   'Versão mais aprofundada (20h), criada pela Secretaria Municipal de Inovação e Tecnologia de São Paulo e certificada pela Enap. Três módulos: Conheça, Use e Compartilhe a Linguagem Simples.',
   'Prefeitura de SP · Enap', '20h', true, true, 20),
  ('Linguagem Simples (TCU / ISC + Unicamp)',
   'https://contas.tcu.gov.br/ead/',
   'Gratuito, online e autoinstrucional, com certificado, ofertado pelo Instituto Serzedello Corrêa (escola do TCU) em parceria com a Unicamp. 12h em 12 aulas em vídeo, com apostilas e avaliação final (nota mínima 75). No portal, busque por "Linguagem Simples".',
   'TCU/ISC · Unicamp', '12h', true, true, 10)
on conflict (url) do nothing;


-- ===================== JOGO (aba "Aprenda jogando") ============
-- Guarda as partidas para gerar RANKING e material de estudo.
-- 'detalhes' (jsonb) registra acertos/erros por competência — base de pesquisa.
create table if not exists jogo_pontuacoes (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  email     text,                      -- opcional; nunca exposto no ranking
  token     text,                      -- device token (anti-spam/dedupe)
  modo      text not null default 'rapido',  -- 'rapido' | 'simulado' | 'desafio:<tipo>'
  acertos   int  not null,
  total     int  not null,
  pct       int  not null,
  detalhes  jsonb,
  criado_em timestamptz not null default now()
);
alter table jogo_pontuacoes enable row level security;
create index if not exists idx_jogo_rank on jogo_pontuacoes (modo, pct desc, criado_em desc);

-- registrar uma partida (público). O servidor calcula o pct e valida.
create or replace function registrar_pontuacao(
  p_nome    text,
  p_modo    text,
  p_acertos int,
  p_total   int,
  p_email   text  default null,
  p_token   text  default null,
  p_detalhes jsonb default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare v_pct int; v_a int;
begin
  if length(trim(coalesce(p_nome,''))) = 0 then raise exception 'Informe seu nome'; end if;
  if length(p_nome) > 40 then raise exception 'Nome muito longo (máx. 40)'; end if;
  if p_total is null or p_total <= 0 or p_total > 200 then raise exception 'Partida inválida'; end if;
  v_a  := greatest(0, least(coalesce(p_acertos,0), p_total));
  v_pct := round(100.0 * v_a / p_total);
  insert into jogo_pontuacoes (nome, email, token, modo, acertos, total, pct, detalhes)
    values (trim(p_nome), nullif(lower(trim(coalesce(p_email,''))),''), p_token,
            coalesce(nullif(trim(p_modo),''),'rapido'), v_a, p_total, v_pct, p_detalhes);
  return json_build_object('ok', true, 'pct', v_pct);
end;
$$;

-- ranking público: melhores partidas. NÃO expõe e-mail.
create or replace function ranking_jogo(p_modo text default null, p_limite int default 20)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce((
    select json_agg(json_build_object(
             'nome', nome, 'pct', pct, 'acertos', acertos, 'total', total,
             'modo', modo, 'quando', criado_em
           ) order by pct desc, criado_em desc)
    from (
      select * from jogo_pontuacoes
       where p_modo is null or modo = p_modo
       order by pct desc, criado_em desc
       limit greatest(1, least(100, coalesce(p_limite, 20)))
    ) t
  ), '[]'::json);
end;
$$;


-- ===================== FALE CONOSCO (contatos) =================
-- Guarda mensagens do "Fale conosco": dúvidas, sugestões, críticas,
-- reclamações e INDICAÇÕES de materiais (artigo/livro/curso/material).
-- Você lê tudo no Table Editor → tabela "contatos" (anon não lê).
create table if not exists contatos (
  id        uuid primary key default gen_random_uuid(),
  tipo      text not null check (tipo in ('duvida','sugestao','critica','reclamacao','indicacao','elogio')),
  nome      text,
  email     text,
  material  text,     -- só p/ indicação: 'artigo'|'livro'|'curso'|'material'
  titulo    text,     -- nome do recurso indicado
  url       text,     -- link do recurso indicado
  mensagem  text,
  token     text,
  criado_em timestamptz not null default now()
);
alter table contatos enable row level security;
create index if not exists idx_contatos on contatos (tipo, criado_em desc);
-- migração idempotente: tabelas já criadas ganham o novo tipo 'elogio'
alter table contatos drop constraint if exists contatos_tipo_check;
alter table contatos add  constraint contatos_tipo_check
  check (tipo in ('duvida','sugestao','critica','reclamacao','indicacao','elogio'));

create or replace function enviar_contato(
  p_tipo     text,
  p_mensagem text default null,
  p_nome     text default null,
  p_email    text default null,
  p_material text default null,
  p_titulo   text default null,
  p_url      text default null,
  p_token    text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tipo not in ('duvida','sugestao','critica','reclamacao','indicacao','elogio') then
    raise exception 'Tipo inválido';
  end if;
  if p_tipo = 'indicacao' then
    if length(trim(coalesce(p_titulo,''))) = 0 and length(trim(coalesce(p_url,''))) = 0 then
      raise exception 'Diga o nome ou o link do material que você indica';
    end if;
  else
    if length(trim(coalesce(p_mensagem,''))) = 0 then
      raise exception 'Escreva a sua mensagem';
    end if;
  end if;
  if length(coalesce(p_mensagem,'')) > 2000 or length(coalesce(p_titulo,'')) > 300
     or length(coalesce(p_url,'')) > 500 or length(coalesce(p_nome,'')) > 80
     or length(coalesce(p_email,'')) > 120 then
    raise exception 'Conteúdo longo demais';
  end if;
  if length(trim(coalesce(p_email,''))) > 0 and position('@' in p_email) = 0 then
    raise exception 'Confira o e-mail';
  end if;
  insert into contatos (tipo, nome, email, material, titulo, url, mensagem, token)
    values (p_tipo,
            nullif(trim(coalesce(p_nome,'')),''),
            nullif(lower(trim(coalesce(p_email,''))),''),
            nullif(trim(coalesce(p_material,'')),''),
            nullif(trim(coalesce(p_titulo,'')),''),
            nullif(trim(coalesce(p_url,'')),''),
            nullif(trim(coalesce(p_mensagem,'')),''),
            p_token);
  return json_build_object('ok', true);
end;
$$;


-- ============= ANTECIPA · Módulo 2 (roteiros de antecipação) ===
-- Acervo PÚBLICO de histórias sociais (método Social Stories, Carol Gray).
-- Fica ONLINE no Supabase: o app consome direto da rede quando há conexão
-- e guarda uma cópia no aparelho para leitura OFFLINE depois (pessoas de
-- áreas remotas baixam num centro e leem em casa sem internet).
--
-- Privacidade: aqui só entra o acervo PÚBLICO. Dados pessoais das famílias
-- (fotos do local, nome de criança, histórias privadas) NUNCA sobem — vivem
-- só no dispositivo. Ver Documento de Visão / pitacos MAGC.
--
-- A história inteira (schema v1.1) é guardada como JSONB em 'dados'; algumas
-- colunas ficam de fora só para listar/ordenar/filtrar. Adicionar/editar:
--   Table Editor → tabela "historias" (o app lê pela RPC abaixo).
create table if not exists historias (
  id            text primary key,               -- kebab-case: 'saude-vacina'
  titulo        text not null,
  categoria     text,
  publicos      text[] not null default '{}',   -- ex.: {autista}
  selo          text not null default 'núcleo oficial',
  ordem         int  not null default 0,         -- menor aparece primeiro
  ativo         boolean not null default true,
  dados         jsonb not null,                  -- objeto completo da história
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table historias enable row level security;
create index if not exists idx_historias on historias (ativo, ordem);

-- leitura pública: devolve os objetos completos (o front resolve pictogramas)
create or replace function listar_historias()
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce((
    select json_agg(dados order by ordem asc, titulo asc)
    from historias where ativo = true
  ), '[]'::json);
end;
$$;

-- acervo inicial (idempotente: re-rodar ATUALIZA o conteúdo das 3 histórias)
insert into historias (id, titulo, categoria, publicos, selo, ordem, dados) values
(
  'saude-vacina', 'Vou tomar vacina no posto de saúde', 'Saúde', '{autista}', 'núcleo oficial', 10,
  $j${
    "id":"saude-vacina","categoria":"Saúde","icone":"saude",
    "titulo":"Vou tomar vacina no posto de saúde",
    "objetivo":"Saber, antes, como é tomar vacina no posto.",
    "duracao_min":10,"publicos":["autista"],
    "levar":["Cartão do SUS","Caderneta de vacinação"],
    "origem":{"selo":"núcleo oficial"},
    "passos":[
      {"tipo":"chegada","frase":"descreve","ilu":"cena_posto","texto":"Hoje eu vou ao posto de saúde tomar vacina. Eu levo o meu cartão do SUS."},
      {"tipo":"chegada","frase":"descreve","ilu":"cena_senha","texto":"No posto, eu pego uma senha com um número."},
      {"tipo":"espera","frase":"descreve","ilu":"cena_espera","texto":"Eu sento e espero a minha vez. Às vezes eu espero um pouco, às vezes eu espero mais.","alerta":"A sala de espera às vezes fica cheia e barulhenta.","cuidador":"Se o barulho incomodar, ofereça fones ou um cantinho mais calmo para esperar."},
      {"tipo":"interacao","frase":"descreve","ilu":"cena_chamada","texto":"Uma pessoa chama o meu número ou o meu nome."},
      {"tipo":"procedimento","frase":"descreve","ilu":"cena_conversa","texto":"Eu entro numa sala. Uma pessoa do posto conversa comigo com calma."},
      {"tipo":"procedimento","frase":"descreve","ilu":"cena_vacina","texto":"A vacina é uma picada rápida no braço. Às vezes arde um pouquinho. Logo passa."},
      {"tipo":"procedimento","frase":"orienta","ilu":"cena_respira","texto":"Quando a agulha chegar, eu posso tentar respirar bem fundo."},
      {"tipo":"calma","frase":"orienta","ilu":"cena_pausa","texto":"Se ficar demais para mim, eu posso avisar o meu acompanhante e fazer uma pausa."},
      {"tipo":"saida","frase":"descreve","ilu":"cena_curativo","texto":"Depois da picada, eu ganho um algodãozinho no braço."},
      {"tipo":"saida","frase":"descreve","ilu":"cena_casa","texto":"Eu vou para casa. Eu cuidei da minha saúde. Eu fui muito bem."}
    ]
  }$j$::jsonb
),
(
  'documento-rg', 'Vou tirar o meu RG', 'Documentos', '{autista}', 'núcleo oficial', 20,
  $j${
    "id":"documento-rg","categoria":"Documentos","icone":"doc",
    "titulo":"Vou tirar o meu RG",
    "objetivo":"Saber, antes, como é tirar o documento de identidade.",
    "duracao_min":20,"publicos":["autista"],
    "levar":["Certidão de nascimento","Uma foto 3x4, se pedirem"],
    "origem":{"selo":"núcleo oficial"},
    "passos":[
      {"tipo":"chegada","frase":"descreve","ilu":"cena_rg","texto":"Hoje eu vou tirar o meu RG. O RG é um documento com o meu nome e a minha foto."},
      {"tipo":"chegada","frase":"descreve","ilu":"cena_certidao","texto":"Eu levo a minha certidão de nascimento."},
      {"tipo":"espera","frase":"descreve","ilu":"cena_senha","texto":"No lugar do atendimento, eu pego uma senha e espero.","alerta":"Às vezes a fila é grande e a espera é um pouco longa."},
      {"tipo":"interacao","frase":"descreve","ilu":"cena_chamada","texto":"Uma pessoa chama o meu número."},
      {"tipo":"procedimento","frase":"descreve","ilu":"cena_atendente","texto":"Eu sento na frente de um atendente. Ele digita os meus dados no computador."},
      {"tipo":"procedimento","frase":"descreve","ilu":"cena_camera","texto":"O atendente tira uma foto do meu rosto. Eu fico parado e olho para a câmera."},
      {"tipo":"procedimento","frase":"descreve","ilu":"cena_digital","texto":"Ele pega a marca dos meus dedos. Eu encosto o dedo num aparelho. Isso não dói."},
      {"tipo":"interacao","frase":"orienta","ilu":"cena_conversa","texto":"Se eu não entender alguma coisa, eu posso pedir para a pessoa explicar de novo."},
      {"tipo":"saida","frase":"descreve","ilu":"cena_relogio","texto":"O RG não fica pronto na hora. O atendente me diz o dia de voltar para pegar.","cuidador":"Confirme a data e o local de retirada antes de sair; guarde o comprovante."},
      {"tipo":"saida","frase":"descreve","ilu":"cena_casa","texto":"Depois, eu vou para casa. Eu fui muito bem."}
    ]
  }$j$::jsonb
),
(
  'assistencia-cras', 'Vou ao CRAS', 'Assistência social', '{autista}', 'núcleo oficial', 30,
  $j${
    "id":"assistencia-cras","categoria":"Assistência social","icone":"social",
    "titulo":"Vou ao CRAS",
    "objetivo":"Saber, antes, como é ser atendido no CRAS.",
    "duracao_min":20,"publicos":["autista"],
    "levar":["RG","CPF","Uma conta com o meu endereço"],
    "origem":{"selo":"núcleo oficial"},
    "passos":[
      {"tipo":"chegada","frase":"descreve","ilu":"cena_cras","texto":"Hoje eu vou ao CRAS. O CRAS é um lugar que ajuda as famílias."},
      {"tipo":"chegada","frase":"descreve","ilu":"cena_certidao","texto":"Eu levo os meus documentos: RG, CPF e uma conta com o meu endereço."},
      {"tipo":"espera","frase":"descreve","ilu":"cena_senha","texto":"Na entrada, eu digo o meu nome. Eu pego uma senha e espero."},
      {"tipo":"interacao","frase":"descreve","ilu":"cena_chamada","texto":"Uma pessoa chama o meu número."},
      {"tipo":"procedimento","frase":"descreve","ilu":"cena_atendente","texto":"Eu converso com uma pessoa que trabalha lá. Ela faz algumas perguntas sobre a minha família."},
      {"tipo":"procedimento","frase":"descreve","ilu":"cena_perguntas","texto":"Algumas perguntas são sobre a minha casa e o meu dia a dia. Responder é tranquilo. As respostas ajudam a saber como me ajudar."},
      {"tipo":"interacao","frase":"orienta","ilu":"cena_conversa","texto":"Se uma pergunta for difícil, eu posso pedir ajuda ao meu acompanhante."},
      {"tipo":"procedimento","frase":"descreve","ilu":"cena_atendente","texto":"A pessoa anota as respostas no computador."},
      {"tipo":"saida","frase":"descreve","ilu":"cena_relogio","texto":"Às vezes eu resolvo tudo no mesmo dia. Às vezes eu preciso voltar outro dia."},
      {"tipo":"saida","frase":"descreve","ilu":"cena_casa","texto":"Depois, eu vou para casa. Eu cuidei das coisas da minha família."}
    ]
  }$j$::jsonb
)
on conflict (id) do update
  set titulo=excluded.titulo, categoria=excluded.categoria, publicos=excluded.publicos,
      selo=excluded.selo, ordem=excluded.ordem, dados=excluded.dados, atualizado_em=now();


-- ========================== GRANTS =============================
-- Funções internas/administrativas: fora do alcance do anon.
revoke all on function _validar_chave(text)        from public;
revoke all on function admin_reemitir_chave(text)  from public;
revoke all on function gerar_codigo()              from public;

-- As demais já são executáveis por anon (herdam de PUBLIC).
-- Se preferir ser explícito, descomente e ajuste para o papel anon:
-- grant execute on function criar_enquete(text,text,text,text,text[],text,text,int) to anon;
-- grant execute on function obter_para_votar(text)            to anon;
-- grant execute on function registrar_voto(text,text,uuid[],text,text) to anon;
-- grant execute on function sugerir_redacao(text,text,text)   to anon;
-- grant execute on function obter_painel(text)                to anon;
-- grant execute on function curar_redacao(text,uuid,text)     to anon;
-- grant execute on function encerrar_enquete(text)            to anon;
-- grant execute on function obter_resultado(text,text)        to anon;

-- =============================================================
--  fim do schema
-- =============================================================

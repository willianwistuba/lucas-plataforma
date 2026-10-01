-- 002_auth_tcesp.sql — autenticação do LUCAS.
-- Login apenas por e-mail + senha (sem magic link nem código), restrito ao
-- domínio institucional @tce.sp.gov.br, com a trava aplicada TAMBÉM no backend
-- (gatilho no auth.users), além da validação no front. Cria o perfil do usuário
-- automaticamente no cadastro.

-- 1) Só e-mails @tce.sp.gov.br podem se cadastrar (trava de servidor).
create or replace function public.exigir_dominio_tcesp()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is null or lower(new.email) not like '%@tce.sp.gov.br' then
    raise exception 'Cadastro permitido apenas para e-mails @tce.sp.gov.br';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_exigir_dominio_tcesp on auth.users;
create trigger trg_exigir_dominio_tcesp
  before insert on auth.users
  for each row execute function public.exigir_dominio_tcesp();

-- 2) Cria o perfil automaticamente após o cadastro. O nome vem do metadado
-- enviado no signUp (options.data.nome); na falta, usa a parte antes do @.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, nome)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'nome'), ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_handle_new_user on auth.users;
create trigger trg_handle_new_user
  after insert on auth.users
  for each row execute function public.handle_new_user();

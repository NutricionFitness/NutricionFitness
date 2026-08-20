-- Imitación mínima de lo que Supabase pone en el esquema `auth`, para poder
-- ejecutar y probar las migraciones contra un PostgreSQL normal.
--
-- NO se sube a Supabase: allí este esquema ya existe. Sirve para que las
-- políticas de acceso se puedan ejercitar de verdad antes de entregarlas, en
-- vez de darlas por buenas porque «parecen correctas».

create extension if not exists pgcrypto;
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- En Supabase auth.uid() lee el «sub» del JWT. Aquí se lee de una variable de
-- sesión que las pruebas van cambiando para simular usuarios distintos.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('app.usuario_actual', true), '')::uuid
$$;

-- Rol que Supabase usa para las peticiones autenticadas.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;

grant usage on schema public, auth to authenticated, anon;
grant select on auth.users to authenticated;

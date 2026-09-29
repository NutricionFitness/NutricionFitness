-- ============================================================================
-- Decimoséptima batería · entrar en el comparador con un correo (0023)
-- ============================================================================
-- Lo que se demuestra: que `correo_con_acceso_comparador` dice que sí al correo
-- de una persona activa —lo escriba como lo escriba—, que dice que no a una
-- desactivada, a un correo que no está y a una persona sin correo; que la base
-- no deja guardar un correo sin normalizar; y que `anon` puede preguntar pero
-- sigue sin poder leer `personas`.
--
-- Del arnés, lo de siempre: `app.usuario_actual` es lo que lee la `auth.uid()`
-- de `00_stub_auth.sql`, y hay comprobaciones de control que exigen que algo SÍ
-- salga —si no, todas las de «esto no entra» pasarían con la tabla vacía—.
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off

create temporary table _resultados (n serial, ok boolean, que text);

create or replace function pg_temp.comprobar(p_ok boolean, p_que text)
returns void language plpgsql security definer as $$
begin
  insert into _resultados (ok, que) values (coalesce(p_ok, false), p_que);
end $$;

-- El arnés reconstruye lo que en Supabase hacen los «default privileges».
-- Ver la duodécima batería.
grant select, insert, update, delete on all tables in schema public to authenticated;

begin;

-- ---------------------------------------------------------------- el decorado
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'carlos@ejemplo.es'),
  ('22222222-2222-2222-2222-222222222222', 'otra@ejemplo.es')
on conflict (id) do nothing;

-- Dos entrenadores con sus personas: una activa con correo, una desactivada
-- con correo, y una sin correo.
insert into public.personas (id, owner_id, nombre, email, activa) values
  ('c0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Ana', 'ana@ejemplo.es', true),
  ('c0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Bruno', 'bruno@ejemplo.es', false),
  ('c0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222',
   'Clara', null, true);

-- ---------------------------------------------------------------------------
-- 1 · La columna
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'personas'
       and column_name = 'email' and is_nullable = 'YES'),
  'personas lleva la columna email, y admite nulo');

do $$
declare ok boolean := false;
begin
  begin
    update public.personas set email = 'Ana@Ejemplo.es'
     where id = 'c0000000-0000-0000-0000-000000000001';
  exception when check_violation then ok := true; end;
  perform pg_temp.comprobar(ok, 'un correo con mayúsculas no se guarda');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    update public.personas set email = ' ana@ejemplo.es'
     where id = 'c0000000-0000-0000-0000-000000000001';
  exception when check_violation then ok := true; end;
  perform pg_temp.comprobar(ok, 'ni uno con espacios');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    update public.personas set email = 'anaejemplo.es'
     where id = 'c0000000-0000-0000-0000-000000000001';
  exception when check_violation then ok := true; end;
  perform pg_temp.comprobar(ok, 'ni uno sin arroba');
end $$;

-- ---------------------------------------------------------------------------
-- 2 · Quién entra
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  public.correo_con_acceso_comparador('ana@ejemplo.es'),
  'CONTROL: el correo de una persona activa entra');

select pg_temp.comprobar(
  public.correo_con_acceso_comparador('  Ana@EJEMPLO.es '),
  'escrito con mayúsculas y espacios, también');

select pg_temp.comprobar(
  not public.correo_con_acceso_comparador('bruno@ejemplo.es'),
  'el de una persona desactivada, no');

select pg_temp.comprobar(
  not public.correo_con_acceso_comparador('nadie@ejemplo.es'),
  'un correo que no está, no');

select pg_temp.comprobar(
  not public.correo_con_acceso_comparador('carlos@ejemplo.es'),
  'el de un entrenador no es el de una persona: no (él entra con su sesión)');

select pg_temp.comprobar(
  not public.correo_con_acceso_comparador(''),
  'una cadena vacía, no');

select pg_temp.comprobar(
  not public.correo_con_acceso_comparador(null),
  'null, no (y no devuelve null)');

-- ---------------------------------------------------------------------------
-- 3 · anon pregunta, pero no lee
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  has_function_privilege('anon', 'public.correo_con_acceso_comparador(text)', 'execute'),
  'anon puede llamar a correo_con_acceso_comparador');

select pg_temp.comprobar(
  not has_table_privilege('anon', 'public.personas', 'select'),
  'y sigue sin poder leer personas');

-- Con el rol puesto de verdad, no solo mirando los privilegios.
set local role anon;
select pg_temp.comprobar(
  public.correo_con_acceso_comparador('ana@ejemplo.es'),
  'CONTROL: como anon, la función responde');
reset role;

-- Y un entrenador cualquiera también puede preguntar por un correo que no es
-- de sus personas: la respuesta es sí o no, no le enseña la fila.
set local app.usuario_actual = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
select pg_temp.comprobar(
  public.correo_con_acceso_comparador('ana@ejemplo.es'),
  'la función ve personas de otros entrenadores (es security definer)');
select pg_temp.comprobar(
  not exists (select 1 from public.personas where email = 'ana@ejemplo.es'),
  'pero la tabla sigue sin enseñarle la fila');
reset role;

-- ============================================================================
-- Veredicto
-- ============================================================================
select lpad(n::text, 2) || '  ' || case when ok then '✓' else '✗ FALLA' end
       || '  ' || que as bateria
  from _resultados order by n;

do $$
declare v_mal integer;
begin
  select count(*) into v_mal from _resultados where not ok;
  if v_mal > 0 then
    raise exception 'La decimoséptima batería tiene % comprobaciones en rojo', v_mal;
  end if;
  raise notice 'Decimoséptima batería: % comprobaciones, todas en verde',
    (select count(*) from _resultados);
end $$;

rollback;

-- ============================================================================
-- Decimosexta batería · escanear con otro dispositivo sin sesión (0022)
-- ============================================================================
-- Lo que se demuestra: que un ordenador sin sesión puede abrir un vínculo,
-- que el móvil le manda códigos por las funciones de la 0009 sin cambiar nada,
-- que el ordenador los recoge de uno en uno, y que todo esto no abre ninguna
-- puerta nueva: las sesiones con dueño siguen siendo solo de su dueño, las sin
-- dueño no las ve ninguna cuenta por las tablas, y `anon` sigue sin leer una
-- fila de nada.
--
-- Del arnés, lo de siempre: `app.usuario_actual` es lo que lee la `auth.uid()`
-- de `00_stub_auth.sql`. Los `set role` van a nivel de sentencia, que con el
-- rol de superusuario el RLS no se aplica y una prueba que se olvide de cambiar
-- de rol pasa siempre.
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
grant select, insert, update, delete on all tables in schema public to authenticated;

begin;

-- ---------------------------------------------------------------- el decorado
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ana@ejemplo.es'),
  ('22222222-2222-2222-2222-222222222222', 'luis@ejemplo.es')
on conflict (id) do nothing;

-- Una sesión CON dueño, como las de siempre, para comprobar que las funciones
-- nuevas no la tocan.
insert into public.sesiones_escaneo (token, owner_id, expira_en) values
  (repeat('a', 36), '11111111-1111-1111-1111-111111111111', now() + interval '15 minutes');

-- ---------------------------------------------------------------------------
-- 1 · El ordenador sin sesión abre un vínculo
-- ---------------------------------------------------------------------------
set local role anon;

select pg_temp.comprobar(
  public.abrir_escaneo_anonimo(repeat('b', 36)) > now() + interval '14 minutes',
  'anon abre un vínculo y caduca en un cuarto de hora');

do $$
declare ok boolean := false;
begin
  begin
    perform public.abrir_escaneo_anonimo('no-es-un-token');
  exception when others then
    ok := sqlerrm = 'token_invalido';
  end;
  perform pg_temp.comprobar(ok, 'un token con mala forma se rechaza con nombre');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    perform public.abrir_escaneo_anonimo(repeat('b', 36));
  exception when unique_violation then
    ok := true;
  end;
  perform pg_temp.comprobar(ok, 'el mismo token no se abre dos veces');
end $$;

-- ---------------------------------------------------------------------------
-- 2 · El móvil, por las funciones de la 0009, sin cambiar nada
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  public.estado_escaneo(repeat('b', 36), true) = 'ok',
  'el móvil abre el enlace de una sesión sin dueño');

select pg_temp.comprobar(
  public.enviar_escaneo(repeat('b', 36), '3017620422003') = 'ok'
  and public.enviar_escaneo(repeat('b', 36), '96385074') = 'ok',
  'y le manda dos códigos');

-- ---------------------------------------------------------------------------
-- 3 · El ordenador los recoge, de uno en uno
-- ---------------------------------------------------------------------------
create temporary table _n1 as
  select public.novedades_escaneo_anonimo(repeat('b', 36), 0) as j;

select pg_temp.comprobar(
  (select (j->>'existe')::boolean and (j->>'vinculada')::boolean
          and not (j->>'terminada')::boolean and not (j->>'escribir_a_mano')::boolean
     from _n1),
  'la sesión existe, está vinculada y sigue viva');

select pg_temp.comprobar(
  (select j#>>'{codigo,codigo}' from _n1) = '3017620422003',
  'llega el primer código, y solo el primero');

create temporary table _n2 as
  select public.novedades_escaneo_anonimo(
    repeat('b', 36), (select (j#>>'{codigo,id}')::bigint from _n1)) as j;

select pg_temp.comprobar(
  (select j#>>'{codigo,codigo}' from _n2) = '96385074',
  'a partir del primero, llega el segundo');

select pg_temp.comprobar(
  (select j->'codigo' from _n2) is not null
  and (select public.novedades_escaneo_anonimo(
         repeat('b', 36), (select (j#>>'{codigo,id}')::bigint from _n2)) -> 'codigo')
      = 'null'::jsonb,
  'y a partir del segundo, ninguno');

-- ---------------------------------------------------------------------------
-- 4 · Las sesiones con dueño no se ven ni se tocan desde aquí
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  (public.novedades_escaneo_anonimo(repeat('a', 36), 0)->>'existe')::boolean = false,
  'la sesión de Ana no existe para las funciones sin dueño');

select public.cerrar_escaneo_anonimo(repeat('a', 36));

select pg_temp.comprobar(
  not has_table_privilege('anon', 'public.sesiones_escaneo', 'select')
  and not has_table_privilege('anon', 'public.escaneos', 'select'),
  'anon sigue sin poder leer las tablas');

reset role;

select pg_temp.comprobar(
  exists (select 1 from public.sesiones_escaneo where token = repeat('a', 36)),
  'CONTROL: cerrar_escaneo_anonimo con el token de Ana no ha borrado nada');

-- ---------------------------------------------------------------------------
-- 5 · Y las sin dueño no las ve ninguna cuenta
-- ---------------------------------------------------------------------------
set local role authenticated;
set local app.usuario_actual = '11111111-1111-1111-1111-111111111111';

select pg_temp.comprobar(
  (select count(*) from public.sesiones_escaneo) = 1
  and (select count(*) from public.escaneos) = 0,
  'Ana ve su sesión y nada de la sesión sin dueño');

set local app.usuario_actual = '22222222-2222-2222-2222-222222222222';

select pg_temp.comprobar(
  (select count(*) from public.sesiones_escaneo) = 0
  and (select count(*) from public.escaneos) = 0,
  'Luis no ve ninguna');

reset role;

-- ---------------------------------------------------------------------------
-- 6 · Escribir a mano, y terminar
-- ---------------------------------------------------------------------------
set local role anon;

select pg_temp.comprobar(
  public.pedir_escribir_a_mano(repeat('b', 36)) = 'ok',
  'el móvil pide escribirlo a mano');

select pg_temp.comprobar(
  (select (j->>'escribir_a_mano')::boolean and (j->>'terminada')::boolean
     from public.novedades_escaneo_anonimo(repeat('b', 36), 0) as j),
  'y el ordenador se entera: escribir a mano, y la sesión terminada');

select public.cerrar_escaneo_anonimo(repeat('b', 36));

select pg_temp.comprobar(
  public.estado_escaneo(repeat('b', 36)) = 'no_existe',
  'al terminar, la sesión desaparece con su cola');

reset role;

-- ---------------------------------------------------------------------------
-- 7 · El tope y la limpieza
-- ---------------------------------------------------------------------------
-- 500 sin dueño vivas: la siguiente no se abre.
insert into public.sesiones_escaneo (token, owner_id, expira_en)
select md5(i::text), null, now() + interval '10 minutes'
  from generate_series(1, 500) as i;

set local role anon;

do $$
declare ok boolean := false;
begin
  begin
    perform public.abrir_escaneo_anonimo(repeat('d', 36));
  exception when others then
    ok := sqlerrm = 'demasiadas_sesiones';
  end;
  perform pg_temp.comprobar(ok, 'con 500 vivas no se abre otra');
end $$;

reset role;

-- Con sitio otra vez, abrir una limpia de paso las sin dueño caducadas. Se
-- comprueba aparte del tope: si la apertura falla, PostgreSQL deshace también
-- la limpieza que la función hizo antes de fallar.
delete from public.sesiones_escaneo where owner_id is null and length(token) = 32;

insert into public.sesiones_escaneo (token, owner_id, expira_en) values
  (repeat('c', 36), null, now() - interval '1 minute');

set local role anon;

select pg_temp.comprobar(
  public.abrir_escaneo_anonimo(repeat('d', 36)) is not null,
  'CONTROL: con sitio, se abre');

reset role;

select pg_temp.comprobar(
  not exists (select 1 from public.sesiones_escaneo where token = repeat('c', 36)),
  'y la caducada sin dueño se ha limpiado de paso');

select pg_temp.comprobar(
  exists (select 1 from public.sesiones_escaneo where token = repeat('a', 36)),
  'CONTROL: la sesión de Ana, con dueño, sigue ahí');

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
    raise exception 'La decimosexta batería tiene % comprobaciones en rojo', v_mal;
  end if;
  raise notice 'Decimosexta batería: % comprobaciones, todas en verde',
    (select count(*) from _resultados);
end $$;

rollback;

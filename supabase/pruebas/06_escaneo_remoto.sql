-- ============================================================================
-- Pruebas del escaneo desde otro dispositivo (migración 0009).
--
--   psql -d appnut -f supabase/pruebas/00_stub_auth.sql
--   psql -d appnut -f supabase/migraciones/0001_esquema.sql
--   psql -d appnut -f supabase/migraciones/0009_escaneo_remoto.sql
--   psql -d appnut -f supabase/pruebas/06_escaneo_remoto.sql
--
-- Lo que hay que demostrar aquí, por encima de todo lo demás: que el rol
-- `anon` —el navegador del móvil, sin sesión iniciada— puede hacer exactamente
-- tres cosas y ninguna más. Es la única parte de la app a la que llega alguien
-- que no ha entrado, así que no vale con que «parezca correcta».
--
-- Los `set role` van a nivel de sentencia y no dentro de un bloque: con el rol
-- de superusuario el RLS **no se aplica**, y una prueba que se olvide de
-- cambiar de rol pasa siempre. Es la trampa clásica de probar políticas.
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

set client_min_messages = warning;

-- --- montaje ---------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ana@ejemplo.es'),
  ('22222222-2222-2222-2222-222222222222', 'luis@ejemplo.es')
on conflict do nothing;

insert into public.sesiones_escaneo (token, owner_id, expira_en) values
  (repeat('a', 36), '11111111-1111-1111-1111-111111111111', now() + interval '15 minutes'),
  (repeat('b', 36), '22222222-2222-2222-2222-222222222222', now() + interval '15 minutes');

-- --- 1. lo que SÍ puede hacer el móvil -------------------------------------
set role anon;

do $$
begin
  assert public.estado_escaneo(repeat('a', 36), true) = 'ok',
    'FALLO: anon no puede consultar una sesión viva';
  assert public.enviar_escaneo(repeat('a', 36), '3017620422003') = 'ok',
    'FALLO: anon no puede mandar un código';
  assert public.enviar_escaneo(repeat('a', 36), '96385074') = 'ok',
    'FALLO: anon no puede mandar un segundo código';
end $$;

-- --- 2. lo que NO puede hacer -----------------------------------------------
do $$
declare
  s text;
  ok boolean;
begin
  foreach s in array array[
    'select 1 from public.sesiones_escaneo',
    'select 1 from public.escaneos',
    'insert into public.escaneos (token, codigo) values (repeat(''a'',36), ''3017620422003'')',
    'insert into public.sesiones_escaneo (token, expira_en) values (repeat(''c'',36), now())',
    'update public.sesiones_escaneo set cerrada = true',
    'delete from public.escaneos'
  ] loop
    ok := false;
    begin
      execute s;
    exception when insufficient_privilege then ok := true;
    end;
    assert ok, format('FALLO: anon ha podido ejecutar «%s»', s);
  end loop;
end $$;

-- --- 3. lo que valida antes de aceptar --------------------------------------
do $$
begin
  assert public.estado_escaneo(repeat('f', 36)) = 'no_existe',
    'FALLO: un token inventado debería dar no_existe';
  assert public.enviar_escaneo(repeat('a', 36), 'no-soy-un-codigo') = 'codigo_invalido',
    'FALLO: un código con letras debería rechazarse';
  assert public.enviar_escaneo(repeat('f', 36), '3017620422003') = 'no_existe',
    'FALLO: no se puede mandar a una sesión que no existe';

  -- Repetir el mismo código enseguida no duplica: la cámara lee el mismo
  -- envase muchas veces por segundo.
  perform public.enviar_escaneo(repeat('a', 36), '96385074');
end $$;

-- --- 4. cada uno ve lo suyo, y solo lo suyo ---------------------------------
set role authenticated;
set app.usuario_actual = '11111111-1111-1111-1111-111111111111';

do $$
declare n integer;
begin
  select count(*) into n from public.escaneos;
  assert n = 2, format('FALLO: Ana debería ver sus 2 escaneos y ve %s', n);
  select count(*) into n from public.sesiones_escaneo;
  assert n = 1, format('FALLO: Ana debería ver 1 sesión y ve %s', n);
end $$;

set app.usuario_actual = '22222222-2222-2222-2222-222222222222';

do $$
declare n integer;
begin
  -- Ésta es la comprobación que cazó el fallo de verdad: la política de
  -- `escaneos` comparaba `s.token = token`, y como las dos tablas tienen una
  -- columna con ese nombre, se resolvía contra sí misma y no filtraba nada.
  select count(*) into n from public.escaneos;
  assert n = 0, format('FALLO: Luis no debería ver ningún escaneo y ve %s', n);
  select count(*) into n from public.sesiones_escaneo;
  assert n = 1, format('FALLO: Luis debería ver solo su sesión y ve %s', n);
end $$;

-- --- 5. caducar, cerrar y pedir escribir a mano -----------------------------
set app.usuario_actual = '11111111-1111-1111-1111-111111111111';
update public.sesiones_escaneo set expira_en = now() - interval '1 minute'
  where token = repeat('a', 36);

set role anon;
do $$
begin
  assert public.estado_escaneo(repeat('a', 36)) = 'caducada',
    'FALLO: una sesión pasada de hora debería dar caducada';
  assert public.enviar_escaneo(repeat('a', 36), '3017620422003') = 'caducada',
    'FALLO: no se puede mandar a una sesión caducada';
end $$;

set role authenticated;
set app.usuario_actual = '11111111-1111-1111-1111-111111111111';
update public.sesiones_escaneo set expira_en = now() + interval '15 minutes'
  where token = repeat('a', 36);

set role anon;
do $$
begin
  assert public.pedir_escribir_a_mano(repeat('a', 36)) = 'ok',
    'FALLO: el móvil debería poder pedir escribir a mano';
  -- Y esa petición cierra la sesión: el móvil ya no pinta nada.
  assert public.estado_escaneo(repeat('a', 36)) = 'cerrada',
    'FALLO: pedir escribir a mano debería cerrar la sesión';
  assert public.enviar_escaneo(repeat('a', 36), '3017620422003') = 'cerrada',
    'FALLO: no se puede mandar a una sesión cerrada';
end $$;

set role authenticated;
set app.usuario_actual = '11111111-1111-1111-1111-111111111111';

do $$
declare n integer;
begin
  select count(*) into n from public.sesiones_escaneo
    where token = repeat('a', 36) and peticion = 'escribir_a_mano';
  assert n = 1, 'FALLO: la petición del móvil no ha llegado al ordenador';
end $$;

-- --- 6. el tope de la cola --------------------------------------------------
update public.sesiones_escaneo set cerrada = false where token = repeat('a', 36);
insert into public.escaneos (token, codigo)
  select repeat('a', 36), lpad((1000000000000 + g)::text, 13, '0')
  from generate_series(1, 200) g;

set role anon;
do $$
begin
  assert public.enviar_escaneo(repeat('a', 36), '3017620422003') = 'demasiados',
    'FALLO: pasado el tope debería decir demasiados';
end $$;

-- --- 7. borrar la sesión se lleva su cola -----------------------------------
set role authenticated;
set app.usuario_actual = '11111111-1111-1111-1111-111111111111';
delete from public.sesiones_escaneo where token = repeat('a', 36);

do $$
declare n integer;
begin
  select count(*) into n from public.escaneos;
  assert n = 0, format('FALLO: al borrar la sesión debería irse su cola, y quedan %s', n);
end $$;

-- --- 8. la forma del token --------------------------------------------------
do $$
declare ok boolean := false;
begin
  begin
    insert into public.sesiones_escaneo (token, expira_en)
      values ('corto', now() + interval '1 hour');
  exception when check_violation then ok := true;
  end;
  assert ok, 'FALLO: un token de cinco letras debería rechazarse';
end $$;

reset role;
reset app.usuario_actual;

\echo 'Batería 06 (escaneo remoto): todo correcto.'

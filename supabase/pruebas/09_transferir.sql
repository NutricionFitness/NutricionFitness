-- ============================================================================
-- Novena batería · transferir dietas  (0013_transferir_dietas.sql)
-- ============================================================================
-- Contra un PostgreSQL de verdad.
--
-- Dos cosas del arnés que no son gratis y conviene no deshacer:
--
--   · Los `set role` van a nivel de sentencia y se deshacen a mano. Con el
--     superusuario el RLS no se aplica, así que una prueba de política que se
--     quedara con el rol puesto pasaría por el motivo equivocado —y una que se
--     quedara sin él tampoco probaría nada—.
--
--   · Cada escenario **monta su propio juego de datos** en vez de deshacer el
--     anterior. Deshacer con `rollback` se llevaría por delante las propias
--     anotaciones de la batería, que viven en una tabla. Todo corre dentro de
--     una transacción y al final se deshace entera.
--
--   · Quién eres se dice con `app.usuario_actual`, que es lo que lee la
--     `auth.uid()` de `00_stub_auth.sql`. Escribirlo en `request.jwt.claim.sub`
--     —el nombre que usa Supabase de verdad— deja `auth.uid()` en nulo, y
--     entonces TODA prueba de «esto no se puede» pasa por el motivo
--     equivocado. Las comprobaciones 4 y 5 son el control de eso: son las dos
--     únicas que exigen que algo SÍ funcione, y se ponen rojas si el arnés se
--     desconecta.
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off

create temporary table _resultados (n serial, ok boolean, que text);

-- `security definer` porque hay comprobaciones que se hacen con el rol
-- `authenticated` puesto, y `authenticated` no tiene permiso sobre la tabla de
-- anotaciones —ni debe tenerlo—. Sin esto la batería muere anotando, no
-- probando.
create or replace function pg_temp.comprobar(p_ok boolean, p_que text)
returns void language plpgsql security definer as $$
begin
  insert into _resultados (ok, que) values (coalesce(p_ok, false), p_que);
end $$;

-- Ejecuta algo como si fuera esa persona y dice si ha reventado. Para las
-- pruebas de «esto NO se puede». Devuelve el rol a su sitio pase lo que pase.
create or replace function pg_temp.revienta(p_sql text, p_como uuid)
returns boolean language plpgsql as $$
declare v_revento boolean;
begin
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('app.usuario_actual', p_como::text, true);
    execute p_sql;
    v_revento := false;
  exception when others then
    v_revento := true;
  end;
  perform set_config('role', 'postgres', true);
  return v_revento;
end $$;

-- Lo mismo, pero como `anon`: el rol de quien entra sin sesión.
create or replace function pg_temp.revienta_de_anon(p_sql text)
returns boolean language plpgsql as $$
declare v_revento boolean;
begin
  begin
    perform set_config('role', 'anon', true);
    execute p_sql;
    v_revento := false;
  exception when others then
    v_revento := true;
  end;
  perform set_config('role', 'postgres', true);
  return v_revento;
end $$;

create or replace function pg_temp.como(p_quien uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('app.usuario_actual', p_quien::text, true);
end $$;

create or replace function pg_temp.otra_vez_root() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end $$;

-- Monta, para el escenario `n`:
--
--   cuenta A ── Ana(n) ──── raíz (v1) ── media (v2) ── hoja (v3)
--            └─ Marta(n)
--   cuenta B ── Berta(n)
--
-- La dieta media lleva una comida con dos opciones y un componente, para ver
-- que la transferencia no le hace nada.
create or replace function pg_temp.montar(p_n integer) returns void
language plpgsql as $$
declare
  v_ana   uuid := format('a%s000000-0000-0000-0000-00000000000a', p_n)::uuid;
  v_marta uuid := format('a%s000000-0000-0000-0000-00000000000b', p_n)::uuid;
  v_berta uuid := format('b%s000000-0000-0000-0000-00000000000a', p_n)::uuid;
  v_raiz  uuid := format('d%s000000-0000-0000-0000-000000000001', p_n)::uuid;
  v_media uuid := format('d%s000000-0000-0000-0000-000000000002', p_n)::uuid;
  v_hoja  uuid := format('d%s000000-0000-0000-0000-000000000003', p_n)::uuid;
  v_comida uuid := format('c%s000000-0000-0000-0000-000000000001', p_n)::uuid;
  v_op    uuid;
  v_ing   bigint;
begin
  insert into public.personas (id, owner_id, nombre) values
    (v_ana,   '11111111-1111-1111-1111-111111111111', 'Ana '   || p_n),
    (v_marta, '11111111-1111-1111-1111-111111111111', 'Marta ' || p_n),
    (v_berta, '22222222-2222-2222-2222-222222222222', 'Berta ' || p_n);

  insert into public.dietas (id, owner_id, persona_id, nombre, version, dieta_padre_id)
  values
    (v_raiz,  '11111111-1111-1111-1111-111111111111', v_ana, 'Raíz '  || p_n, 1, null),
    (v_media, '11111111-1111-1111-1111-111111111111', v_ana, 'Media ' || p_n, 2, v_raiz),
    (v_hoja,  '11111111-1111-1111-1111-111111111111', v_ana, 'Hoja '  || p_n, 3, v_media);

  insert into public.comidas (id, dieta_id, nombre, orden)
  values (v_comida, v_media, 'Desayuno', 0);

  insert into public.opciones (comida_id, nombre, orden)
  values (v_comida, 'Con tostada', 1) returning id into v_op;

  select id into v_ing from public.ingredientes limit 1;
  insert into public.componentes (comida_id, opcion_id, ingrediente_id, gramos)
  values (v_comida, v_op, v_ing, 60);
end $$;

begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@x'),
  ('22222222-2222-2222-2222-222222222222', 'b@x');

insert into public.ingredientes (owner_id, nombre, nombre_norm, prot_100, hc_100, grasa_100, preferente)
values (null, 'Arroz blanco', 'arroz blanco', 7, 78, 0.9, true);

-- ============================================================================
-- 1 · El agujero que cierra esta migración
-- ============================================================================
select pg_temp.montar(1);

select pg_temp.comprobar(
  pg_temp.revienta(
    $$update public.dietas set persona_id = 'b1000000-0000-0000-0000-00000000000a'
       where id = 'd1000000-0000-0000-0000-000000000001'$$,
    '11111111-1111-1111-1111-111111111111'),
  'un update directo NO puede colgar mi dieta de la persona de otra cuenta');

select pg_temp.comprobar(
  pg_temp.revienta(
    $$select public.duplicar_dieta('d1000000-0000-0000-0000-000000000001',
        'colada', 'b1000000-0000-0000-0000-00000000000a')$$,
    '11111111-1111-1111-1111-111111111111'),
  'duplicar_dieta NO acepta una persona de otra cuenta');

select pg_temp.comprobar(
  pg_temp.revienta(
    $$insert into public.dietas (persona_id, nombre)
      values ('b1000000-0000-0000-0000-00000000000a', 'colada')$$,
    '11111111-1111-1111-1111-111111111111'),
  'tampoco al crear una dieta nueva');

select pg_temp.comprobar(
  not pg_temp.revienta(
    $$insert into public.dietas (persona_id, nombre)
      values ('a1000000-0000-0000-0000-00000000000b', 'para Marta')$$,
    '11111111-1111-1111-1111-111111111111'),
  'el disparador no se pasa: crear en una persona propia sigue valiendo');

select pg_temp.comprobar(
  not pg_temp.revienta(
    $$insert into public.dietas (persona_id, nombre) values (null, 'sin persona')$$,
    '11111111-1111-1111-1111-111111111111'),
  'una dieta sin persona sigue valiendo');

-- ============================================================================
-- 2 · Transferir el linaje entero
-- ============================================================================
select pg_temp.montar(2);
select pg_temp.como('11111111-1111-1111-1111-111111111111');

-- Se pulsa sobre la HOJA: tiene que llevarse las tres.
select pg_temp.comprobar(
  public.transferir_dieta('d2000000-0000-0000-0000-000000000003',
    'a2000000-0000-0000-0000-00000000000b', 'linaje') = 3,
  'linaje: devuelve 3, que son las que ha movido');

select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select count(*) = 3 from public.dietas
    where persona_id = 'a2000000-0000-0000-0000-00000000000b'),
  'linaje: pulsando en la hoja se mueven las tres versiones');

select pg_temp.comprobar(
  (select count(*) = 0 from public.dietas
    where persona_id = 'a2000000-0000-0000-0000-00000000000a'),
  'linaje: no queda ninguna en la persona de origen');

select pg_temp.comprobar(
  (select dieta_padre_id = 'd2000000-0000-0000-0000-000000000002'
     from public.dietas where id = 'd2000000-0000-0000-0000-000000000003'),
  'linaje: el árbol de versiones queda intacto');

select pg_temp.comprobar(
  (select version = 3 from public.dietas
    where id = 'd2000000-0000-0000-0000-000000000003'),
  'linaje: los números de versión no se tocan');

select pg_temp.comprobar(
  (select count(*) = 2 from public.opciones
    where comida_id = 'c2000000-0000-0000-0000-000000000001'),
  'linaje: las opciones de las comidas siguen ahí');

select pg_temp.comprobar(
  (select count(*) = 1 from public.componentes
    where comida_id = 'c2000000-0000-0000-0000-000000000001'),
  'linaje: los componentes siguen ahí');

-- ============================================================================
-- 3 · Transferir solo esa versión, desgajándola
-- ============================================================================
select pg_temp.montar(3);
select pg_temp.como('11111111-1111-1111-1111-111111111111');

select pg_temp.comprobar(
  public.transferir_dieta('d3000000-0000-0000-0000-000000000002',
    'a3000000-0000-0000-0000-00000000000b', 'sola') = 1,
  'sola: devuelve 1');

select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select persona_id = 'a3000000-0000-0000-0000-00000000000b'
     from public.dietas where id = 'd3000000-0000-0000-0000-000000000002'),
  'sola: la elegida cambia de persona');

select pg_temp.comprobar(
  (select persona_id = 'a3000000-0000-0000-0000-00000000000a'
     from public.dietas where id = 'd3000000-0000-0000-0000-000000000001')
  and
  (select persona_id = 'a3000000-0000-0000-0000-00000000000a'
     from public.dietas where id = 'd3000000-0000-0000-0000-000000000003'),
  'sola: la madre y la hija se quedan donde estaban');

select pg_temp.comprobar(
  (select dieta_padre_id is null and version = 1
     from public.dietas where id = 'd3000000-0000-0000-0000-000000000002'),
  'sola: la desgajada queda sin madre y en versión 1');

-- La que importa.
select pg_temp.comprobar(
  (select dieta_padre_id = 'd3000000-0000-0000-0000-000000000001'
     from public.dietas where id = 'd3000000-0000-0000-0000-000000000003'),
  'sola: la hija se recuelga de la abuela, no queda apuntando a la que se fue');

select pg_temp.comprobar(
  (select count(*) = 2 from public.linaje_dieta('d3000000-0000-0000-0000-000000000001')),
  'sola: el historial de origen queda con dos y no entra en la transferida');

select pg_temp.comprobar(
  (select count(*) = 1 from public.linaje_dieta('d3000000-0000-0000-0000-000000000002')),
  'sola: la transferida es su propio árbol');

select pg_temp.comprobar(
  (select version = 3 from public.dietas
    where id = 'd3000000-0000-0000-0000-000000000003'),
  'sola: la hija recolgada conserva su número, con el hueco donde estaba la v2');

-- Desgajar la RAÍZ: las hijas se quedan sin abuela y pasan a ser raíces.
select pg_temp.montar(4);
select pg_temp.como('11111111-1111-1111-1111-111111111111');
select public.transferir_dieta('d4000000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-00000000000b', 'sola');
select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select dieta_padre_id is null
     from public.dietas where id = 'd4000000-0000-0000-0000-000000000002'),
  'sola sobre la raíz: la hija se queda como raíz, no colgando de nada');

select pg_temp.comprobar(
  (select count(*) = 2 from public.linaje_dieta('d4000000-0000-0000-0000-000000000002')),
  'sola sobre la raíz: lo que queda sigue siendo un árbol de dos');

-- Desgajar una HOJA no deja nada colgando.
select pg_temp.montar(5);
select pg_temp.como('11111111-1111-1111-1111-111111111111');
select public.transferir_dieta('d5000000-0000-0000-0000-000000000003',
  'a5000000-0000-0000-0000-00000000000b', 'sola');
select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select count(*) = 2 from public.linaje_dieta('d5000000-0000-0000-0000-000000000001')),
  'sola sobre una hoja: el origen se queda con dos');

-- ============================================================================
-- 4 · Lo que la función NO deja hacer
-- ============================================================================
select pg_temp.montar(6);

select pg_temp.comprobar(
  pg_temp.revienta(
    $$select public.transferir_dieta('d6000000-0000-0000-0000-000000000001',
        'b6000000-0000-0000-0000-00000000000a', 'linaje')$$,
    '11111111-1111-1111-1111-111111111111'),
  'no se puede transferir a una persona de otra cuenta');

select pg_temp.comprobar(
  pg_temp.revienta(
    $$select public.transferir_dieta('d6000000-0000-0000-0000-000000000001',
        'a6000000-0000-0000-0000-00000000000b', 'a medias')$$,
    '11111111-1111-1111-1111-111111111111'),
  'un alcance que no existe se rechaza');

select pg_temp.comprobar(
  pg_temp.revienta(
    $$select public.transferir_dieta('d6000000-0000-0000-0000-000000000001',
        'a6000000-0000-0000-0000-00000000000a', 'linaje')$$,
    '11111111-1111-1111-1111-111111111111'),
  'transferir a la persona que ya la tiene se rechaza');

select pg_temp.comprobar(
  pg_temp.revienta(
    $$select public.transferir_dieta('d6000000-0000-0000-0000-000000000001',
        'b6000000-0000-0000-0000-00000000000a', 'linaje')$$,
    '22222222-2222-2222-2222-222222222222'),
  'otra cuenta no puede transferirse la dieta de A');

select pg_temp.comprobar(
  pg_temp.revienta(
    $$select public.transferir_dieta(
        '00000000-0000-0000-0000-0000000000ff',
        'a6000000-0000-0000-0000-00000000000b', 'linaje')$$,
    '11111111-1111-1111-1111-111111111111'),
  'una dieta que no existe se rechaza');

select pg_temp.como('22222222-2222-2222-2222-222222222222');
select pg_temp.comprobar(
  (select count(*) = 0 from public.dietas),
  'y la otra cuenta sigue sin ver ninguna dieta de A');
select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select persona_id = 'a6000000-0000-0000-0000-00000000000a'
     from public.dietas where id = 'd6000000-0000-0000-0000-000000000001'),
  'después de los cinco intentos, la dieta sigue donde estaba');

-- ============================================================================
-- 5 · Copiar a otra persona (duplicar_dieta con p_persona_id)
-- ============================================================================
select pg_temp.montar(7);
select pg_temp.como('11111111-1111-1111-1111-111111111111');
select public.duplicar_dieta('d7000000-0000-0000-0000-000000000002',
  'Desayuno de Marta', 'a7000000-0000-0000-0000-00000000000b');
select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select persona_id = 'a7000000-0000-0000-0000-00000000000a'
     from public.dietas where id = 'd7000000-0000-0000-0000-000000000002'),
  'copiar: el original se queda con Ana');

select pg_temp.comprobar(
  (select persona_id = 'a7000000-0000-0000-0000-00000000000b' and version = 1
      and dieta_padre_id is null
     from public.dietas where nombre = 'Desayuno de Marta'),
  'copiar: la copia va a Marta, independiente, versión 1 y sin madre');

select pg_temp.comprobar(
  (select count(*) = 2 from public.opciones o
     join public.comidas m on m.id = o.comida_id
     join public.dietas d on d.id = m.dieta_id
    where d.nombre = 'Desayuno de Marta'),
  'copiar: se lleva las dos opciones de la comida');

select pg_temp.comprobar(
  (select count(*) = 1 from public.comidas m
     join public.dietas d on d.id = m.dieta_id
    where d.nombre = 'Desayuno de Marta' and m.opcion_activa_id is not null),
  'copiar: la copia tiene su opción activa marcada');

select pg_temp.comprobar(
  (select count(*) = 0 from public.componentes c
     join public.opciones o on o.id = c.opcion_id
     join public.comidas m on m.id = o.comida_id
     join public.dietas d on d.id = m.dieta_id
    where d.nombre = 'Desayuno de Marta' and c.comida_id <> m.id),
  'copiar: ningún componente queda apuntando a la comida del original');

-- ============================================================================
-- 6 · Lo que puede hacer quien no ha entrado, que es nada
-- ============================================================================
-- `transferir_dieta` es `security invoker` y no lleva `revoke`: `anon` PUEDE
-- ejecutarla —el `execute` le llega por `public`, y quitárselo por su nombre no
-- se lo quita—. Lo que lo para es no tener permiso sobre las tablas, y muere en
-- el primer `select` de la función. Se comprueba aquí porque es lo que de
-- verdad sostiene la puerta, y porque un `revoke ... from anon` en la migración
-- habría parecido que la sostenía él.
select pg_temp.montar(8);

-- El control de las dos de abajo: si `revienta_de_anon` reventara siempre —por
-- no poder ni ponerse el rol—, las dos pasarían sin probar nada.
select pg_temp.comprobar(
  not pg_temp.revienta_de_anon($$select 1$$),
  'control: como anon, algo inocuo NO revienta');

select pg_temp.comprobar(
  pg_temp.revienta_de_anon(
    $$select public.transferir_dieta('d8000000-0000-0000-0000-000000000001',
        'a8000000-0000-0000-0000-00000000000b', 'linaje')$$),
  'anon no puede transferir: no tiene permiso sobre las tablas');

select pg_temp.comprobar(
  pg_temp.revienta_de_anon(
    $$update public.dietas set persona_id = 'a8000000-0000-0000-0000-00000000000b'
       where id = 'd8000000-0000-0000-0000-000000000001'$$),
  'anon tampoco por update directo');

-- ============================================================================
-- 7 · Y lo que la app ya hacía sigue haciéndose
-- ============================================================================
-- `actualizarDieta` acepta `persona_id` entre sus cambios: mover una dieta a
-- otra persona propia con un `update` normal es un camino que ya existe en la
-- pantalla, y el disparador nuevo no puede cerrarlo.
select pg_temp.comprobar(
  not pg_temp.revienta(
    $$update public.dietas set persona_id = 'a8000000-0000-0000-0000-00000000000b'
       where id = 'd8000000-0000-0000-0000-000000000001'$$,
    '11111111-1111-1111-1111-111111111111'),
  'cambiar de persona con un update normal, dentro de mi cuenta, sigue valiendo');

select pg_temp.comprobar(
  (select persona_id = 'a8000000-0000-0000-0000-00000000000b'
     from public.dietas where id = 'd8000000-0000-0000-0000-000000000001'),
  'y el cambio se ha guardado de verdad');

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
    raise exception 'La novena batería tiene % comprobaciones en rojo', v_mal;
  end if;
  raise notice 'Novena batería: % comprobaciones, todas en verde',
    (select count(*) from _resultados);
end $$;

rollback;

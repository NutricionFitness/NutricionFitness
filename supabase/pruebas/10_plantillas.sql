-- ============================================================================
-- Décima batería · plantillas de opción  (0014_plantillas_opcion.sql)
-- ============================================================================
-- Contra un PostgreSQL de verdad, con el esquema levantado desde las
-- migraciones de este repo:
--
--   psql -d appnut -f supabase/pruebas/00_stub_auth.sql
--   psql -d appnut -f supabase/migraciones/0001_esquema.sql   ... hasta la 0014
--   psql -d appnut -f supabase/pruebas/10_plantillas.sql
--
-- Del arnés, lo mismo que en la novena:
--
--   · Quién eres se dice con `app.usuario_actual`, que es lo que lee la
--     `auth.uid()` de `00_stub_auth.sql`. Con el nombre equivocado `auth.uid()`
--     es nulo y **toda** prueba de «esto no se puede» pasa por el motivo
--     equivocado; por eso hay comprobaciones de control que exigen que algo SÍ
--     funcione.
--   · Los `set role` van a nivel de sentencia: con el superusuario el RLS no se
--     aplica.
--   · Cada escenario monta lo suyo. Todo dentro de una transacción que se
--     deshace al final.
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off

create temporary table _resultados (n serial, ok boolean, que text);

-- `security definer` porque hay comprobaciones que corren con el rol
-- `authenticated` puesto, y `authenticated` no tiene permiso sobre la tabla de
-- anotaciones —ni debe tenerlo—.
create or replace function pg_temp.comprobar(p_ok boolean, p_que text)
returns void language plpgsql security definer as $$
begin
  insert into _resultados (ok, que) values (coalesce(p_ok, false), p_que);
end $$;

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

begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ana@x'),
  ('22222222-2222-2222-2222-222222222222', 'luis@x');

insert into public.ingredientes
  (id, owner_id, codigo_bedca, nombre, nombre_norm, grupo, estado,
   prot_100, hc_100, grasa_100, fibra_100, alcohol_100, preferente)
overriding system value
values
  (910001, null, 'P001', 'Pan de prueba',   'pan de prueba',   'Cereales y derivados', 'crudo', 8, 50, 1.5, 3, 0, true),
  (910002, null, 'P002', 'Aceite de prueba','aceite de prueba','Grasas',               'crudo', 0,  0,  99, 0, 0, true)
on conflict (id) do nothing;

-- ============================================================================
-- 1 · Se puede guardar una plantilla, y nace siendo tuya
-- ============================================================================
select pg_temp.como('11111111-1111-1111-1111-111111111111');

insert into public.plantillas (id, nombre, comida_sugerida, estado_cantidades)
values ('11110000-0000-0000-0000-000000000001', 'Desayuno con tostada', 'Desayuno', 'crudo');

insert into public.plantilla_componentes (plantilla_id, ingrediente_id, gramos, orden)
values
  ('11110000-0000-0000-0000-000000000001', 910001, 60, 0),
  ('11110000-0000-0000-0000-000000000001', 910002, 10, 1);

select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select owner_id = '11111111-1111-1111-1111-111111111111'
     from public.plantillas where id = '11110000-0000-0000-0000-000000000001'),
  'el dueño lo pone la base con auth.uid(), no el cliente');

select pg_temp.comprobar(
  (select count(*) = 2 from public.plantilla_componentes
    where plantilla_id = '11110000-0000-0000-0000-000000000001'),
  'la plantilla guarda sus componentes');

-- Control del arnés: si esto fallara, todas las de «no se puede» de abajo
-- estarían pasando por el motivo equivocado.
select pg_temp.comprobar(
  not pg_temp.revienta(
    $$insert into public.plantillas (nombre) values ('control, se puede')$$,
    '11111111-1111-1111-1111-111111111111'),
  'control: guardar una plantilla propia SÍ se puede');

-- ============================================================================
-- 2 · Lo que no se puede guardar dentro
-- ============================================================================
-- Los `check` son los mismos que los de `componentes`: una plantilla se importa
-- copiándola a `componentes`, así que lo que no valga allí no puede valer aquí.

select pg_temp.comprobar(
  pg_temp.revienta(
    $$insert into public.plantilla_componentes (plantilla_id, ingrediente_id, gramos)
      values ('11110000-0000-0000-0000-000000000001', 910001, -5)$$,
    '11111111-1111-1111-1111-111111111111'),
  'gramos negativos, no');

select pg_temp.comprobar(
  pg_temp.revienta(
    $$insert into public.plantilla_componentes (plantilla_id, ingrediente_id, gramos, paso_g)
      values ('11110000-0000-0000-0000-000000000001', 910001, 50, 0)$$,
    '11111111-1111-1111-1111-111111111111'),
  'un paso de 0 g, tampoco: el motor se quedaría dando vueltas');

select pg_temp.comprobar(
  pg_temp.revienta(
    $$insert into public.plantilla_componentes (plantilla_id, ingrediente_id, gramos, prioridad)
      values ('11110000-0000-0000-0000-000000000001', 910001, 50, -1)$$,
    '11111111-1111-1111-1111-111111111111'),
  'prioridad negativa, no');

select pg_temp.comprobar(
  pg_temp.revienta(
    $$insert into public.plantilla_componentes (plantilla_id, ingrediente_id, gramos, min_g, max_g)
      values ('11110000-0000-0000-0000-000000000001', 910001, 50, 90, 10)$$,
    '11111111-1111-1111-1111-111111111111'),
  'un mínimo por encima del máximo, no');

select pg_temp.comprobar(
  pg_temp.revienta(
    $$insert into public.plantillas (nombre, estado_cantidades)
      values ('estado raro', 'escabechado')$$,
    '11111111-1111-1111-1111-111111111111'),
  'estado_cantidades solo admite crudo, cocido o mixto');

select pg_temp.comprobar(
  pg_temp.revienta(
    $$insert into public.plantillas (nombre) values ('   ')$$,
    '11111111-1111-1111-1111-111111111111'),
  'una plantilla sin nombre de verdad, no');

-- ============================================================================
-- 3 · Dos plantillas mías no se llaman igual; las de otra cuenta, sí
-- ============================================================================
-- Es lo que hace que «guardar como plantilla» con un nombre que ya existe dé
-- error en vez de reemplazar en silencio.

select pg_temp.comprobar(
  pg_temp.revienta(
    $$insert into public.plantillas (nombre) values ('Desayuno con tostada')$$,
    '11111111-1111-1111-1111-111111111111'),
  'dos plantillas mías con el mismo nombre chocan');

select pg_temp.comprobar(
  not pg_temp.revienta(
    $$insert into public.plantillas (nombre) values ('Desayuno con tostada')$$,
    '22222222-2222-2222-2222-222222222222'),
  'pero Luis sí puede tener una suya que se llame igual');

-- ============================================================================
-- 4 · El acceso está cerrado
-- ============================================================================
select pg_temp.como('22222222-2222-2222-2222-222222222222');

select pg_temp.comprobar(
  (select count(*) = 0 from public.plantillas
    where id = '11110000-0000-0000-0000-000000000001'),
  'Luis no ve la plantilla de Ana');

select pg_temp.comprobar(
  (select count(*) = 0 from public.plantilla_componentes
    where plantilla_id = '11110000-0000-0000-0000-000000000001'),
  'ni sus componentes');

select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  pg_temp.revienta(
    $$insert into public.plantilla_componentes (plantilla_id, ingrediente_id, gramos)
      values ('11110000-0000-0000-0000-000000000001', 910001, 30)$$,
    '22222222-2222-2222-2222-222222222222'),
  'Luis no puede colgar nada de la plantilla de Ana');

-- El RLS no da error al no dejar: **filtra**. Así que lo que se comprueba es
-- que no cambió nada, no que reventara.
select pg_temp.como('22222222-2222-2222-2222-222222222222');
update public.plantillas set nombre = 'Mía ahora'
 where id = '11110000-0000-0000-0000-000000000001';
delete from public.plantilla_componentes
 where plantilla_id = '11110000-0000-0000-0000-000000000001';
select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select nombre = 'Desayuno con tostada'
     from public.plantillas where id = '11110000-0000-0000-0000-000000000001'),
  'Luis no ha podido renombrar la plantilla de Ana');

select pg_temp.comprobar(
  (select count(*) = 2 from public.plantilla_componentes
    where plantilla_id = '11110000-0000-0000-0000-000000000001'),
  'ni vaciarla');

-- ============================================================================
-- 5 · Lo que arrastra un borrado
-- ============================================================================
-- Igual que en `componentes`: una plantilla protege sus ingredientes. Sin esto,
-- borrar un ingrediente propio dejaría plantillas con un hueco que no se vería
-- hasta importarlas.
insert into public.ingredientes
  (id, owner_id, codigo_bedca, nombre, nombre_norm, prot_100, hc_100, grasa_100, preferente)
overriding system value
values (910003, '11111111-1111-1111-1111-111111111111', null,
        'Receta de Ana', 'receta de ana', 5, 5, 5, true);

select pg_temp.como('11111111-1111-1111-1111-111111111111');
insert into public.plantillas (id, nombre)
values ('11110000-0000-0000-0000-000000000002', 'Con la receta');
insert into public.plantilla_componentes (plantilla_id, ingrediente_id, gramos)
values ('11110000-0000-0000-0000-000000000002', 910003, 100);
select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  pg_temp.revienta(
    $$delete from public.ingredientes where id = 910003$$,
    '11111111-1111-1111-1111-111111111111'),
  'un ingrediente que está en una plantilla no se puede borrar');

select pg_temp.como('11111111-1111-1111-1111-111111111111');
delete from public.plantillas where id = '11110000-0000-0000-0000-000000000002';
select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select count(*) = 0 from public.plantilla_componentes
    where plantilla_id = '11110000-0000-0000-0000-000000000002'),
  'borrar la plantilla se lleva sus componentes');

select pg_temp.comprobar(
  not pg_temp.revienta(
    $$delete from public.ingredientes where id = 910003$$,
    '11111111-1111-1111-1111-111111111111'),
  'y después el ingrediente ya se puede borrar');

-- ============================================================================
-- 6 · Una plantilla es una foto, no un enlace
-- ============================================================================
-- No hay clave ajena a la dieta de la que salió, a propósito: si la hubiera,
-- tocar una plantilla podría romper «las opciones de una comida valen lo mismo»
-- desde fuera de la dieta y sin que nadie lo mire. Esto lo fija.
select pg_temp.como('11111111-1111-1111-1111-111111111111');
insert into public.personas (id, nombre)
values ('aaaa0000-0000-0000-0000-00000000000a', 'Ana');
insert into public.dietas (id, persona_id, nombre)
values ('dddd0000-0000-0000-0000-000000000001',
        'aaaa0000-0000-0000-0000-00000000000a', 'Dieta de la que sale');
insert into public.comidas (id, dieta_id, nombre, orden)
values ('cccc0000-0000-0000-0000-000000000001',
        'dddd0000-0000-0000-0000-000000000001', 'Desayuno', 0);
delete from public.dietas where id = 'dddd0000-0000-0000-0000-000000000001';
select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select count(*) = 1 from public.plantillas
    where id = '11110000-0000-0000-0000-000000000001'),
  'borrar la dieta de la que salió no toca la plantilla');

select pg_temp.comprobar(
  (select count(*) = 2 from public.plantilla_componentes
    where plantilla_id = '11110000-0000-0000-0000-000000000001'),
  'ni sus componentes');

-- ============================================================================
-- 7 · Una sola clave ajena entre las dos tablas
-- ============================================================================
-- La lección de la fase 21, fijada en una prueba y no en un comentario: con dos
-- caminos posibles PostgREST no elige para anidar, devuelve un error de
-- ambigüedad, y la pantalla se cae entera. Aquí se anida
-- `plantillas ( plantilla_componentes ( … ) )`.
select pg_temp.comprobar(
  (select count(*) = 1 from pg_constraint c
     join pg_class t on t.oid = c.conrelid
     join pg_class f on f.oid = c.confrelid
    where c.contype = 'f'
      and ((t.relname = 'plantilla_componentes' and f.relname = 'plantillas')
        or (t.relname = 'plantillas' and f.relname = 'plantilla_componentes'))),
  'hay UNA sola clave ajena entre plantillas y plantilla_componentes');

-- ============================================================================
-- 8 · Y `anon` no llega a nada
-- ============================================================================
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

select pg_temp.comprobar(
  not pg_temp.revienta_de_anon($$select 1$$),
  'control: como anon, algo inocuo NO revienta');

select pg_temp.comprobar(
  pg_temp.revienta_de_anon($$select count(*) from public.plantillas$$),
  'anon no puede ni leer las plantillas');

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
    raise exception 'La décima batería tiene % comprobaciones en rojo', v_mal;
  end if;
  raise notice 'Décima batería: % comprobaciones, todas en verde',
    (select count(*) from _resultados);
end $$;

rollback;

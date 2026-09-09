-- ============================================================================
-- Duodécima batería · el volcado de Open Food Facts (migración 0018)
-- ============================================================================
-- Lo que hay que demostrar aquí no es que la carga escriba filas —eso se ve—,
-- sino las cuatro cosas que el volcado pone en peligro y que nadie mira:
--
--   1. Que una recarga no pisa lo corregido a mano ni lo que no es del volcado.
--   2. Que el catálogo con el que se sustituye SIGUE siendo el de antes: 1.090
--      genéricos y ni un producto de marca. Es la comprobación más importante
--      de la batería, porque el fallo que evita **no da error**: `limit(1200)`
--      era «todo el catálogo» y con el volcado pasa a ser un trozo arbitrario.
--   3. Que los alérgenos declarados se rehacen en cada carga sin llevarse por
--      delante lo manual ni lo derivado.
--   4. Que `anon` sigue sin poder tocar nada, y que la preselección del
--      comparador respeta el interruptor `catalogo_publico`.
--
-- Del arnés, lo de siempre: `app.usuario_actual` es lo que lee la `auth.uid()`
-- de `00_stub_auth.sql`, los `set role` van a nivel de sentencia, y hay
-- comprobaciones de control que exigen que algo SÍ funcione —si no, todas las
-- de «esto no se puede» pasarían solas—.
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off

create temporary table _resultados (n serial, ok boolean, que text);

create or replace function pg_temp.comprobar(p_ok boolean, p_que text)
returns void language plpgsql security definer as $$
begin
  insert into _resultados (ok, que) values (coalesce(p_ok, false), p_que);
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

-- El arnés reconstruye lo que en Supabase hacen los «default privileges» del
-- proyecto: la 0001 concede sobre TODAS las tablas de entonces, y las que
-- crearon las migraciones posteriores —`alergenos` e `ingrediente_alergenos`,
-- de la 0007— no llevan `grant` propio. En Supabase funcionan porque el
-- proyecto tiene privilegios por defecto para `authenticated`; aquí no hay
-- ninguno, así que sin esto toda comprobación con sesión fallaría por permisos
-- y no por lo que se quiere probar.
grant select, insert, update, delete on all tables in schema public to authenticated;

begin;

-- ---------------------------------------------------------------- el decorado
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'carlos@ejemplo.es'),
  ('22222222-2222-2222-2222-222222222222', 'otra@ejemplo.es')
on conflict (id) do nothing;

insert into public.cuentas (owner_id, catalogo_publico) values
  ('11111111-1111-1111-1111-111111111111', false),
  ('22222222-2222-2222-2222-222222222222', false)
on conflict (owner_id) do nothing;

-- Dos genéricos «de BEDCA» y un ingrediente propio de cada cuenta.
insert into public.ingredientes
  (id, owner_id, codigo_bedca, fuente, nombre, nombre_norm, grupo, estado,
   prot_100, hc_100, grasa_100, preferente, revisado)
overriding system value values
  (900001, null, 'T-ARROZ', 'bedca', 'Arroz blanco, crudo', 'arroz blanco, crudo',
   'Cereales y derivados', 'crudo', 7.0, 78.0, 0.6, true, true),
  (900002, null, 'T-POLLO', 'bedca', 'Pollo, pechuga', 'pollo, pechuga',
   'Carnes y derivados', 'crudo', 22.0, 0.0, 2.0, true, true),
  (900003, '11111111-1111-1111-1111-111111111111', null, 'propio',
   'Batido propio', 'batido propio', 'Bebidas', 'listo', 5.0, 10.0, 1.0, true, true);

-- ---------------------------------------------------------------------------
-- 1 · La carga entra, y entra como lo que es
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  public.cargar_productos_off('[
    {"codigo_barras":"8410179000015","nombre":"Yogur natural (Hacendado)",
     "nombre_norm":"yogur natural (hacendado)","grupo":"Lácteos y derivados",
     "estado":"listo","prot_100":3.5,"hc_100":4.8,"grasa_100":3.2,
     "fibra_100":0,"alcohol_100":0,"notas":"Open Food Facts (ODbL)"},
    {"codigo_barras":"8076809513722","nombre":"Macarrones (Gallo)",
     "nombre_norm":"macarrones (gallo)","grupo":"Cereales y derivados",
     "estado":"seco","prot_100":12,"hc_100":72,"grasa_100":1.5,
     "fibra_100":3,"alcohol_100":0,"notas":"Open Food Facts (ODbL)"}
  ]'::jsonb) = 2,
  'la carga escribe los dos productos');

select pg_temp.comprobar(
  (select count(*) = 2 from public.ingredientes
    where fuente = 'openfoodfacts' and owner_id is null
      and preferente and not revisado and not alergenos_revisados
      and not editado_a_mano),
  'entran sin dueño, preferentes y SIN revisar');

select pg_temp.comprobar(
  (select abs(kcal_100 - (4*3.5 + 4*4.8 + 9*3.2)) < 0.01
     from public.ingredientes where codigo_barras = '8410179000015'),
  'la energía la calcula la base con Atwater, no el cargador');

-- ---------------------------------------------------------------------------
-- 2 · Recargar es idempotente, y no pisa lo que no debe
-- ---------------------------------------------------------------------------
update public.ingredientes
   set nombre = 'Yogur natural corregido', editado_a_mano = true
 where codigo_barras = '8410179000015';

select pg_temp.comprobar(
  public.cargar_productos_off('[
    {"codigo_barras":"8410179000015","nombre":"Yogur natural (Hacendado)",
     "nombre_norm":"yogur natural (hacendado)","grupo":"Lácteos y derivados",
     "estado":"listo","prot_100":9.9,"hc_100":9.9,"grasa_100":9.9,
     "fibra_100":0,"alcohol_100":0,"notas":"x"},
    {"codigo_barras":"8076809513722","nombre":"Macarrones (Gallo) v2",
     "nombre_norm":"macarrones (gallo) v2","grupo":"Cereales y derivados",
     "estado":"seco","prot_100":13,"hc_100":71,"grasa_100":1.6,
     "fibra_100":3,"alcohol_100":0,"notas":"x"}
  ]'::jsonb) >= 1,
  'una recarga no duplica: actualiza');

select pg_temp.comprobar(
  (select count(*) = 2 from public.ingredientes where fuente = 'openfoodfacts'),
  'siguen siendo dos filas, no cuatro');

select pg_temp.comprobar(
  (select nombre = 'Yogur natural corregido' and prot_100 = 3.5
     from public.ingredientes where codigo_barras = '8410179000015'),
  'lo corregido a mano NO se pisa');

select pg_temp.comprobar(
  (select nombre = 'Macarrones (Gallo) v2' and prot_100 = 13
     from public.ingredientes where codigo_barras = '8076809513722'),
  'CONTROL: lo que no está corregido sí se actualiza');

-- Y un ingrediente propio con el mismo código de barras no se toca: es de su
-- dueño, y el índice único es por (owner_id, codigo_barras).
insert into public.ingredientes
  (id, owner_id, fuente, codigo_barras, nombre, nombre_norm, estado,
   prot_100, hc_100, grasa_100, preferente, revisado)
overriding system value values
  (900004, '11111111-1111-1111-1111-111111111111', 'propio', '8076809513722',
   'Mis macarrones', 'mis macarrones', 'seco', 12, 72, 1.5, true, true);

select pg_temp.comprobar(
  public.cargar_productos_off('[
    {"codigo_barras":"8076809513722","nombre":"Macarrones (Gallo) v3",
     "nombre_norm":"macarrones (gallo) v3","grupo":"Cereales y derivados",
     "estado":"seco","prot_100":14,"hc_100":70,"grasa_100":1.7,
     "fibra_100":3,"alcohol_100":0,"notas":"x"}
  ]'::jsonb) = 1
  and (select nombre = 'Mis macarrones' from public.ingredientes where id = 900004),
  'el ingrediente propio con el mismo código no lo toca la carga');

-- ---------------------------------------------------------------------------
-- 3 · El catálogo con el que se sustituye no ha cambiado
--
-- Esta es la comprobación por la que existe la columna `fuente`. Sin el filtro,
-- la consulta del motor devuelve productos de marca y nadie se entera.
-- ---------------------------------------------------------------------------
-- El decorado tiene 4 genéricos preferentes: los 2 de BEDCA y los 2 propios.
-- Los 2 del volcado no cuentan, y ese es justo el punto.
select pg_temp.comprobar(
  (select count(*) = 4 from public.ingredientes
    where preferente and fuente <> 'openfoodfacts'),
  'el catálogo genérico son los de siempre: 2 de BEDCA + 2 propios');

select pg_temp.comprobar(
  not exists (
    select 1 from public.ingredientes
     where preferente and fuente <> 'openfoodfacts'
       and codigo_barras in ('8410179000015', '8076809513722')
       and owner_id is null),
  'ningún producto del volcado entra en el catálogo genérico');

-- CONTROL NEGATIVO: sin el filtro, sí entran. Si esta comprobación se pusiera
-- verde, querría decir que el volcado no ha cargado nada y que las dos de
-- arriba están pasando por el motivo equivocado.
select pg_temp.comprobar(
  exists (
    select 1 from public.ingredientes
     where preferente and codigo_barras = '8410179000015' and owner_id is null),
  'CONTROL: sin filtrar por fuente, el volcado sí sale');

-- ---------------------------------------------------------------------------
-- 4 · Los alérgenos declarados
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  public.cargar_alergenos_off(
    '[{"codigo_barras":"8410179000015","alergenos":["leche"]},
      {"codigo_barras":"8076809513722","alergenos":["gluten","huevos"]}]'::jsonb) = 3,
  'se marcan los alérgenos que declara la etiqueta');

select pg_temp.comprobar(
  (select count(*) = 3 from public.ingrediente_alergenos ia
     join public.ingredientes i on i.id = ia.ingrediente_id
    where i.fuente = 'openfoodfacts' and ia.origen = 'declarado'),
  'y van con origen ''declarado'', que la derivación no borra');

-- Alguien marca uno a mano y otro lo deduce el script de LanguaL.
insert into public.ingrediente_alergenos (ingrediente_id, alergeno_id, origen)
select i.id, a.id, o.origen
  from public.ingredientes i, public.alergenos a,
       (values ('manual'), ('derivado')) as o(origen)
 where i.codigo_barras = '8410179000015' and i.fuente = 'openfoodfacts'
   and a.codigo = case o.origen when 'manual' then 'soja' else 'apio' end
   and a.owner_id is null
on conflict do nothing;

-- La etiqueta cambia: ya no lleva leche, ahora lleva sésamo.
select pg_temp.comprobar(
  public.cargar_alergenos_off(
    '[{"codigo_barras":"8410179000015","alergenos":["sesamo"]}]'::jsonb) = 1,
  'una recarga rehace lo declarado');

select pg_temp.comprobar(
  not exists (
    select 1 from public.ingrediente_alergenos ia
      join public.ingredientes i on i.id = ia.ingrediente_id
      join public.alergenos a on a.id = ia.alergeno_id
     where i.codigo_barras = '8410179000015' and i.fuente = 'openfoodfacts'
       and a.codigo = 'leche'),
  'el alérgeno que ya no declara la etiqueta se va');

select pg_temp.comprobar(
  (select count(*) = 2 from public.ingrediente_alergenos ia
     join public.ingredientes i on i.id = ia.ingrediente_id
    where i.codigo_barras = '8410179000015' and i.fuente = 'openfoodfacts'
      and ia.origen in ('manual', 'derivado')),
  'y NO se lleva por delante lo manual ni lo derivado');

-- ---------------------------------------------------------------------------
-- 5 · Los grupos del catálogo salen de la base, enteros
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  (select count(*) >= 4 from public.grupos_catalogo()),
  'grupos_catalogo() devuelve los grupos que hay');

select pg_temp.comprobar(
  exists (select 1 from public.grupos_catalogo() where grupo = 'Lácteos y derivados'),
  'incluye un grupo que solo aporta el volcado');

-- ---------------------------------------------------------------------------
-- 6 · Marcar un alérgeno a un filtro entero: o todo, o nada
-- ---------------------------------------------------------------------------
select pg_temp.como('11111111-1111-1111-1111-111111111111');

select pg_temp.comprobar(
  public.asignar_alergeno_a_filtro(
    null, array['Cereales y derivados'],
    (select id from public.alergenos where codigo = 'gluten' and owner_id is null),
    false) >= 1,
  'asignar por filtro marca lo que sale del filtro');

select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select count(*) >= 2 from public.ingrediente_alergenos ia
     join public.ingredientes i on i.id = ia.ingrediente_id
     join public.alergenos a on a.id = ia.alergeno_id
    where i.grupo = 'Cereales y derivados' and a.codigo = 'gluten'),
  'y alcanza también a los del volcado, no solo a los primeros 5.000');

-- ---------------------------------------------------------------------------
-- 7 · El comparador público
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  (select count(*) >= 3 from public.v_alimentos_publicos),
  'el volcado se publica en el comparador (owner_id nulo)');

select pg_temp.comprobar(
  not exists (
    select 1 from public.v_alimentos_publicos v where v.id = 900003),
  'y el ingrediente propio de una cuenta con el interruptor apagado, no');

-- CONTROL: al encender el interruptor, sí sale. Si esto no se pusiera verde,
-- la comprobación de arriba estaría pasando porque la vista está vacía.
update public.cuentas set catalogo_publico = true
 where owner_id = '11111111-1111-1111-1111-111111111111';

select pg_temp.comprobar(
  exists (select 1 from public.v_alimentos_publicos v where v.id = 900003),
  'CONTROL: con `catalogo_publico` encendido, sí sale');

update public.cuentas set catalogo_publico = false
 where owner_id = '11111111-1111-1111-1111-111111111111';

-- La preselección: con la banda apretada, un alimento de 350 kcal no puede
-- proponer uno de 60 —harían falta 583 g— ni uno de 900.
select pg_temp.comprobar(
  not exists (
    select 1 from public.candidatos_publicos(
      null,
      '{"kcal":350,"gramos":100,"prot":12,"hc":72,"grasa":1.5,
        "grupo":"Cereales y derivados","minRelativo":0.5,"maxRelativo":2,
        "maxGramos":500,"gruposExcluidos":["Bebidas"]}'::jsonb, 750) c
     where c.kcal_100 < 175 or c.kcal_100 > 700),
  'la preselección respeta la banda de gramos');

select pg_temp.comprobar(
  not exists (
    select 1 from public.candidatos_publicos(
      null,
      '{"kcal":350,"gramos":100,"prot":12,"hc":72,"grasa":1.5,
        "grupo":"Cereales y derivados","minRelativo":0.5,"maxRelativo":2,
        "maxGramos":500,"gruposExcluidos":["Bebidas"]}'::jsonb, 750) c
     where c.grupo = 'Bebidas'),
  'y no propone bebidas al cruzar de grupo');

select pg_temp.comprobar(
  (select count(*) >= 2 from public.candidatos_publicos(null, null, 750)),
  'CONTROL: sin preselección devuelve el catálogo público, como antes de la 0018');

-- `anon` no toca nada. Las dos funciones nuevas son `security invoker` y `anon`
-- no tiene permiso sobre las tablas, así que ni con permiso de ejecución
-- podrían hacer nada; lo que sí hay que comprobar es que la tabla sigue cerrada.
select pg_temp.comprobar(
  not has_table_privilege('anon', 'public.ingredientes', 'select'),
  'anon sigue sin poder leer la tabla de ingredientes');

select pg_temp.comprobar(
  not has_table_privilege('anon', 'public.ingredientes', 'insert'),
  'ni escribir en ella');

select pg_temp.comprobar(
  has_function_privilege('anon', 'public.candidatos_publicos(text, jsonb, integer)', 'execute'),
  'CONTROL: anon sí puede llamar a candidatos_publicos, que es su única puerta');

-- ---------------------------------------------------------------------------
-- 8 · Ningún DELETE ni UPDATE sin WHERE en las funciones
--
-- Supabase carga la extensión `safeupdate`: un `delete` o un `update` sin
-- `where` se rechaza con «DELETE requires a WHERE clause». Un PostgreSQL pelado
-- —este— no la tiene, así que esta clase de fallo **pasa la batería y revienta
-- en producción**. Pasó: la primera versión de `cargar_alergenos_off` vaciaba
-- una tabla temporal con `delete from _off_alerg;` y murió en la primera carga
-- de verdad, con 500 productos ya escritos y sin alérgenos.
--
-- Esto es un lint, no una demostración: mira el texto de las funciones. Pero
-- caza exactamente eso, que es lo que aquí no se puede ejecutar.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.sin_where(p_src text)
returns integer language plpgsql as $$
declare v text; trozo text; n integer := 0;
begin
  -- Fuera los comentarios de línea: aquí se habla mucho de `delete` en prosa.
  v := regexp_replace(coalesce(p_src, ''), '--[^\n]*', '', 'g');
  for trozo in
    select m[1] from regexp_matches(v, '((?:delete\s+from|update)\s+[^;]*);', 'gi') as m
  loop
    if trozo !~* '\mwhere\M' then n := n + 1; end if;
  end loop;
  return n;
end $$;

select pg_temp.comprobar(
  (select coalesce(sum(pg_temp.sin_where(p.prosrc)), 0) = 0
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prolang = (select oid from pg_language where lanname = 'plpgsql')),
  'ninguna función de public tiene un DELETE o un UPDATE sin WHERE');

select pg_temp.comprobar(
  pg_temp.sin_where('begin delete from _tmp; end') = 1
  and pg_temp.sin_where('begin delete from _tmp where true; end') = 0,
  'CONTROL: el lint sabe distinguir uno malo de uno bueno');

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
    raise exception 'La duodécima batería tiene % comprobaciones en rojo', v_mal;
  end if;
  raise notice 'Duodécima batería: % comprobaciones, todas en verde',
    (select count(*) from _resultados);
end $$;

rollback;

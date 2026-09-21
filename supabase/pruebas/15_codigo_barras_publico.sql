-- ============================================================================
-- Decimoquinta batería · buscar por código de barras sin sesión (0021)
-- ============================================================================
-- Lo que se demuestra: que `alimento_publico_por_codigo` encuentra lo que el
-- comparador tiene que poder enseñar —el volcado y lo propio publicado—, que
-- lo encuentra en cualquiera de las formas del código, que prefiere lo que ha
-- mirado una persona al volcado cuando los dos llevan el mismo código, y que
-- sigue sin enseñar lo que no es público. Y, de control, que `anon` puede
-- llamarla y sigue sin poder leer la vista.
--
-- Del arnés, lo de siempre: `app.usuario_actual` es lo que lee la `auth.uid()`
-- de `00_stub_auth.sql`, y hay comprobaciones de control que exigen que algo SÍ
-- salga —si no, todas las de «esto no sale» pasarían con la vista vacía—.
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

-- La primera cuenta publica su catálogo; la segunda, no.
insert into public.cuentas (owner_id, catalogo_publico) values
  ('11111111-1111-1111-1111-111111111111', true),
  ('22222222-2222-2222-2222-222222222222', false)
on conflict (owner_id) do update set catalogo_publico = excluded.catalogo_publico;

-- Un genérico de BEDCA (sin código: nunca lo tendrá), un propio publicado con
-- código —el mismo que llevará una ficha del volcado, para ver quién gana—, y
-- un propio con código de una cuenta que NO publica.
insert into public.ingredientes
  (id, owner_id, codigo_bedca, fuente, codigo_barras, nombre, nombre_norm, grupo,
   estado, prot_100, hc_100, grasa_100, preferente, revisado)
overriding system value values
  (920001, null, 'T-ARROZ', 'bedca', null,
   'Arroz blanco, crudo', 'arroz blanco, crudo', 'Cereales y derivados', 'crudo',
   7.0, 78.0, 0.6, true, true),
  (920002, '11111111-1111-1111-1111-111111111111', null, 'propio', '8076809513722',
   'Yogur natural, revisado', 'yogur natural, revisado', 'Lácteos', 'listo',
   3.6, 4.9, 3.3, true, true),
  (920003, '22222222-2222-2222-2222-222222222222', null, 'propio', '5000112637922',
   'Secreto de la otra cuenta', 'secreto de la otra cuenta', 'Bebidas', 'listo',
   0.0, 10.6, 0.0, true, true);

-- Y el volcado: el yogur con el mismo código que el propio publicado, otro
-- producto normal, y un EAN-8 guardado como lo guarda Open Food Facts, es
-- decir, rellenado con ceros hasta 13.
select pg_temp.comprobar(
  public.cargar_productos_off('[
    {"codigo_barras":"8076809513722","nombre":"Yogur natural (Hacendado)",
     "nombre_norm":"yogur natural (hacendado)","grupo":"Lácteos",
     "estado":"listo","prot_100":3.5,"hc_100":4.8,"grasa_100":3.2,
     "fibra_100":0,"alcohol_100":0,"notas":"Open Food Facts (ODbL)"},
    {"codigo_barras":"8410179000015","nombre":"Alitas de pollo",
     "nombre_norm":"alitas de pollo","grupo":null,
     "estado":"listo","prot_100":18,"hc_100":0,"grasa_100":12,
     "fibra_100":0,"alcohol_100":0,"notas":"Open Food Facts (ODbL)"},
    {"codigo_barras":"0000020123451","nombre":"Galletas EAN-8",
     "nombre_norm":"galletas ean-8","grupo":"Azúcares y dulces",
     "estado":"listo","prot_100":7,"hc_100":70,"grasa_100":15,
     "fibra_100":0,"alcohol_100":0,"notas":"Open Food Facts (ODbL)"}
  ]'::jsonb) = 3,
  'CONTROL: el volcado entra');

-- ---------------------------------------------------------------------------
-- 1 · La vista lleva el código, y sigue sin exponer al dueño
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'v_alimentos_publicos'
       and column_name = 'codigo_barras'),
  'la vista pública lleva la columna codigo_barras');

select pg_temp.comprobar(
  not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'v_alimentos_publicos'
       and column_name = 'owner_id'),
  'y sigue sin exponer owner_id');

-- ---------------------------------------------------------------------------
-- 2 · Encuentra el volcado, con el código tal cual y rellenado
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  (select nombre from public.alimento_publico_por_codigo(array['8410179000015']))
    = 'Alitas de pollo',
  'un producto del volcado se encuentra por su código');

select pg_temp.comprobar(
  (select fuente from public.alimento_publico_por_codigo(array['8410179000015']))
    = 'openfoodfacts',
  'y dice que viene del volcado');

-- Lo que manda la aplicación para un EAN-8: primero tal cual, luego a 13.
select pg_temp.comprobar(
  (select nombre from public.alimento_publico_por_codigo(array['20123451', '0000020123451']))
    = 'Galletas EAN-8',
  'un EAN-8 se encuentra aunque esté guardado rellenado a 13');

select pg_temp.comprobar(
  (select codigo_barras from public.alimento_publico_por_codigo(array['20123451', '0000020123451']))
    = '0000020123451',
  'y devuelve el código en la forma en que está guardado');

-- ---------------------------------------------------------------------------
-- 3 · Con el mismo código, gana lo que ha mirado una persona
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  (select count(*) from public.alimento_publico_por_codigo(array['8076809513722'])) = 1,
  'una fila como mucho, aunque haya dos con el código');

select pg_temp.comprobar(
  (select id from public.alimento_publico_por_codigo(array['8076809513722'])) = 920002,
  'y es el propio publicado, no la ficha del volcado');

select pg_temp.comprobar(
  (select fuente from public.alimento_publico_por_codigo(array['8076809513722'])) = 'propio',
  'con fuente = propio');

-- ---------------------------------------------------------------------------
-- 4 · Lo que no es público no sale, y lo que no existe tampoco
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  not exists (select 1 from public.alimento_publico_por_codigo(array['5000112637922'])),
  'el código de una cuenta que no publica no se encuentra');

select pg_temp.comprobar(
  not exists (select 1 from public.alimento_publico_por_codigo(array['4006381333931'])),
  'un código que no está en la base no devuelve nada (la app preguntará fuera)');

select pg_temp.comprobar(
  not exists (select 1 from public.alimento_publico_por_codigo(array[]::text[])),
  'una lista vacía no devuelve nada');

select pg_temp.comprobar(
  not exists (select 1 from public.alimento_publico_por_codigo(null)),
  'y null tampoco');

select pg_temp.comprobar(
  not exists (
    select 1 from public.alimento_publico_por_codigo(
      array['1', '2', '3', '4', '5', '8410179000015'])),
  'más de cinco formas del código no se atienden');

-- ---------------------------------------------------------------------------
-- 5 · anon tiene esta puerta y ninguna más
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  has_function_privilege('anon', 'public.alimento_publico_por_codigo(text[])', 'execute'),
  'anon puede llamar a alimento_publico_por_codigo');

select pg_temp.comprobar(
  not has_table_privilege('anon', 'public.v_alimentos_publicos', 'select'),
  'y sigue sin poder leer la vista entera');

select pg_temp.comprobar(
  not has_table_privilege('anon', 'public.ingredientes', 'select'),
  'ni la tabla');

-- Con el rol puesto de verdad, no solo mirando los privilegios.
set local role anon;
select pg_temp.comprobar(
  (select nombre from public.alimento_publico_por_codigo(array['8410179000015']))
    = 'Alitas de pollo',
  'CONTROL: como anon, la función responde');
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
    raise exception 'La decimoquinta batería tiene % comprobaciones en rojo', v_mal;
  end if;
  raise notice 'Decimoquinta batería: % comprobaciones, todas en verde',
    (select count(*) from _resultados);
end $$;

rollback;

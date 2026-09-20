-- ============================================================================
-- Decimocuarta batería · los sustitutos del comparador son genéricos (0020)
-- ============================================================================
-- Lo que se demuestra es el caso que se vio en producción: una ficha del
-- volcado con cifras de relleno **exactamente proporcionales** al alimento de
-- partida da distancia cero y se colaba la primera en «¿Por qué lo puedo
-- cambiar?». Con la 0020 no sale de `candidatos_publicos`; y —control— sigue
-- saliendo en `buscar_alimentos_publico`, que es por donde se compara contra
-- un producto concreto.
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
  ('11111111-1111-1111-1111-111111111111', 'carlos@ejemplo.es')
on conflict (id) do nothing;

insert into public.cuentas (owner_id, catalogo_publico) values
  ('11111111-1111-1111-1111-111111111111', true)
on conflict (owner_id) do update set catalogo_publico = true;

-- Un genérico de BEDCA, un genérico propio (la FRUTA del caso real, publicada)
-- y otro genérico de BEDCA que es el sustituto razonable.
insert into public.ingredientes
  (id, owner_id, codigo_bedca, fuente, nombre, nombre_norm, grupo, estado,
   prot_100, hc_100, grasa_100, preferente, revisado)
overriding system value values
  (910001, null, 'T-ARROZ', 'bedca', 'Arroz blanco, crudo', 'arroz blanco, crudo',
   'Cereales y derivados', 'crudo', 7.0, 78.0, 0.6, true, true),
  (910002, '11111111-1111-1111-1111-111111111111', null, 'propio',
   'FRUTA', 'fruta', 'GENERICOS', 'listo', 1.0, 10.0, 1.0, true, true),
  (910003, null, 'T-MANZANA', 'bedca', 'Manzana', 'manzana',
   'Frutas', 'crudo', 0.3, 12.0, 0.4, true, true);

-- Y el volcado: una ficha con cifras de relleno que son EXACTAMENTE el doble de
-- la fruta —distancia cero a 50 g— y otra normal, para el control de que el
-- buscador sigue viéndolas.
select pg_temp.comprobar(
  public.cargar_productos_off('[
    {"codigo_barras":"8410179000015","nombre":"Alitas de pollo",
     "nombre_norm":"alitas de pollo","grupo":null,
     "estado":"listo","prot_100":2,"hc_100":20,"grasa_100":2,
     "fibra_100":0,"alcohol_100":0,"notas":"Open Food Facts (ODbL)"},
    {"codigo_barras":"8076809513722","nombre":"Yogur natural (Hacendado)",
     "nombre_norm":"yogur natural (hacendado)","grupo":"Lácteos y derivados",
     "estado":"listo","prot_100":3.5,"hc_100":4.8,"grasa_100":3.2,
     "fibra_100":0,"alcohol_100":0,"notas":"Open Food Facts (ODbL)"}
  ]'::jsonb) = 2,
  'CONTROL: el volcado entra');

-- ---------------------------------------------------------------------------
-- 1 · La vista dice de dónde viene cada fila, y sigue publicando el volcado
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'v_alimentos_publicos'
       and column_name = 'fuente'),
  'la vista pública lleva la columna fuente');

select pg_temp.comprobar(
  not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'v_alimentos_publicos'
       and column_name = 'owner_id'),
  'y sigue sin exponer owner_id');

select pg_temp.comprobar(
  (select count(*) = 2 from public.v_alimentos_publicos v
    where v.fuente = 'openfoodfacts'),
  'CONTROL: el volcado sigue estando en la vista (para el buscador)');

-- ---------------------------------------------------------------------------
-- 2 · Los candidatos: ni una fila del volcado, con preselección o sin ella
-- ---------------------------------------------------------------------------
-- La preselección de FRUTA a 100 g, con los números del comparador (0,5 y 2,
-- 500 g, los tres grupos). «Alitas de pollo» a 2/20/2 cabe en la banda —son
-- 50 g— y su distancia es exactamente cero: sin la 0020 sería la primera.
create temporary table _fruta as
  select * from public.candidatos_publicos(
    null,
    '{"kcal":53,"gramos":100,"prot":1,"hc":10,"grasa":1,
      "grupo":"GENERICOS","minRelativo":0.5,"maxRelativo":2,
      "maxGramos":500,
      "gruposExcluidos":["Bebidas","Salsas y condimentos","Suplementos"]}'::jsonb,
    750);

select pg_temp.comprobar(
  not exists (select 1 from _fruta where nombre = 'Alitas de pollo'),
  'la ficha del volcado con cifras de relleno NO se propone como sustituto');

select pg_temp.comprobar(
  not exists (
    select 1 from _fruta c
      join public.ingredientes i on i.id = c.id
     where i.fuente = 'openfoodfacts'),
  'ninguna fila del volcado sale de candidatos_publicos con preselección');

select pg_temp.comprobar(
  exists (select 1 from _fruta where id = 910003),
  'CONTROL: la manzana, que es genérica y cabe en la banda, sí sale');

select pg_temp.comprobar(
  not exists (
    select 1 from public.candidatos_publicos(null, null, 750) c
      join public.ingredientes i on i.id = c.id
     where i.fuente = 'openfoodfacts'),
  'ni sin preselección (el camino de antes de la 0018)');

select pg_temp.comprobar(
  (select count(*) = 3 from public.candidatos_publicos(null, null, 750)),
  'CONTROL: sin preselección salen los tres genéricos');

-- ---------------------------------------------------------------------------
-- 3 · El buscador no cambia: el volcado se sigue encontrando por nombre
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  exists (
    select 1 from public.buscar_alimentos_publico('alitas de pollo')
     where nombre = 'Alitas de pollo'),
  'CONTROL: «compáralo con uno concreto» sigue encontrando el producto del volcado');

select pg_temp.comprobar(
  exists (select 1 from public.buscar_alimentos_publico('fruta') where id = 910002),
  'y el genérico propio publicado');

-- ---------------------------------------------------------------------------
-- 4 · anon sigue con la misma puerta y nada más
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  has_function_privilege('anon', 'public.candidatos_publicos(text, jsonb, integer)', 'execute'),
  'CONTROL: anon puede llamar a candidatos_publicos');

select pg_temp.comprobar(
  not has_table_privilege('anon', 'public.v_alimentos_publicos', 'select'),
  'y sigue sin poder leer la vista entera');

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
    raise exception 'La decimocuarta batería tiene % comprobaciones en rojo', v_mal;
  end if;
  raise notice 'Decimocuarta batería: % comprobaciones, todas en verde',
    (select count(*) from _resultados);
end $$;

rollback;

-- ============================================================================
-- Decimotercera batería · el diario de las cargas (migración 0019)
-- ============================================================================
-- Lo que de verdad puede fallar aquí no es el SQL: es que el cargador y la
-- tabla dejen de hablar el mismo idioma. `scripts/cargar-off.ts` escribe una
-- fila con dieciséis campos por su nombre; si mañana se renombra un contador,
-- el `insert` falla, la pasada deja de registrarse y **nadie se entera**,
-- porque un refresco que no escribe se parece mucho a uno que no tenía nada que
-- hacer.
--
-- Así que la comprobación central es tonta y es la que importa: meter
-- exactamente la fila que mete el cargador.
--
-- La otra es la marca de agua. `--desde ultimo` la lee de aquí, así que si una
-- pasada fallida la moviera, la siguiente se saltaría todo lo de en medio sin
-- decir nada.
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off

create temporary table _resultados (n serial, ok boolean, que text);

create or replace function pg_temp.comprobar(p_ok boolean, p_que text)
returns void language plpgsql security definer as $$
begin
  insert into _resultados (ok, que) values (coalesce(p_ok, false), p_que);
end $$;

create or replace function pg_temp.revienta(p_sql text, p_como uuid default null)
returns boolean language plpgsql as $$
declare v_revento boolean;
begin
  begin
    if p_como is not null then
      perform set_config('role', 'authenticated', true);
      perform set_config('app.usuario_actual', p_como::text, true);
    end if;
    execute p_sql;
    v_revento := false;
  exception when others then
    v_revento := true;
  end;
  perform set_config('role', 'postgres', true);
  return v_revento;
end $$;

-- El arnés reconstruye lo que en Supabase hacen los «default privileges».
-- Ver la duodécima batería.
grant select, insert, update, delete on all tables in schema public to authenticated;

begin;

insert into auth.users (id, email)
values ('11111111-1111-1111-1111-111111111111', 'carlos@ejemplo.es')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1 · La fila que escribe el cargador entra tal cual
--
-- Copiada campo a campo de `scripts/cargar-off.ts`, con los números de la carga
-- real del 9 de septiembre de 2026. Si esta se pone roja, el cargador lleva sin
-- registrar nada desde el último cambio.
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  not pg_temp.revienta($sql$
    insert into public.cargas_off (
      origen, desde_t, hasta_t,
      filas, del_pais, sin_macros, alcoholicos, sin_codigo, descalificados,
      sin_nombre, sin_energia, fuera_de_rango, aceptados, escritos, alergenos,
      rechazadas, segundos)
    values (
      'csv', null, 1788934590,
      4535569, 354697, 93505, 1385, 15864, 3397,
      1323, 2807, 48, 236368, 236368, 63378,
      0, 1840)
  $sql$),
  'la fila de una carga completa entra con todos sus campos');

select pg_temp.comprobar(
  not pg_temp.revienta($sql$
    insert into public.cargas_off (origen, desde_t, hasta_t, filas, aceptados,
                                   escritos, alergenos, segundos)
    values ('csv-incremental', 1788934590, 1791526590, 4535569, 812, 812, 190, 900)
  $sql$),
  'y la de una recarga incremental, también');

select pg_temp.comprobar(
  not pg_temp.revienta($sql$
    insert into public.cargas_off (origen, error, filas, segundos)
    values ('csv', 'Open Food Facts contestó 503', 0, 12)
  $sql$),
  'y la de una pasada que se cayó');

select pg_temp.comprobar(
  pg_temp.revienta($sql$
    insert into public.cargas_off (origen) values ('parquet')
  $sql$),
  'un origen que no existe no se cuela');

-- ---------------------------------------------------------------------------
-- 2 · La marca de agua
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  (select marca = 1791526590 from public.v_refresco_off),
  'la marca de agua es el mayor hasta_t de las pasadas buenas');

-- CONTROL: una pasada fallida NO la mueve. Si la moviera, la siguiente recarga
-- se saltaría en silencio todo lo que esa pasada no llegó a cargar.
insert into public.cargas_off (origen, hasta_t, error)
values ('csv', 9999999999, 'reventó a la mitad');

select pg_temp.comprobar(
  (select marca = 1791526590 from public.v_refresco_off),
  'CONTROL: una pasada fallida no mueve la marca de agua');

select pg_temp.comprobar(
  (select ultimo_error = 'reventó a la mitad' from public.v_refresco_off),
  'y el último error se ve sin abrir la tabla');

select pg_temp.comprobar(
  (select pasadas_ok = 2 and escritos_en_total = 237180 from public.v_refresco_off),
  'el resumen cuenta las pasadas buenas y lo escrito en total');

-- ---------------------------------------------------------------------------
-- 3 · Quién puede leerlo y quién no
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  not pg_temp.revienta(
    'select count(*) from public.cargas_off',
    '11111111-1111-1111-1111-111111111111'),
  'con sesión se puede leer el diario');

select pg_temp.comprobar(
  pg_temp.revienta($sql$
    insert into public.cargas_off (origen) values ('csv')
  $sql$, '11111111-1111-1111-1111-111111111111'),
  'pero NO escribir en él: quien escribe es el cargador, con la clave de servicio');

select pg_temp.comprobar(
  not has_table_privilege('anon', 'public.cargas_off', 'select'),
  'anon no ve el diario');

-- ---------------------------------------------------------------------------
-- 4 · Y lo que la 0019 se llevó por delante
--
-- La primera versión de la migración montaba el refresco dentro de Supabase con
-- `pg_cron` y una Edge Function sobre los ficheros delta. Los delta no traen la
-- tabla nutricional —0 de 7.209 fichas con `proteins_100g`—, así que se retiró.
-- Esto fija que se retiró de verdad: un disparador huérfano que llame a una
-- función que ya no existe es un error nocturno que nadie mira.
-- ---------------------------------------------------------------------------
select pg_temp.comprobar(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'disparar_refresco_off'),
  'el disparador de la Edge Function ya no existe');

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform pg_temp.comprobar(
      not exists (select 1 from cron.job where jobname = 'refrescar-off'),
      'y no queda ningún trabajo de cron llamándolo');
  else
    perform pg_temp.comprobar(true,
      'pg_cron no está en este PostgreSQL: en Supabase se mira con select * from cron.job');
  end if;
end $$;

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
    raise exception 'La decimotercera batería tiene % comprobaciones en rojo', v_mal;
  end if;
  raise notice 'Decimotercera batería: % comprobaciones, todas en verde',
    (select count(*) from _resultados);
end $$;

rollback;

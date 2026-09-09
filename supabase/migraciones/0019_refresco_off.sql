-- ============================================================================
-- 0019 · El diario de las cargas de Open Food Facts
-- ============================================================================
--
-- ## Lo que esta migración fue a ser, y por qué no lo es
--
-- La primera versión de este fichero montaba un refresco automático **dentro de
-- Supabase**: `pg_cron` cada tres horas → `pg_net` → una Edge Function que leía
-- los ficheros **delta** que publica Open Food Facts, uno por día con lo que ha
-- cambiado. Era la única forma de que cupiera: el volcado entero no entra en una
-- Edge Function (150 s de reloj, 2 s de CPU, 256 MB) y los delta sí.
--
-- **Los delta no traen la tabla nutricional.** Medido sobre uno real, el
-- `1788847691_1788934590`: de sus 7.209 fichas, **cero** traen `proteins_100g`,
-- ni españolas ni de ningún país. Arrastran el mismo defecto que el volcado
-- JSONL, que es el que hizo que la primera carga metiera 16 productos en vez de
-- 236.000. Un refresco montado encima habría procesado un fichero cada noche,
-- descartado el 100% por «sin macros» y escrito aquí un «0 aceptados»
-- perfectamente honesto y perfectamente inútil.
--
-- Así que la carga se hace desde fuera, con el CSV —que sí los trae— y lo que
-- queda aquí es **el registro**: `pg_cron`, `pg_net`, el Vault y el disparador
-- se han ido, y la Edge Function con ellos.
--
-- ## Y por qué el registro sí se queda
--
-- Corra donde corra la carga —una acción de GitHub, el Programador de tareas de
-- Windows o tú a mano—, la pregunta «¿cuándo se refrescó esto por última vez y
-- qué entró?» solo se puede contestar si alguien la escribió. Sin esta tabla,
-- un refresco que lleva cuatro meses sin ejecutarse se parece mucho a uno que
-- funciona.
--
-- Y sirve para algo más: `hasta_t` es la marca de agua, así que
-- `npm run cargar-off -- --desde ultimo` la lee de aquí y carga solo lo que ha
-- cambiado desde la última pasada buena. Aunque se salte un mes.
--
-- Idempotente: se puede volver a aplicar.
-- ============================================================================

-- Si se llegó a aplicar la versión anterior, esto la desmonta. No falla si no
-- existía nada de eso, que es el caso normal.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('refrescar-off');
    exception when others then null;
    end;
  end if;
end $$;

drop function if exists public.disparar_refresco_off();

-- ---------------------------------------------------------------------------
-- El diario
-- ---------------------------------------------------------------------------
create table if not exists public.cargas_off (
  id             bigint generated always as identity primary key,

  -- De dónde salió: 'csv' una carga completa, 'csv-incremental' una con
  -- `--desde`. Se guarda porque no significan lo mismo: en la segunda, «del
  -- país» es lo que se miró, no lo que hay.
  origen         text not null default 'csv'
                 check (origen in ('csv', 'csv-incremental')),

  -- La ventana. `desde_t` es el `--desde` que se pidió; `hasta_t`, el mayor
  -- `last_modified_t` de lo que entró. Ese es el que hace de marca de agua.
  desde_t        bigint,
  hasta_t        bigint,

  -- Los contadores del informe del cargador, tal cual. Si algún día se añade
  -- uno allí, se añade aquí: hay una comprobación en la batería que mete la
  -- fila entera y se pone roja si dejan de encajar.
  filas          bigint,
  del_pais       integer,
  sin_macros     integer,
  alcoholicos    integer,
  sin_codigo     integer,
  descalificados integer,
  sin_nombre     integer,
  sin_energia    integer,
  fuera_de_rango integer,
  aceptados      integer,
  escritos       integer,
  alergenos      integer,
  rechazadas     integer,

  segundos       integer,
  error          text,
  creado_en      timestamptz not null default now()
);

create index if not exists cargas_off_marca
  on public.cargas_off (hasta_t desc) where error is null;

comment on table public.cargas_off is
  'Una fila por pasada de scripts/cargar-off.ts. La marca de agua para las '
  'recargas incrementales es max(hasta_t) donde error is null. Lo escribe el '
  'cargador con la clave de servicio, que se salta el RLS.';

alter table public.cargas_off enable row level security;

-- Se puede leer con sesión —algún día habrá una pantalla que diga cuándo se
-- refrescó por última vez— y no se puede escribir desde la app: quien escribe
-- es el cargador, con la clave de servicio. `anon` no lo ve.
drop policy if exists cargas_off_lectura on public.cargas_off;
create policy cargas_off_lectura on public.cargas_off
  for select to authenticated using (true);

grant select on public.cargas_off to authenticated;

-- ---------------------------------------------------------------------------
-- El resumen, para no tener que leer la tabla a mano
-- ---------------------------------------------------------------------------
create or replace view public.v_refresco_off
with (security_invoker = on) as
  select
    (select max(hasta_t) from public.cargas_off where error is null)              as marca,
    (select to_timestamp(max(hasta_t)) from public.cargas_off where error is null) as al_dia_hasta,
    (select max(creado_en) from public.cargas_off where error is null)            as ultima_pasada,
    (select count(*) from public.cargas_off where error is null)                  as pasadas_ok,
    (select coalesce(sum(escritos), 0) from public.cargas_off where error is null) as escritos_en_total,
    (select error from public.cargas_off
      where error is not null order by id desc limit 1)                           as ultimo_error,
    (select creado_en from public.cargas_off
      where error is not null order by id desc limit 1)                           as cuando_el_ultimo_error;

grant select on public.v_refresco_off to authenticated;

comment on view public.v_refresco_off is
  '¿Cuándo se refrescó el volcado por última vez y qué entró? `al_dia_hasta` es '
  'hasta cuándo llega el catálogo. Si eso lleva meses parado, el refresco no '
  'está corriendo.';

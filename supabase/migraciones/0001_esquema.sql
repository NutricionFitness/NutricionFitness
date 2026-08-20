-- ============================================================================
-- App Nutrición — esquema inicial
--
-- Principios que vienen del documento de concepto:
--   · La energía se CALCULA, nunca se almacena a mano. Aquí es una columna
--     generada, así que la base garantiza que no puede desincronizarse.
--   · Cada ajuste guardado es una dieta hija: el historial sale gratis.
--   · Nada es visible sin dueño. La app sale a internet con datos de personas
--     identificadas, así que RLS va desde el primer día, no «cuando toque».
-- ============================================================================

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------
create or replace function public.tocar_actualizado()
returns trigger language plpgsql as $$
begin
  new.actualizado_en = now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Ingredientes
--
-- owner_id NULL = catálogo compartido (los 2.258 de BEDCA). Con dueño = un
-- ingrediente que se ha creado a mano y solo ve quien lo creó.
-- ---------------------------------------------------------------------------
create table public.ingredientes (
  id                 bigint generated always as identity primary key,
  owner_id           uuid references auth.users(id) on delete cascade,
  codigo_bedca       text,
  nombre             text not null check (length(trim(nombre)) > 0),
  nombre_norm        text not null,          -- minúsculas y sin tildes, para buscar
  nombre_en          text,
  grupo              text,
  estado             text not null default 'desconocido'
                     check (estado in ('crudo','cocido','conserva','seco','listo','desconocido')),

  prot_100           numeric(8,3) not null check (prot_100  >= 0),
  hc_100             numeric(8,3) not null check (hc_100    >= 0),
  grasa_100          numeric(8,3) not null check (grasa_100 >= 0),
  fibra_100          numeric(8,3) not null default 0 check (fibra_100   >= 0),
  alcohol_100        numeric(8,3) not null default 0 check (alcohol_100 >= 0),
  ags_100            numeric(8,3) check (ags_100 >= 0),
  agua_100           numeric(8,3) check (agua_100 >= 0),
  sodio_100          numeric(10,3) check (sodio_100 >= 0),

  -- Energía declarada por la fuente. Se guarda solo como contraste: el motor
  -- calcula con Atwater. El 58% de BEDCA no la trae.
  kcal_ref           numeric(9,3) check (kcal_ref >= 0),

  -- Atwater. La fibra NO suma: contrastado contra los 866 ingredientes de BEDCA
  -- con energía declarada y fibra (error absoluto mediano 1,20% frente a 5,86%
  -- y 7,04% de las convenciones alternativas).
  kcal_100           numeric(10,3) generated always as
                     (4*prot_100 + 4*hc_100 + 9*grasa_100 + 7*alcohol_100) stored,

  porcion_comestible numeric(6,4) check (porcion_comestible > 0 and porcion_comestible <= 1),
  origen             text,
  preferente         boolean not null default false,
  completitud        numeric(4,3),
  langual            text,
  revisado           boolean not null default false,
  notas              text,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),

  -- Un mismo código de BEDCA no puede repetirse dentro del mismo ámbito.
  -- NULLS NOT DISTINCT hace que el catálogo compartido también quede protegido.
  constraint ingredientes_codigo_unico unique nulls not distinct (owner_id, codigo_bedca)
);

create index ingredientes_nombre_trgm on public.ingredientes using gin (nombre_norm gin_trgm_ops);
create index ingredientes_grupo        on public.ingredientes (grupo);
create index ingredientes_owner        on public.ingredientes (owner_id);
create index ingredientes_preferente   on public.ingredientes (preferente) where preferente;

create trigger ingredientes_tocar before update on public.ingredientes
  for each row execute function public.tocar_actualizado();

-- ---------------------------------------------------------------------------
-- Personas
-- ---------------------------------------------------------------------------
create table public.personas (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre         text not null check (length(trim(nombre)) > 0),
  notas          text,
  activa         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create index personas_owner on public.personas (owner_id);
create trigger personas_tocar before update on public.personas
  for each row execute function public.tocar_actualizado();

-- ---------------------------------------------------------------------------
-- Dietas
--
-- El versionado es la pieza que da el historial: cada ajuste que se guarda crea
-- una dieta hija, y `dieta_padre_id` encadena «la de 2.000 de marzo» con «la de
-- 1.700 de junio».
-- ---------------------------------------------------------------------------
create table public.dietas (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  persona_id        uuid references public.personas(id) on delete cascade,
  nombre            text not null check (length(trim(nombre)) > 0),
  descripcion       text,
  modelo_energia    text not null default 'atwater'
                    check (modelo_energia in ('atwater','declarada')),
  estado_cantidades text not null default 'crudo'
                    check (estado_cantidades in ('crudo','cocido','mixto')),
  kcal_objetivo     numeric(9,2) check (kcal_objetivo >= 0),
  version           integer not null default 1 check (version >= 1),
  dieta_padre_id    uuid references public.dietas(id) on delete set null,
  archivada         boolean not null default false,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint dietas_no_es_su_propia_madre check (dieta_padre_id is null or dieta_padre_id <> id)
);

create index dietas_owner   on public.dietas (owner_id);
create index dietas_persona on public.dietas (persona_id);
create index dietas_padre   on public.dietas (dieta_padre_id);
create trigger dietas_tocar before update on public.dietas
  for each row execute function public.tocar_actualizado();

-- ---------------------------------------------------------------------------
-- Comidas y componentes
-- ---------------------------------------------------------------------------
create table public.comidas (
  id       uuid primary key default gen_random_uuid(),
  dieta_id uuid not null references public.dietas(id) on delete cascade,
  nombre   text not null check (length(trim(nombre)) > 0),
  orden    integer not null default 0,
  unique (dieta_id, nombre)
);

create index comidas_dieta on public.comidas (dieta_id);

create table public.componentes (
  id             uuid primary key default gen_random_uuid(),
  comida_id      uuid   not null references public.comidas(id) on delete cascade,
  ingrediente_id bigint not null references public.ingredientes(id) on delete restrict,
  gramos         numeric(9,2) not null check (gramos >= 0),
  orden          integer not null default 0,

  -- Reglas de ajuste, exactamente los campos que consume el motor
  bloqueado      boolean not null default false,
  prioridad      numeric(6,2) not null default 1 check (prioridad >= 0),
  min_g          numeric(9,2) check (min_g >= 0),
  max_g          numeric(9,2) check (max_g >= 0),
  paso_g         numeric(7,2) not null default 5 check (paso_g > 0),

  creado_en      timestamptz not null default now(),
  constraint componentes_margen_coherente
    check (min_g is null or max_g is null or min_g <= max_g)
);

create index componentes_comida      on public.componentes (comida_id);
create index componentes_ingrediente on public.componentes (ingrediente_id);

-- ---------------------------------------------------------------------------
-- Perfiles de ajuste reutilizables
-- ---------------------------------------------------------------------------
create table public.perfiles_ajuste (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre          text not null check (length(trim(nombre)) > 0),
  modo            text not null default 'prioridades'
                  check (modo in ('proporcional','equitativo_kcal','equitativo_gramos','prioridades')),
  macros_objetivo jsonb,
  macros_fijos    text[] check (macros_fijos is null or macros_fijos <@ array['prot','hc','grasa']),
  fuerza_macros   numeric(9,2) not null default 60 check (fuerza_macros >= 0),
  holgura_rel     numeric(6,3) not null default 0.4 check (holgura_rel >= 0),
  redondear       boolean not null default true,
  tolerancia_kcal numeric(7,2) not null default 2 check (tolerancia_kcal >= 0),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  unique (owner_id, nombre)
);

create trigger perfiles_tocar before update on public.perfiles_ajuste
  for each row execute function public.tocar_actualizado();

-- ---------------------------------------------------------------------------
-- Historial de ajustes
--
-- Guarda también los infactibles: saber que se intentó bajar a 900 kcal y no se
-- pudo es información, no un error que haya que esconder.
-- ---------------------------------------------------------------------------
create table public.ajustes (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  dieta_id           uuid not null references public.dietas(id) on delete cascade,
  dieta_resultado_id uuid references public.dietas(id) on delete set null,
  kcal_origen        numeric(9,2) not null,
  kcal_objetivo      numeric(9,2) not null,
  kcal_final         numeric(9,2),
  modo               text not null,
  parametros         jsonb not null default '{}'::jsonb,
  resultado          jsonb not null default '{}'::jsonb,
  factible           boolean not null default true,
  motivo             text,
  creado_en          timestamptz not null default now()
);

create index ajustes_dieta on public.ajustes (dieta_id, creado_en desc);
create index ajustes_owner on public.ajustes (owner_id);

-- ---------------------------------------------------------------------------
-- Totales por dieta
--
-- security_invoker hace que la vista respete el RLS de quien consulta, no el de
-- quien la creó. Sin eso, una vista es un agujero por el que se escapan los
-- datos de otro usuario.
-- ---------------------------------------------------------------------------
create view public.v_dietas_totales
with (security_invoker = true) as
select
  d.id                                              as dieta_id,
  d.owner_id,
  coalesce(sum(c.gramos * i.kcal_100  / 100), 0)::numeric(12,3) as kcal,
  coalesce(sum(c.gramos * i.prot_100  / 100), 0)::numeric(12,3) as prot,
  coalesce(sum(c.gramos * i.hc_100    / 100), 0)::numeric(12,3) as hc,
  coalesce(sum(c.gramos * i.grasa_100 / 100), 0)::numeric(12,3) as grasa,
  coalesce(sum(c.gramos * i.fibra_100 / 100), 0)::numeric(12,3) as fibra,
  count(c.id)                                       as n_componentes
from public.dietas d
left join public.comidas     m on m.dieta_id  = d.id
left join public.componentes c on c.comida_id = m.id
left join public.ingredientes i on i.id       = c.ingrediente_id
group by d.id, d.owner_id;

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.ingredientes    enable row level security;
alter table public.personas        enable row level security;
alter table public.dietas          enable row level security;
alter table public.comidas         enable row level security;
alter table public.componentes     enable row level security;
alter table public.perfiles_ajuste enable row level security;
alter table public.ajustes         enable row level security;

-- Ingredientes: el catálogo compartido lo lee cualquiera autenticado; los
-- propios, solo su dueño. Escribir, solo los propios.
create policy ingredientes_leer on public.ingredientes
  for select to authenticated
  using (owner_id is null or owner_id = auth.uid());

create policy ingredientes_crear on public.ingredientes
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy ingredientes_editar on public.ingredientes
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy ingredientes_borrar on public.ingredientes
  for delete to authenticated
  using (owner_id = auth.uid());

-- Personas, dietas, perfiles y ajustes: cada uno lo suyo.
create policy personas_propias on public.personas
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy dietas_propias on public.dietas
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy perfiles_propios on public.perfiles_ajuste
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy ajustes_propios on public.ajustes
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Permisos de rol. Se dejan explícitos en vez de confiar en los que Supabase
-- concede por defecto: el día que alguien toque los privilegios por defecto del
-- proyecto, esta migración sigue diciendo la verdad. `anon` no recibe nada,
-- porque la app exige haber iniciado sesión.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Comidas y componentes no llevan dueño: cuelgan de la dieta y heredan el suyo.
create policy comidas_de_mis_dietas on public.comidas
  for all to authenticated
  using (exists (select 1 from public.dietas d
                 where d.id = comidas.dieta_id and d.owner_id = auth.uid()))
  with check (exists (select 1 from public.dietas d
                      where d.id = comidas.dieta_id and d.owner_id = auth.uid()));

create policy componentes_de_mis_dietas on public.componentes
  for all to authenticated
  using (exists (select 1 from public.comidas m join public.dietas d on d.id = m.dieta_id
                 where m.id = componentes.comida_id and d.owner_id = auth.uid()))
  with check (exists (select 1 from public.comidas m join public.dietas d on d.id = m.dieta_id
                      where m.id = componentes.comida_id and d.owner_id = auth.uid()));

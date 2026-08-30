-- ============================================================================
-- 0014 · Plantillas de opción
-- ============================================================================
--
-- Guardar la opción que estás viendo —«Desayuno con tostada»— para poder
-- meterla después en la comida de otra dieta, o en otra comida de la misma.
--
-- ## Por qué una tabla propia y no `opciones` con `comida_id` nula
--
-- Es tentador: `copiar_opciones` ya sabe copiar una opción con sus componentes,
-- y una plantilla es una opción sin comida. Pero los cuatro disparadores de la
-- 0012 dan por hecho que encima de una opción hay una comida:
--
--   · `componente_opcion_coherente` compara `componentes.comida_id` con la
--     comida de su opción;
--   · `comida_opcion_activa_coherente` exige que la activa sea de esa comida;
--   · `no_borrar_ultima_opcion` cuenta las opciones de la comida;
--   · `comida_con_su_opcion` crea la primera al insertar la comida.
--
-- Hacer `comida_id` nula convierte esas cuatro garantías en cuatro excepciones
-- «salvo si es plantilla», que es exactamente lo que esos disparadores existen
-- para evitar. Una tabla aparte no toca ninguno.
--
-- ## Lo que NO se guarda: las kilocalorías
--
-- Se calculan con `totales.ts`, el mismo motor que todo lo demás. Dos motivos:
-- los ingredientes se pueden corregir desde la fase 12, así que una cifra
-- guardada se queda vieja en silencio; y `modelo_energia` es **por dieta**, así
-- que la misma plantilla vale distinto en dos dietas y solo la de destino sabe
-- cuál. Una comida son cuatro o seis filas: calcularlas al vuelo no cuesta.
--
-- ## Lo que SÍ se guarda, y es el que muerde: `estado_cantidades`
--
-- Una plantilla guardada desde una dieta en crudo e importada en una dieta en
-- cocido son gramos que significan otra cosa: 80 g de arroz crudo son unos 200
-- cocidos. **Se avisa y no se convierte**, que es lo que eligió Carlos en la
-- fase 11 para el selector de crudo/cocinado.
--
-- ## Una sola clave ajena entre las dos tablas
--
-- Es la lección de la fase 21: con dos caminos posibles PostgREST no elige y
-- devuelve un error de ambigüedad que se lleva la consulta entera. Aquí solo
-- hay `plantilla_componentes.plantilla_id`, así que anidar funciona.
--
-- Idempotente: se puede volver a aplicar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Las plantillas
-- ---------------------------------------------------------------------------
-- Calcada de `perfiles_ajuste`, que es el análogo que ya existe: cosa del
-- usuario, con nombre, que se reutiliza entre dietas.
create table if not exists public.plantillas (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null default auth.uid()
                    references auth.users(id) on delete cascade,
  nombre            text not null check (length(trim(nombre)) > 0),

  -- Para qué comida se pensó: «Desayuno», «Cena». Es una sugerencia, no un
  -- filtro —el selector las ordena, no las esconde—, así que es texto libre y
  -- no una clave ajena a nada: las comidas son propias de cada dieta.
  comida_sugerida   text,

  -- Qué significan los gramos de dentro. Mismo `check` que `dietas`.
  estado_cantidades text not null default 'crudo'
                    check (estado_cantidades in ('crudo','cocido','mixto')),

  notas             text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  -- Como en `perfiles_ajuste`: dos plantillas mías no se pueden llamar igual.
  -- Guardar una con un nombre que ya existe **no la reemplaza en silencio**: da
  -- error 23505 y la pantalla ofrece reemplazarla a propósito.
  unique (owner_id, nombre)
);

create index if not exists plantillas_owner on public.plantillas (owner_id);

drop trigger if exists plantillas_tocar on public.plantillas;
create trigger plantillas_tocar before update on public.plantillas
  for each row execute function public.tocar_actualizado();

-- ---------------------------------------------------------------------------
-- Lo que lleva dentro
-- ---------------------------------------------------------------------------
-- Los mismos campos que `componentes` menos los que solo tienen sentido dentro
-- de una dieta (`comida_id`, `opcion_id`), y con los mismos `check`: una
-- plantilla se importa copiándola a `componentes`, así que lo que no valga allí
-- no puede valer aquí.
create table if not exists public.plantilla_componentes (
  id             uuid primary key default gen_random_uuid(),
  plantilla_id   uuid   not null references public.plantillas(id) on delete cascade,
  ingrediente_id bigint not null references public.ingredientes(id) on delete restrict,
  gramos         numeric(9,2) not null check (gramos >= 0),
  orden          integer not null default 0,

  bloqueado      boolean not null default false,
  prioridad      numeric(6,2) not null default 1 check (prioridad >= 0),
  min_g          numeric(9,2) check (min_g >= 0),
  max_g          numeric(9,2) check (max_g >= 0),
  paso_g         numeric(7,2) not null default 5 check (paso_g > 0),

  creado_en      timestamptz not null default now(),
  constraint plantilla_componentes_margen_coherente
    check (min_g is null or max_g is null or min_g <= max_g)
);

create index if not exists plantilla_componentes_plantilla
  on public.plantilla_componentes (plantilla_id);

-- `on delete restrict` en el ingrediente, igual que en `componentes`: una
-- plantilla también protege lo que usa. Si no, borrar un ingrediente propio
-- dejaría plantillas con un hueco que no se vería hasta importarlas.

-- ---------------------------------------------------------------------------
-- Acceso
-- ---------------------------------------------------------------------------
alter table public.plantillas            enable row level security;
alter table public.plantilla_componentes enable row level security;

drop policy if exists plantillas_propias on public.plantillas;
create policy plantillas_propias on public.plantillas
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Los componentes cuelgan de la plantilla, como los de una dieta cuelgan de la
-- dieta: no llevan `owner_id` propio que pudiera desincronizarse.
drop policy if exists plantilla_componentes_propios on public.plantilla_componentes;
create policy plantilla_componentes_propios on public.plantilla_componentes
  for all to authenticated
  using (exists (select 1 from public.plantillas p
                  where p.id = plantilla_componentes.plantilla_id
                    and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.plantillas p
                       where p.id = plantilla_componentes.plantilla_id
                         and p.owner_id = auth.uid()));

grant select, insert, update, delete on public.plantillas            to authenticated;
grant select, insert, update, delete on public.plantilla_componentes to authenticated;

comment on table public.plantillas is
  'Opciones guardadas para reutilizar en otras comidas. Son una FOTO, no un '
  'enlace: importar copia, y editar la plantilla después no toca las dietas '
  'que la usaron. Las kcal no se guardan: se calculan con el motor.';

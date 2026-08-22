-- ---------------------------------------------------------------------------
-- 0009 — Escanear desde otro dispositivo
--
-- El caso: estás en el ordenador montando una dieta y el producto lo tienes en
-- la mano. La cámara buena es la del móvil, pero abrir la app en el móvil,
-- iniciar sesión y navegar hasta la dieta es más trabajo que teclear los trece
-- dígitos. Así que el móvil hace **solo de cámara**: lee el código, lo manda, y
-- todo lo demás sigue pasando en el ordenador.
--
-- Eso obliga a que la página del móvil funcione **sin sesión iniciada**, y ahí
-- está todo el diseño de este fichero.
--
-- ## Por qué SECURITY DEFINER, que en este proyecto no se usa
--
-- `guardar_ajuste` y `duplicar_dieta` son `security invoker` a propósito: se
-- ejecutan con los permisos de quien llama y el RLS las vigila. Aquí no puede
-- ser, porque quien llama es un navegador sin sesión, que para PostgreSQL es el
-- rol `anon` y no tiene permiso sobre nada.
--
-- La alternativa habría sido abrir las tablas al rol `anon` con una política
-- permisiva. Sería peor: una política así deja hacer lo que sea sobre la tabla
-- entera. Estas tres funciones son la superficie completa de lo que puede hacer
-- un desconocido, y lo que pueden hacer es exactamente esto:
--
--   · decir «he abierto el enlace»,
--   · mandar un código de barras a una sesión,
--   · y pedir que el ordenador pase a escribirlo a mano.
--
-- No leen ni una fila de nada más. No dicen de quién es la sesión. No devuelven
-- ningún dato del catálogo ni de ninguna dieta. Comprueban ellas mismas todo lo
-- que el RLS comprobaría, porque son ellas las que se lo saltan.
--
-- ## Y por qué el vale del QR no es un agujero
--
-- El token son 36 caracteres hexadecimales —144 bits— que genera la aplicación
-- con el generador criptográfico del sistema, y caduca en 15 minutos. Adivinar
-- uno no es plausible. Y si alguien lo consiguiera, lo que gana es mandar un
-- número de trece dígitos a una pantalla donde una persona lo va a revisar
-- antes de guardar nada: es la capacidad más pequeña que se puede repartir.
-- ---------------------------------------------------------------------------

create table if not exists public.sesiones_escaneo (
  token        text primary key,
  owner_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  creada_en    timestamptz not null default now(),
  expira_en    timestamptz not null,
  -- Cuándo abrió el móvil el enlace. Es lo que deja decir «móvil conectado» en
  -- el ordenador en vez de un «esperando…» que no se sabe si va.
  vinculada_en timestamptz,
  -- El ordenador ha terminado. No se borra la fila: así el móvil puede decir
  -- «esto ya se ha cerrado» en vez de «este enlace no existe».
  cerrada      boolean not null default false,
  -- Lo único que el móvil puede pedir además de mandar códigos.
  peticion     text check (peticion in ('escribir_a_mano')),

  constraint sesiones_escaneo_token_forma check (token ~ '^[0-9a-f]{32,64}$')
);

create index if not exists sesiones_escaneo_owner on public.sesiones_escaneo (owner_id);
create index if not exists sesiones_escaneo_expira on public.sesiones_escaneo (expira_en);

-- La cola. Son filas y no una columna en la sesión porque el móvil puede leer
-- dos productos antes de que el ordenador mire: con una sola columna, el
-- primero se perdería sin que se enterase nadie.
create table if not exists public.escaneos (
  id        bigint generated always as identity primary key,
  token     text not null references public.sesiones_escaneo(token) on delete cascade,
  codigo    text not null check (codigo ~ '^[0-9]{8,14}$'),
  creado_en timestamptz not null default now()
);

create index if not exists escaneos_token on public.escaneos (token, id);

-- --------------------------------------------------------------------- RLS --

alter table public.sesiones_escaneo enable row level security;
alter table public.escaneos         enable row level security;

-- Las sesiones son de quien las abre, y de nadie más. El móvil no entra por
-- aquí: entra por las funciones de abajo.
create policy sesiones_escaneo_propias on public.sesiones_escaneo
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- `escaneos.token` va cualificado a propósito. Las dos tablas tienen una
-- columna que se llama igual, así que un `s.token = token` a secas se
-- resolvería contra la propia subconsulta —`s.token = s.token`, siempre
-- cierto— y la política dejaría de filtrar nada sin dar ningún error.
create policy escaneos_propios on public.escaneos
  for all to authenticated
  using (exists (
    select 1 from public.sesiones_escaneo s
    where s.token = escaneos.token and s.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.sesiones_escaneo s
    where s.token = escaneos.token and s.owner_id = auth.uid()
  ));

-- ------------------------------------------------- lo que puede el móvil ---

/**
 * Estado de una sesión. Lo llama el móvil al abrir el enlace y cada pocos
 * segundos después, para saber si sigue viva.
 *
 * Devuelve una palabra, nunca datos: 'ok', 'caducada', 'cerrada' o 'no_existe'.
 * En particular no dice de quién es la sesión ni qué se ha escaneado.
 */
create or replace function public.estado_escaneo(p_token text, p_marcar boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.sesiones_escaneo%rowtype;
begin
  select * into v from public.sesiones_escaneo where token = p_token;
  if not found then return 'no_existe'; end if;
  if v.cerrada then return 'cerrada'; end if;
  if v.expira_en < now() then return 'caducada'; end if;

  -- Solo la primera vez: es la marca de «el móvil ya ha abierto el enlace».
  if p_marcar and v.vinculada_en is null then
    update public.sesiones_escaneo set vinculada_en = now() where token = p_token;
  end if;

  return 'ok';
end $$;

/**
 * Mete un código en la cola de una sesión.
 *
 * El tope de 200 no es por el sitio que ocupa: es para que un enlace filtrado
 * no pueda llenar la tabla. Nadie escanea 200 productos en un cuarto de hora.
 */
create or replace function public.enviar_escaneo(p_token text, p_codigo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
  v_cuantos integer;
begin
  v_estado := public.estado_escaneo(p_token);
  if v_estado <> 'ok' then return v_estado; end if;

  -- La forma del código se comprueba aquí también. La app ya valida el dígito
  -- de control, pero quien llama a esto es un navegador cualquiera.
  if p_codigo !~ '^[0-9]{8,14}$' then return 'codigo_invalido'; end if;

  select count(*) into v_cuantos from public.escaneos where token = p_token;
  if v_cuantos >= 200 then return 'demasiados'; end if;

  -- Repetido seguido no se guarda: la cámara lee el mismo envase muchas veces
  -- por segundo, y aunque el móvil ya lo filtra, aquí no cuesta nada.
  if exists (
    select 1 from public.escaneos
    where token = p_token and codigo = p_codigo and creado_en > now() - interval '5 seconds'
  ) then return 'ok'; end if;

  insert into public.escaneos (token, codigo) values (p_token, p_codigo);
  return 'ok';
end $$;

/**
 * El móvil dice que ese código no hay quien lo lea y que se escriba a mano.
 *
 * No abre nada en el móvil: lo que hace es que el ordenador, en su siguiente
 * consulta, cierre el QR y abra ahí el campo para teclearlo. Escribir trece
 * dígitos en el sitio donde ya estás sentado es más fácil que en el móvil.
 */
create or replace function public.pedir_escribir_a_mano(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_estado text;
begin
  v_estado := public.estado_escaneo(p_token);
  if v_estado <> 'ok' then return v_estado; end if;

  update public.sesiones_escaneo
  set peticion = 'escribir_a_mano', cerrada = true
  where token = p_token;

  return 'ok';
end $$;

-- Las tres son para cualquiera que tenga el enlace, con sesión o sin ella. El
-- `revoke` primero porque PostgreSQL da permiso de ejecución a todo el mundo
-- por defecto, y aquí conviene que esté escrito a quién se le da.
revoke all on function public.estado_escaneo(text, boolean)   from public;
revoke all on function public.enviar_escaneo(text, text)      from public;
revoke all on function public.pedir_escribir_a_mano(text)     from public;

grant execute on function public.estado_escaneo(text, boolean)  to anon, authenticated;
grant execute on function public.enviar_escaneo(text, text)     to anon, authenticated;
grant execute on function public.pedir_escribir_a_mano(text)    to anon, authenticated;

-- Los permisos de tabla. La 0001 los dio con `on all tables in schema public`,
-- y eso solo alcanza a las tablas que existían entonces: una tabla nueva no
-- hereda nada de aquello y se quedaría sin permisos para la propia app.
grant select, insert, update, delete on public.sesiones_escaneo to authenticated;
grant select, insert, update, delete on public.escaneos         to authenticated;

comment on table public.sesiones_escaneo is
  'Vínculo temporal entre el ordenador y la cámara de otro dispositivo. El '
  'token es lo que lleva el QR: 144 bits y quince minutos.';
comment on table public.escaneos is
  'Cola de códigos que ha mandado el móvil y que el ordenador aún no ha '
  'recogido. Se borra sola al borrarse la sesión.';

-- ==========================================================================
-- 0022 · Escanear con otro dispositivo también sin sesión (el comparador)
-- ==========================================================================
--
-- ## Lo que se quiere
--
-- En el comparador público, al pulsar «escanear», la misma pregunta que dentro
-- de la app: «¿con la cámara de aquí o con la de otro dispositivo?». Y si es
-- con otro, el mismo QR: el móvil lo abre, lee el envase y el producto aparece
-- en el ordenador.
--
-- ## Lo que faltaba
--
-- La 0009 lo dejó todo listo **para el móvil**: `/escanear/[token]` es pública
-- y sus tres funciones (`estado_escaneo`, `enviar_escaneo`,
-- `pedir_escribir_a_mano`) no miran de quién es la sesión. Lo que exige haber
-- entrado es el **otro lado**, el del ordenador: abrir el vínculo es un
-- `insert` en `sesiones_escaneo` con `owner_id = auth.uid()`, recoger lo que
-- manda el móvil es un `select` sobre `escaneos`, y las dos tablas están bajo
-- RLS para `authenticated`. Sin sesión, `anon` no puede ni lo uno ni lo otro.
--
-- ## Lo que se hace
--
-- Sesiones **sin dueño**: `owner_id` pasa a admitir nulo, y el ordenador sin
-- sesión entra por tres funciones `security definer` que son el espejo de las
-- tres del móvil, con el mismo criterio que la 0009 y la 0011: cada una hace
-- una cosa, devuelve lo justo y comprueba ella misma lo que el RLS no puede.
--
--   · `abrir_escaneo_anonimo`     abre un vínculo sin dueño.
--   · `novedades_escaneo_anonimo` qué ha mandado el móvil, de uno en uno.
--   · `cerrar_escaneo_anonimo`    lo termina y borra su cola.
--
-- Las tres exigen `owner_id is null`: una sesión con dueño sigue siendo solo
-- de su dueño y estas funciones no la ven. Y las políticas de la 0009 no
-- cambian: `owner_id = auth.uid()` es falso para un nulo, así que ninguna
-- cuenta ve las sesiones sin dueño a través de las tablas.
--
-- ## Por qué el token basta como llave
--
-- Es el mismo razonamiento de la 0009, ahora en los dos sentidos. El token son
-- 144 bits que genera la aplicación y caduca en quince minutos. Quien lo tenga
-- puede mandar un código de barras a esa pantalla, o leer los que haya mandado
-- el móvil: un número de trece dígitos de un producto del súper, en una página
-- que además es pública. No hay ninguna otra cosa detrás.
--
-- Lo único nuevo que un desconocido puede hacer es **abrir** sesiones, y eso
-- se acota: se limpian las caducadas al abrir una, y no se abren más de 500
-- vivas a la vez. Nadie necesita 500 y una tabla no se llena sola.
--
-- Idempotente: se puede volver a aplicar.
-- ==========================================================================

alter table public.sesiones_escaneo
  alter column owner_id drop not null;

comment on column public.sesiones_escaneo.owner_id is
  'Quien abrió el vínculo. Nulo si se abrió sin sesión, desde el comparador '
  'público: esa sesión no es de nadie y solo se llega a ella con el token.';

-- ---------------------------------------------------------------------------
-- Abrir un vínculo sin dueño
--
-- El token lo genera la aplicación, como en la 0009, y por el mismo motivo: no
-- depender de `pgcrypto`. La forma se comprueba aquí y no solo por la
-- restricción de la tabla, para dar un error con nombre y no uno de
-- «violates check constraint» que la pantalla no sabría leer.
-- ---------------------------------------------------------------------------
create or replace function public.abrir_escaneo_anonimo(p_token text)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expira timestamptz := now() + interval '15 minutes';
  v_vivas  integer;
begin
  if p_token !~ '^[0-9a-f]{32,64}$' then
    raise exception 'token_invalido';
  end if;

  -- La limpieza de las sesiones sin dueño va aquí porque no hay nadie más que
  -- la haga: las que tienen dueño las limpia `abrirSesionEscaneo` al abrir la
  -- siguiente, y estas no tienen «siguiente» de nadie.
  delete from public.sesiones_escaneo
   where owner_id is null and expira_en < now();

  select count(*) into v_vivas
    from public.sesiones_escaneo where owner_id is null;
  if v_vivas >= 500 then
    raise exception 'demasiadas_sesiones';
  end if;

  insert into public.sesiones_escaneo (token, owner_id, expira_en)
  values (p_token, null, v_expira);

  return v_expira;
end $$;

-- ---------------------------------------------------------------------------
-- Qué hay de nuevo
--
-- Lo mismo que `novedadesEscaneo` en `app/escanear/acciones.ts`, en una sola
-- llamada y para sesiones sin dueño. De uno en uno a propósito, igual que
-- allí: `p_desde` avanza en cuanto se recoge un código, y recoger cincuenta de
-- golpe con un panel que se puede desmontar a mitad los daría por consumidos.
--
-- Devuelve un `jsonb` y no una tabla porque son cinco valores de una fila y
-- un sexto que puede no estar; con `returns table` habría que inventarse una
-- fila vacía para decir «no existe».
-- ---------------------------------------------------------------------------
create or replace function public.novedades_escaneo_anonimo(
  p_token text,
  p_desde bigint default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.sesiones_escaneo%rowtype;
  e public.escaneos%rowtype;
  v_hay boolean;
begin
  select * into v from public.sesiones_escaneo
   where token = p_token and owner_id is null;
  if not found then
    return jsonb_build_object('existe', false);
  end if;

  select * into e from public.escaneos
   where token = p_token and id > coalesce(p_desde, 0)
   order by id
   limit 1;
  v_hay := found;

  return jsonb_build_object(
    'existe',          true,
    'vinculada',       v.vinculada_en is not null,
    'escribir_a_mano', coalesce(v.peticion = 'escribir_a_mano', false),
    'terminada',       v.cerrada or v.expira_en < now(),
    'codigo',          case when v_hay
                         then jsonb_build_object('id', e.id, 'codigo', e.codigo)
                       end
  );
end $$;

-- ---------------------------------------------------------------------------
-- Terminar
--
-- Borra la sesión y, en cascada, su cola. Solo las sin dueño: con el token de
-- una sesión con dueño esto no hace nada, que es lo que hacía antes.
-- ---------------------------------------------------------------------------
create or replace function public.cerrar_escaneo_anonimo(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.sesiones_escaneo
   where token = p_token and owner_id is null;
$$;

comment on function public.abrir_escaneo_anonimo(text) is
  'Abre un vinculo de escaneo sin dueno, para el comparador publico. Devuelve '
  'cuando caduca. Limpia las caducadas y no deja mas de 500 vivas.';
comment on function public.novedades_escaneo_anonimo(text, bigint) is
  'Lo que ha mandado el movil a una sesion sin dueno, de uno en uno. El espejo '
  'de novedadesEscaneo para quien no tiene sesion.';
comment on function public.cerrar_escaneo_anonimo(text) is
  'Termina una sesion sin dueno y borra su cola.';

-- ---------------------------------------------------------------------------
-- Permisos. `revoke` primero, como siempre: PostgreSQL da `execute` a
-- `public` en cuanto se crea una función.
-- ---------------------------------------------------------------------------
revoke all on function public.abrir_escaneo_anonimo(text)             from public;
revoke all on function public.novedades_escaneo_anonimo(text, bigint) from public;
revoke all on function public.cerrar_escaneo_anonimo(text)            from public;

grant execute on function public.abrir_escaneo_anonimo(text)             to anon, authenticated;
grant execute on function public.novedades_escaneo_anonimo(text, bigint) to anon, authenticated;
grant execute on function public.cerrar_escaneo_anonimo(text)            to anon, authenticated;

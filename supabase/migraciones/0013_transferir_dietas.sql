-- ============================================================================
-- 0013 · Transferir dietas de una persona a otra
-- ============================================================================
--
-- Tres cosas, y la primera es un arreglo, no una función nueva:
--
--   1. `dieta_persona_coherente` — hoy la dieta de una cuenta puede colgar de
--      la persona de OTRA cuenta. La política `dietas_propias` comprueba
--      `owner_id = auth.uid()` en su `with check`, y `owner_id` no cambia; la
--      clave ajena solo exige que la persona exista. Comprobado contra un
--      PostgreSQL de verdad con las migraciones 0001–0012 de este repo
--      aplicadas: pasa por `update` directo, al crear la dieta, y también por
--      `duplicar_dieta`, que ya acepta `p_persona_id` y no lo mira.
--
--      Los tres caminos existen en la app: `actualizarDieta` acepta
--      `persona_id` entre sus cambios, `crearDieta` inserta con el
--      `persona_id` que venga del formulario, y `duplicarDieta` llama al RPC.
--
--      Va como disparador y no como `with check` de la política a propósito:
--      el disparador cubre además el camino de la clave de servicio, que se
--      salta el RLS. Es el mismo patrón que `componente_opcion_coherente`.
--
--   2. `transferir_dieta` — mueve una dieta a otra persona, con dos alcances:
--      el historial entero o solo esa versión, desgajándola del árbol.
--
--   3. `duplicar_dieta` — el cuerpo de la 0012 palabra por palabra, más una
--      comprobación explícita de `p_persona_id` para que el error sea el de
--      siempre y no el del disparador. Así «copiar a otra persona» no necesita
--      función nueva.
--
-- Idempotente: se puede volver a aplicar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Una dieta no puede colgar de la persona de otra cuenta
-- ---------------------------------------------------------------------------

create or replace function public.dieta_persona_coherente()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare v_de_quien uuid;
begin
  if new.persona_id is null then return new; end if;

  -- Sin `security definer`: bajo RLS solo se ven las personas propias, así que
  -- una de otra cuenta no aparece y el mensaje es el mismo que si no existiera.
  -- Es lo correcto: la existencia de la persona de otro no es asunto nuestro.
  select p.owner_id into v_de_quien
    from public.personas p where p.id = new.persona_id;

  if v_de_quien is null then
    raise exception 'La persona % no existe o no es tuya', new.persona_id
      using errcode = 'insufficient_privilege';
  end if;

  if v_de_quien <> new.owner_id then
    raise exception 'La persona % es de otra cuenta', new.persona_id
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end $$;

drop trigger if exists dietas_persona_coherente on public.dietas;
create trigger dietas_persona_coherente
  before insert or update of persona_id, owner_id on public.dietas
  for each row execute function public.dieta_persona_coherente();

-- ---------------------------------------------------------------------------
-- 2. Transferir
-- ---------------------------------------------------------------------------
--
-- `p_alcance`:
--
--   'linaje' — se lleva TODO el árbol de versiones, desde la raíz y hacia
--       abajo, esté donde esté la dieta que se ha pulsado. Es lo que se quiere
--       casi siempre: una versión suelta en manos de otra persona parte el
--       historial en dos y `linaje_dieta()` acabaría paseándose por dietas que
--       ya no son de quien las mira.
--
--   'sola' — se lleva solo esa, desgajándola: `dieta_padre_id` a nulo y
--       `version` a 1, como una dieta independiente (la semántica de
--       `duplicar_dieta` desde la fase 8). Y —esto es lo que no es obvio— sus
--       HIJAS se recuelgan de su abuela. Sin eso seguirían apuntando a una
--       fila que existe pero ya es de otra persona, y el historial de origen
--       se metería en ella. Si no había abuela, quedan como raíces.
--
--       Deja un hueco en la numeración de origen (v1 y v3 sin v2). No se
--       renumera: cambiar el número de una versión que ya se ha visto impresa
--       es peor que el hueco.
--
-- Las filas de `ajustes` no se tocan. Tras un desgaje, una de ellas puede unir
-- una dieta de Ana con una de Marta; es historial de lo que pasó y era verdad.
-- El historial de la pantalla se dibuja con `linaje_dieta()`, no con `ajustes`.
--
-- `security invoker`: el RLS vigila todo lo que se lee y se escribe, igual que
-- `guardar_ajuste` y `duplicar_dieta`.

create or replace function public.transferir_dieta(
  p_dieta_id           uuid,
  p_persona_destino_id uuid,
  p_alcance            text default 'linaje')
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_dieta          public.dietas%rowtype;
  v_persona_owner  uuid;
  v_padre_original uuid;
  v_movidas        integer;
begin
  if p_alcance not in ('linaje', 'sola') then
    raise exception 'El alcance debe ser «linaje» o «sola», no «%»', p_alcance;
  end if;

  select * into v_dieta from public.dietas where id = p_dieta_id;
  if not found then
    raise exception 'La dieta % no existe o no es tuya', p_dieta_id
      using errcode = 'insufficient_privilege';
  end if;

  select p.owner_id into v_persona_owner
    from public.personas p where p.id = p_persona_destino_id;
  if v_persona_owner is null then
    raise exception 'La persona % no existe o no es tuya', p_persona_destino_id
      using errcode = 'insufficient_privilege';
  end if;
  if v_persona_owner <> v_dieta.owner_id then
    raise exception 'La persona % es de otra cuenta', p_persona_destino_id
      using errcode = 'insufficient_privilege';
  end if;

  if v_dieta.persona_id is not distinct from p_persona_destino_id then
    raise exception 'La dieta ya es de esa persona';
  end if;

  if p_alcance = 'linaje' then
    -- `linaje_dieta` sube a la raíz y baja recogiendo la descendencia. Es
    -- `stable`, así que el subselect ve la foto de antes del update.
    update public.dietas
       set persona_id = p_persona_destino_id
     where id in (select l.id from public.linaje_dieta(p_dieta_id) l);
    get diagnostics v_movidas = row_count;

  else
    v_padre_original := v_dieta.dieta_padre_id;

    -- Primero las hijas, que es lo que se olvida.
    update public.dietas
       set dieta_padre_id = v_padre_original
     where dieta_padre_id = p_dieta_id;

    update public.dietas
       set persona_id     = p_persona_destino_id,
           dieta_padre_id = null,
           version        = 1
     where id = p_dieta_id;
    get diagnostics v_movidas = row_count;
  end if;

  return v_movidas;
end $$;

-- ---------------------------------------------------------------------------
-- 3. duplicar_dieta: la comprobación que le faltaba
-- ---------------------------------------------------------------------------
-- El cuerpo es el de la 0012, palabra por palabra —comprobado con un `diff`
-- del `prosrc` de las dos—, más las siete líneas de la comprobación.
-- `p_persona_id` ya existía y ya servía para copiar a otra persona; lo que no
-- hacía era mirar de quién era esa persona.

create or replace function public.duplicar_dieta(
  p_dieta_id uuid, p_nombre text default null, p_persona_id uuid default null)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_origen  public.dietas%rowtype;
  v_nueva   uuid;
  v_comida  record;
  v_nueva_comida uuid;
  v_persona_owner uuid;
begin
  select * into v_origen from public.dietas where id = p_dieta_id;
  if not found then
    raise exception 'La dieta % no existe o no es tuya', p_dieta_id
      using errcode = 'insufficient_privilege';
  end if;

  if p_persona_id is not null then
    select p.owner_id into v_persona_owner
      from public.personas p where p.id = p_persona_id;
    if v_persona_owner is null or v_persona_owner <> v_origen.owner_id then
      raise exception 'La persona % no existe o no es tuya', p_persona_id
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  insert into public.dietas (
    owner_id, persona_id, nombre, descripcion, modelo_energia,
    estado_cantidades, kcal_objetivo, version, dieta_padre_id)
  values (
    v_origen.owner_id,
    coalesce(p_persona_id, v_origen.persona_id),
    coalesce(nullif(trim(p_nombre), ''), v_origen.nombre || ' (copia)'),
    v_origen.descripcion, v_origen.modelo_energia, v_origen.estado_cantidades,
    v_origen.kcal_objetivo,
    1, null)
  returning id into v_nueva;

  for v_comida in
    select * from public.comidas where dieta_id = p_dieta_id order by orden, nombre
  loop
    insert into public.comidas (dieta_id, nombre, orden)
    values (v_nueva, v_comida.nombre, v_comida.orden)
    returning id into v_nueva_comida;

    perform public.copiar_opciones(v_comida.id, v_nueva_comida, null);
  end loop;

  return v_nueva;
end $$;

-- ---------------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------------
-- Solo `grant`, como `guardar_ajuste`, `duplicar_dieta` y `copiar_opciones`, y
-- ningún `revoke`.
--
-- Un `revoke ... from anon` aquí no serviría de nada y además engañaría:
-- PostgreSQL da `execute` a `public` al crear una función y `anon` lo hereda de
-- ahí, así que quitárselo a `anon` por su nombre no le quita nada. Medido:
-- después de ese `revoke`, `has_function_privilege('anon', ...)` seguía dando
-- `true`.
--
-- Lo que de verdad para a `anon` es que no tiene permiso sobre las tablas: la
-- función es `security invoker` y muere en el primer `select` con «permission
-- denied for table dietas». Hay una comprobación de la novena batería que lo
-- fija, para que no dependa de que a nadie se le ocurra darle `grant` a `anon`.
--
-- El `revoke all ... from public` de las fases 15 y 19 es otra cosa: aquellas
-- funciones son `security definer` y se saltan el RLS, así que allí el permiso
-- es la única defensa. Aquí no.
grant execute on function public.transferir_dieta(uuid, uuid, text) to authenticated;
grant execute on function public.duplicar_dieta(uuid, text, uuid)   to authenticated;

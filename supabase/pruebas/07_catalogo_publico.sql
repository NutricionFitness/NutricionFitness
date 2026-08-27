-- ============================================================================
-- Pruebas del comparador público (migración 0011).
--
--   psql -d appnut -f supabase/pruebas/00_stub_auth.sql
--   psql -d appnut -f supabase/migraciones/0001_esquema.sql
--   psql -d appnut -f supabase/migraciones/0006_editar_catalogo.sql
--   psql -d appnut -f supabase/migraciones/0011_catalogo_publico.sql
--   psql -d appnut -f supabase/pruebas/07_catalogo_publico.sql
--
-- Lo que hay que demostrar: que `anon` —cualquiera en internet— ve el catálogo
-- de BEDCA y los ingredientes de quien haya dicho que sí, y **nada más**. Ni
-- los de quien no ha dicho que sí, ni de quién es cada uno, ni la tabla.
--
-- Los `set role` van a nivel de sentencia y no dentro de un bloque: con el rol
-- de superusuario el RLS no se aplica y la prueba pasaría siempre.
-- ============================================================================

\set ON_ERROR_STOP on
\timing off

set client_min_messages = warning;

-- --- montaje ---------------------------------------------------------------
-- Ana publica su catálogo. Luis no. Y hay un alimento de BEDCA, sin dueño.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ana@ejemplo.es'),
  ('22222222-2222-2222-2222-222222222222', 'luis@ejemplo.es')
on conflict do nothing;

insert into public.cuentas (owner_id, catalogo_publico) values
  ('11111111-1111-1111-1111-111111111111', true),
  ('22222222-2222-2222-2222-222222222222', false)
on conflict (owner_id) do update set catalogo_publico = excluded.catalogo_publico;

-- `codigo_bedca` distinto en cada uno: hay un único (owner_id, codigo_bedca)
-- con NULLS NOT DISTINCT, así que dos filas sin dueño y sin código chocan.
insert into public.ingredientes
  (owner_id, codigo_bedca, nombre, nombre_norm, grupo, estado, prot_100, hc_100,
   grasa_100, fibra_100, alcohol_100, preferente)
values
  (null, 'T001', 'Arroz de BEDCA', 'arroz de bedca', 'Cereales y derivados', 'crudo',
   7, 78, 0.6, 1.3, 0, true),
  ('11111111-1111-1111-1111-111111111111', null, 'Barrita de Ana', 'barrita de ana',
   'Otros', 'desconocido', 20, 40, 10, 3, 0, true),
  ('22222222-2222-2222-2222-222222222222', null, 'Batido de Luis', 'batido de luis',
   'Otros', 'desconocido', 25, 30, 5, 0, 0, true),
  -- Uno no preferente y otro sin energía: no salen en ningún caso, porque el
  -- comparador no puede igualar kilocalorías con algo que no tiene.
  (null, 'T002', 'Arroz duplicado de BEDCA', 'arroz duplicado de bedca',
   'Cereales y derivados', 'crudo', 7, 78, 0.6, 1.3, 0, false),
  (null, 'T003', 'Agua', 'agua', 'Bebidas', 'crudo', 0, 0, 0, 0, 0, true);

-- ===========================================================================
-- 1. Lo que SÍ ve un desconocido
-- ===========================================================================
set role anon;

do $$
declare n integer;
begin
  select count(*) into n from public.buscar_alimentos_publico('arroz');
  assert n = 1, format('FALLO: «arroz» debería dar 1 (solo el preferente), da %s', n);

  select count(*) into n from public.buscar_alimentos_publico('barrita');
  assert n = 1, 'FALLO: anon no ve el ingrediente de una cuenta que publica';

  select count(*) into n from public.candidatos_publicos();
  assert n = 2, format('FALLO: los candidatos deberían ser 2 (arroz y barrita), son %s', n);
end $$;

-- ===========================================================================
-- 2. Lo que NO ve
-- ===========================================================================
do $$
declare n integer;
begin
  select count(*) into n from public.buscar_alimentos_publico('batido');
  assert n = 0, 'FALLO GRAVE: anon ve el ingrediente de una cuenta que NO publica';

  select count(*) into n from public.candidatos_publicos()
   where nombre = 'Batido de Luis';
  assert n = 0, 'FALLO GRAVE: el de Luis se cuela entre los candidatos';

  -- Sin energía no se puede igualar: el agua no es un sustituto de nada.
  select count(*) into n from public.buscar_alimentos_publico('agua');
  assert n = 0, 'FALLO: un alimento sin kcal no debería salir en el comparador';

  -- Los no preferentes son fichas duplicadas de BEDCA; solo una es la buena.
  select count(*) into n from public.buscar_alimentos_publico('duplicado');
  assert n = 0, 'FALLO: sale un ingrediente no preferente';
end $$;

-- ===========================================================================
-- 3. La tabla sigue cerrada
--
-- Esto es lo que separa «una página pública» de «una base de datos pública».
-- ===========================================================================
do $$
declare n integer;
begin
  begin
    select count(*) into n from public.ingredientes;
    raise exception 'FALLO GRAVE: anon puede leer la tabla ingredientes (% filas)', n;
  exception
    when insufficient_privilege then null;   -- lo correcto
    when others then
      -- Con RLS y sin política, PostgreSQL no da error: filtra y devuelve cero.
      -- Las dos salidas valen; lo que no vale es que devuelva filas.
      if n is not null and n > 0 then
        raise exception 'FALLO GRAVE: anon lee % filas de ingredientes', n;
      end if;
  end;
end $$;

do $$
declare n integer;
begin
  begin
    select count(*) into n from public.v_alimentos_publicos;
    raise exception 'FALLO GRAVE: anon puede leer la vista entera (% filas)', n;
  exception
    when insufficient_privilege then null;
  end;
end $$;

do $$
declare n integer;
begin
  begin
    select count(*) into n from public.cuentas;
    raise exception 'FALLO GRAVE: anon puede leer la tabla cuentas';
  exception
    when insufficient_privilege then null;
    when others then
      if n is not null and n > 0 then
        raise exception 'FALLO GRAVE: anon lee % filas de cuentas', n;
      end if;
  end;
end $$;

-- Escribir, ni de lejos.
do $$
begin
  begin
    insert into public.ingredientes (nombre, nombre_norm, estado, prot_100, hc_100,
                                     grasa_100, fibra_100, alcohol_100)
    values ('Colado', 'colado', 'crudo', 1, 1, 1, 0, 0);
    raise exception 'FALLO GRAVE: anon puede insertar en ingredientes';
  exception
    when insufficient_privilege then null;
    when check_violation then null;
  end;
end $$;

-- ===========================================================================
-- 4. La función no se puede usar para vaciar el catálogo
-- ===========================================================================
do $$
declare n integer;
begin
  -- Un límite absurdo se acota dentro, no se obedece.
  select count(*) into n from public.buscar_alimentos_publico('a', 100000);
  assert n <= 40, format('FALLO: el límite no está acotado (devuelve %s)', n);

  -- Y una búsqueda demasiado corta no devuelve nada: sin esto, una letra
  -- sacaría media base de datos de un tirón.
  select count(*) into n from public.buscar_alimentos_publico('a');
  assert n = 0, 'FALLO: con una sola letra ya devuelve resultados';
  select count(*) into n from public.buscar_alimentos_publico('');
  assert n = 0, 'FALLO: la búsqueda vacía devuelve resultados';
end $$;

-- ===========================================================================
-- 5. Lo que se devuelve no dice de quién es
-- ===========================================================================
do $$
declare n integer;
begin
  select count(*) into n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'v_alimentos_publicos'
     and column_name = 'owner_id';
  assert n = 0, 'FALLO: la vista pública expone owner_id';
end $$;

reset role;

-- ===========================================================================
-- 6. El interruptor manda: si Ana lo apaga, su barrita desaparece
-- ===========================================================================
update public.cuentas set catalogo_publico = false
 where owner_id = '11111111-1111-1111-1111-111111111111';

set role anon;
do $$
declare n integer;
begin
  select count(*) into n from public.buscar_alimentos_publico('barrita');
  assert n = 0, 'FALLO: apagar el interruptor no quita el ingrediente del público';
  select count(*) into n from public.buscar_alimentos_publico('arroz');
  assert n = 1, 'FALLO: apagar el interruptor de una cuenta se lleva por delante BEDCA';
end $$;
reset role;

-- ===========================================================================
-- 7. Una cuenta sin fila en `cuentas` NO publica
--
-- Es lo que separa «publico lo mío» de «se publica todo lo que entre». Y es
-- justo lo que cazó esta batería: la primera versión de la migración hacía
-- `insert ... select id, true from auth.users`, así que cualquier cuenta que
-- existiera al aplicarla —incluida una de prueba olvidada— quedaba publicando
-- sin que nadie lo hubiera dicho.
-- ===========================================================================
insert into auth.users (id, email)
values ('33333333-3333-3333-3333-333333333333', 'nueva@ejemplo.es')
on conflict do nothing;

insert into public.ingredientes
  (owner_id, codigo_bedca, nombre, nombre_norm, grupo, estado, prot_100, hc_100,
   grasa_100, fibra_100, alcohol_100, preferente)
values ('33333333-3333-3333-3333-333333333333', null, 'Secreto de la nueva',
        'secreto de la nueva', 'Otros', 'desconocido', 10, 10, 10, 0, 0, true);

set role anon;
do $$
declare n integer;
begin
  select count(*) into n from public.buscar_alimentos_publico('secreto');
  assert n = 0, 'FALLO GRAVE: una cuenta sin fila en `cuentas` publica por defecto';
end $$;
reset role;

-- ===========================================================================
-- 8. Un usuario autenticado sigue viendo lo suyo y no lo del otro
--
-- La 0011 no puede haber aflojado la política de la 0001.
-- ===========================================================================
set role authenticated;
set app.usuario_actual = '22222222-2222-2222-2222-222222222222';

do $$
declare n integer;
begin
  select count(*) into n from public.ingredientes where nombre = 'Batido de Luis';
  assert n = 1, 'FALLO: Luis no ve su propio ingrediente';
  select count(*) into n from public.ingredientes where nombre = 'Barrita de Ana';
  assert n = 0, 'FALLO GRAVE: Luis ve el ingrediente de Ana en la tabla';
  select count(*) into n from public.ingredientes where nombre = 'Arroz de BEDCA';
  assert n = 1, 'FALLO: Luis no ve el catálogo compartido';
end $$;

reset role;
reset app.usuario_actual;

select '07_catalogo_publico: TODO CORRECTO' as resultado;

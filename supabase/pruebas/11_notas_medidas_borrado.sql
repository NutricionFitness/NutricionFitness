-- ============================================================================
-- Undécima batería · la nota en la hoja, las medidas propias y los borrados
-- ============================================================================
-- La migración 0015 es de una línea. La mitad de esta batería no prueba código
-- nuevo: prueba lo que el RLS **ya** garantizaba y que hasta ahora no tenía
-- pantalla. Es lo que hay que hacer antes de enseñar un botón nuevo —el botón
-- solo es seguro si la base dice que no, y eso se demuestra ejecutándolo—.
--
-- Del arnés, lo de siempre: `app.usuario_actual` es lo que lee la `auth.uid()`
-- de `00_stub_auth.sql`; los `set role` van a nivel de sentencia; y hay
-- comprobaciones de control que exigen que algo SÍ funcione, porque si no todas
-- las de «esto no se puede» pasarían solas.
--
-- Y una que aquí importa más que en ninguna: **el RLS no da error cuando no te
-- deja, filtra**. Un borrado prohibido no revienta: se lleva cero filas. Así
-- que lo que se comprueba no es que falle, es que **no cambió nada**.
-- ============================================================================

\set ON_ERROR_STOP on
\pset pager off

create temporary table _resultados (n serial, ok boolean, que text);

create or replace function pg_temp.comprobar(p_ok boolean, p_que text)
returns void language plpgsql security definer as $$
begin
  insert into _resultados (ok, que) values (coalesce(p_ok, false), p_que);
end $$;

create or replace function pg_temp.revienta(p_sql text, p_como uuid)
returns boolean language plpgsql as $$
declare v_revento boolean;
begin
  begin
    perform set_config('role', 'authenticated', true);
    perform set_config('app.usuario_actual', p_como::text, true);
    execute p_sql;
    v_revento := false;
  exception when others then
    v_revento := true;
  end;
  perform set_config('role', 'postgres', true);
  return v_revento;
end $$;

create or replace function pg_temp.como(p_quien uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('app.usuario_actual', p_quien::text, true);
end $$;

create or replace function pg_temp.otra_vez_root() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
end $$;

begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'ana@x'),
  ('22222222-2222-2222-2222-222222222222', 'luis@x');

-- Uno compartido (BEDCA) y uno de Ana.
insert into public.ingredientes
  (id, owner_id, codigo_bedca, nombre, nombre_norm, grupo, estado,
   prot_100, hc_100, grasa_100, fibra_100, alcohol_100, preferente)
overriding system value
values
  (920001, null, 'N001', 'Arroz compartido', 'arroz compartido', 'Cereales y derivados', 'crudo', 7, 78, 0.6, 1.3, 0, true),
  (920002, '11111111-1111-1111-1111-111111111111', null, 'Receta de Ana', 'receta de ana', null, 'crudo', 10, 10, 10, 0, 0, true),
  (920003, '11111111-1111-1111-1111-111111111111', null, 'Otra de Ana',   'otra de ana',   null, 'crudo', 5, 5, 5, 0, 0, true),
  (920004, '11111111-1111-1111-1111-111111111111', null, 'Suelta de Ana', 'suelta de ana', null, 'crudo', 5, 5, 5, 0, 0, true)
on conflict (id) do nothing;

-- Una medida de serie, sin dueño.
insert into public.medidas_caseras (ingrediente_id, owner_id, nombre, gramos)
values (920001, null, 'vaso', 200);

-- ============================================================================
-- 1 · La nota nace sin salir en la hoja
-- ============================================================================
-- Regla de la fase 19: nada que publique algo hacia fuera se enciende solo. Una
-- dieta guardada hace un mes puede tener en `descripcion` un apunte que nadie
-- escribió para imprimirlo.
select pg_temp.como('11111111-1111-1111-1111-111111111111');
insert into public.personas (id, nombre) values ('aaaa2222-0000-0000-0000-00000000000a', 'Ana');
insert into public.dietas (id, persona_id, nombre, descripcion)
values ('dddd2222-0000-0000-0000-000000000001',
        'aaaa2222-0000-0000-0000-00000000000a', 'Con nota', 'Beber 2 L de agua');
insert into public.comidas (id, dieta_id, nombre, orden)
values ('cccc2222-0000-0000-0000-000000000001',
        'dddd2222-0000-0000-0000-000000000001', 'Desayuno', 0);
select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select nota_en_hoja = false from public.dietas
    where id = 'dddd2222-0000-0000-0000-000000000001'),
  'una dieta nueva no imprime su nota mientras no se diga');

select pg_temp.comprobar(
  (select count(*) = 0 from public.dietas where nota_en_hoja),
  'y ninguna de las que ya había se ha encendido sola');

-- ============================================================================
-- 2 · La nota y su interruptor viajan al versionar y al duplicar
-- ============================================================================
-- Los `insert` de `guardar_ajuste` y `duplicar_dieta` llevan la lista de
-- columnas escrita a mano: una columna nueva NO viaja sola. Sin esto, guardar
-- un ajuste apagaría la nota sin decir nada.
select pg_temp.como('11111111-1111-1111-1111-111111111111');
update public.dietas set nota_en_hoja = true
 where id = 'dddd2222-0000-0000-0000-000000000001';

insert into public.componentes (comida_id, opcion_id, ingrediente_id, gramos)
select 'cccc2222-0000-0000-0000-000000000001', opcion_activa_id, 920001, 60
  from public.comidas where id = 'cccc2222-0000-0000-0000-000000000001';

select public.duplicar_dieta('dddd2222-0000-0000-0000-000000000001', 'La copia');
select public.guardar_ajuste(
  'dddd2222-0000-0000-0000-000000000001',
  (select jsonb_agg(jsonb_build_object('id', c.id, 'gramos', 70))
     from public.componentes c
    where c.comida_id = 'cccc2222-0000-0000-0000-000000000001'),
  'La versión 2');
select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select descripcion = 'Beber 2 L de agua' and nota_en_hoja
     from public.dietas where nombre = 'La copia'),
  'duplicar se lleva la nota y su interruptor');

select pg_temp.comprobar(
  (select descripcion = 'Beber 2 L de agua' and nota_en_hoja
     from public.dietas where nombre = 'La versión 2'),
  'y guardar un ajuste también: si no, versionar apagaría la nota en silencio');

-- ============================================================================
-- 3 · Borrar ingredientes: los míos sí, los de BEDCA no
-- ============================================================================
-- El RLS **filtra**, no da error. Así que lo que se comprueba es que la fila
-- sigue ahí, no que la orden reventara.
select pg_temp.como('11111111-1111-1111-1111-111111111111');
delete from public.ingredientes where id = 920001;
select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select count(*) = 1 from public.ingredientes where id = 920001),
  'un ingrediente de BEDCA no se puede borrar, y el RLS no avisa: filtra');

select pg_temp.comprobar(
  not pg_temp.revienta(
    $$delete from public.ingredientes where id = 920004$$,
    '11111111-1111-1111-1111-111111111111'),
  'control: uno mío que no usa nadie SÍ se borra');

select pg_temp.comprobar(
  (select count(*) = 0 from public.ingredientes where id = 920004),
  'y se ha ido de verdad');

select pg_temp.como('22222222-2222-2222-2222-222222222222');
delete from public.ingredientes where id = 920002;
select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select count(*) = 1 from public.ingredientes where id = 920002),
  'y Luis no puede borrar los de Ana');

-- ============================================================================
-- 4 · Un ingrediente que está en uso no se borra
-- ============================================================================
-- `on delete restrict` en `componentes` y en `plantilla_componentes`. Aquí sí
-- hay error, y por eso la pantalla tiene que contar los usos ANTES de ofrecer
-- el botón: si no, el único aviso sería un mensaje de la base.
select pg_temp.como('11111111-1111-1111-1111-111111111111');
insert into public.componentes (comida_id, opcion_id, ingrediente_id, gramos)
select 'cccc2222-0000-0000-0000-000000000001', opcion_activa_id, 920002, 50
  from public.comidas where id = 'cccc2222-0000-0000-0000-000000000001';

insert into public.plantillas (id, nombre) values
  ('bbbb2222-0000-0000-0000-000000000001', 'Con la otra de Ana');
insert into public.plantilla_componentes (plantilla_id, ingrediente_id, gramos)
values ('bbbb2222-0000-0000-0000-000000000001', 920003, 40);
select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  pg_temp.revienta(
    $$delete from public.ingredientes where id = 920002$$,
    '11111111-1111-1111-1111-111111111111'),
  'uno que está en una dieta no se borra');

select pg_temp.comprobar(
  pg_temp.revienta(
    $$delete from public.ingredientes where id = 920003$$,
    '11111111-1111-1111-1111-111111111111'),
  'ni uno que está en una plantilla');

-- Y el recuento que va a enseñar la pantalla, con las mismas consultas.
select pg_temp.comprobar(
  (select count(distinct m.dieta_id) = 1
     from public.componentes c join public.comidas m on m.id = c.comida_id
    where c.ingrediente_id = 920002),
  'el recuento de dietas que lo usan sale de una consulta, no de una suposición');

select pg_temp.comprobar(
  (select count(distinct plantilla_id) = 1
     from public.plantilla_componentes where ingrediente_id = 920003),
  'y el de plantillas, igual');

-- Quitado de la dieta, ya se puede.
select pg_temp.como('11111111-1111-1111-1111-111111111111');
delete from public.componentes where ingrediente_id = 920002;
select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  not pg_temp.revienta(
    $$delete from public.ingredientes where id = 920002$$,
    '11111111-1111-1111-1111-111111111111'),
  'y en cuanto se quita de la dieta, se borra sin problema');

-- ============================================================================
-- 4 bis · Una cuenta puede tener MUCHOS ingredientes propios
-- ============================================================================
-- El fallo de la 0016: con `nulls not distinct` y sin `where`, dos ingredientes
-- propios sin código de BEDCA chocaban entre sí, y una cuenta solo podía tener
-- uno. Los tres de Ana de arriba ya lo demuestran —si el índice fuera el de
-- antes, esta batería no habría llegado ni a montarse—, pero conviene decirlo
-- en una comprobación y no en un comentario.
select pg_temp.comprobar(
  not pg_temp.revienta(
    $$insert into public.ingredientes (owner_id, nombre, nombre_norm, prot_100, hc_100, grasa_100, preferente)
      values ('11111111-1111-1111-1111-111111111111','Cuarta de Ana','cuarta de ana',1,1,1,true)$$,
    '11111111-1111-1111-1111-111111111111'),
  'una cuenta puede tener más de un ingrediente propio sin código');

select pg_temp.comprobar(
  pg_temp.revienta(
    $$insert into public.ingredientes (owner_id, codigo_bedca, nombre, nombre_norm, prot_100, hc_100, grasa_100, preferente)
      values ('11111111-1111-1111-1111-111111111111','N001','Copia de BEDCA','copia de bedca',1,1,1,true),
             ('11111111-1111-1111-1111-111111111111','N001','Otra copia','otra copia',1,1,1,true)$$,
    '11111111-1111-1111-1111-111111111111'),
  'pero no dos suyos con el MISMO código de BEDCA');

select pg_temp.comprobar(
  pg_temp.revienta(
    $$insert into public.ingredientes (owner_id, codigo_bedca, nombre, nombre_norm, prot_100, hc_100, grasa_100, preferente)
      values (null,'N001','Duplicado de BEDCA','duplicado de bedca',1,1,1,true)$$,
    '11111111-1111-1111-1111-111111111111'),
  'y el catálogo compartido sigue protegido de un código repetido');

-- ============================================================================
-- 4 ter · La carga del catálogo, por la función nueva
-- ============================================================================
-- El script ya no puede hacer `upsert`: un índice parcial no se infiere en un
-- `on conflict` sin su `where`. Lo que se prueba es lo que hacía el script:
-- que carga, que relanzarla no duplica, que actualiza, y —esto es nuevo— que
-- no pisa lo corregido a mano.
select public.cargar_catalogo_bedca($$[
  {"owner_id": null, "codigo_bedca": "Z1", "nombre": "Alfa", "nombre_norm": "alfa",
   "estado": "crudo", "prot_100": 1, "hc_100": 2, "grasa_100": 3,
   "fibra_100": 0, "alcohol_100": 0, "porcion_comestible": 1, "preferente": true},
  {"owner_id": null, "codigo_bedca": "Z2", "nombre": "Beta", "nombre_norm": "beta",
   "estado": "crudo", "prot_100": 4, "hc_100": 5, "grasa_100": 6,
   "fibra_100": 0, "alcohol_100": 0, "porcion_comestible": 1, "preferente": true}
]$$::jsonb);

select pg_temp.comprobar(
  (select count(*) = 2 from public.ingredientes where codigo_bedca in ('Z1','Z2')),
  'la carga del catálogo mete las filas nuevas');

-- Una se corrige desde la app, la otra no.
update public.ingredientes set prot_100 = 99, editado_a_mano = true where codigo_bedca = 'Z1';

select public.cargar_catalogo_bedca($$[
  {"owner_id": null, "codigo_bedca": "Z1", "nombre": "Alfa", "nombre_norm": "alfa",
   "estado": "crudo", "prot_100": 1, "hc_100": 2, "grasa_100": 3,
   "fibra_100": 0, "alcohol_100": 0, "porcion_comestible": 1, "preferente": true},
  {"owner_id": null, "codigo_bedca": "Z2", "nombre": "Beta corregida", "nombre_norm": "beta corregida",
   "estado": "crudo", "prot_100": 40, "hc_100": 5, "grasa_100": 6,
   "fibra_100": 0, "alcohol_100": 0, "porcion_comestible": 1, "preferente": true}
]$$::jsonb);

select pg_temp.comprobar(
  (select count(*) = 2 from public.ingredientes where codigo_bedca in ('Z1','Z2')),
  'relanzarla no duplica nada');

select pg_temp.comprobar(
  (select prot_100 = 40 and nombre = 'Beta corregida'
     from public.ingredientes where codigo_bedca = 'Z2'),
  'y actualiza lo que ha cambiado en la fuente');

select pg_temp.comprobar(
  (select prot_100 = 99 from public.ingredientes where codigo_bedca = 'Z1'),
  'pero NO pisa lo que se corrigió a mano desde la app');

-- Una fila a la que le falta un macro no entra a medias: `fibra_100` es NOT
-- NULL y la carga revienta entera. Es lo que se quiere —media ficha nutricional
-- es peor que ninguna— y conviene fijarlo, porque es la diferencia entre un
-- error ruidoso y un catálogo con huecos.
select pg_temp.comprobar(
  pg_temp.revienta(
    $$select public.cargar_catalogo_bedca('[{"owner_id": null, "codigo_bedca": "Z9",
       "nombre": "Sin fibra", "nombre_norm": "sin fibra", "estado": "crudo",
       "prot_100": 1, "hc_100": 2, "grasa_100": 3}]'::jsonb)$$,
    '11111111-1111-1111-1111-111111111111'),
  'una fila sin todos los macros no entra a medias: la carga falla');

-- ============================================================================
-- 5 · Medidas caseras propias
-- ============================================================================
select pg_temp.comprobar(
  not pg_temp.revienta(
    $$insert into public.medidas_caseras (ingrediente_id, nombre, gramos)
      values (920001, 'cazo de Ana', 70)$$,
    '11111111-1111-1111-1111-111111111111'),
  'control: puedo añadir una medida mía a un ingrediente compartido');

select pg_temp.comprobar(
  (select owner_id = '11111111-1111-1111-1111-111111111111'
     from public.medidas_caseras where nombre = 'cazo de Ana'),
  'y nace siendo mía, sin que el cliente mande el dueño');

-- Las de serie no se tocan: el RLS filtra otra vez.
select pg_temp.como('11111111-1111-1111-1111-111111111111');
update public.medidas_caseras set gramos = 999 where nombre = 'vaso';
delete from public.medidas_caseras where nombre = 'vaso';
select pg_temp.otra_vez_root();

select pg_temp.comprobar(
  (select count(*) = 1 and min(gramos) = 200
     from public.medidas_caseras where nombre = 'vaso'),
  'una medida de serie no se puede ni cambiar ni borrar');

select pg_temp.comprobar(
  pg_temp.revienta(
    $$insert into public.medidas_caseras (ingrediente_id, nombre, gramos)
      values (920001, 'cazo de Ana', 80)$$,
    '11111111-1111-1111-1111-111111111111'),
  'dos medidas mías del mismo alimento no se pueden llamar igual');

select pg_temp.comprobar(
  not pg_temp.revienta(
    $$insert into public.medidas_caseras (ingrediente_id, nombre, gramos)
      values (920001, 'vaso', 210)$$,
    '11111111-1111-1111-1111-111111111111'),
  'pero una mía sí puede llamarse como una de serie: el único lleva el dueño');

select pg_temp.comprobar(
  not pg_temp.revienta(
    $$delete from public.medidas_caseras where nombre = 'cazo de Ana'$$,
    '11111111-1111-1111-1111-111111111111'),
  'y las mías se borran cuando quiero');

select pg_temp.como('22222222-2222-2222-2222-222222222222');
select pg_temp.comprobar(
  (select count(*) = 0 from public.medidas_caseras
    where nombre = 'vaso' and owner_id is not null),
  'Luis no ve las medidas propias de Ana');
select pg_temp.otra_vez_root();

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
    raise exception 'La undécima batería tiene % comprobaciones en rojo', v_mal;
  end if;
  raise notice 'Undécima batería: % comprobaciones, todas en verde',
    (select count(*) from _resultados);
end $$;

rollback;

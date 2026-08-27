-- ---------------------------------------------------------------------------
-- 0010 — El peso de la persona
--
-- Sirve para una sola cosa, y es la que se pidió: poder leer el reparto de
-- macros en **gramos por kilo de peso**, que es como se prescribe la proteína
-- en la práctica («1,6 g/kg»). El porcentaje solo no lo dice: un 30% de
-- proteína son 2 g/kg en una persona de 100 kg y 4 g/kg en una de 50.
--
-- Un solo valor, el actual, y no un histórico con fechas. Un histórico es otra
-- tabla, otra pantalla y una gráfica, y hoy no hay nada que lo pida: en cuanto
-- haga falta seguir la evolución se añade `pesos (persona_id, fecha, kg)` y
-- esta columna pasa a ser «el último», sin romper nada de lo que se escriba
-- ahora.
--
-- Nullable a propósito: una persona sin peso es normal —no siempre se sabe, ni
-- siempre hace falta— y la app dice «—» en vez de inventarse un cero. El tope
-- de 400 no es un juicio sobre nadie: es para cazar el dedo que escribe 700 al
-- teclear 70.
-- ---------------------------------------------------------------------------

alter table public.personas
  add column if not exists peso_kg numeric(5,2)
    check (peso_kg is null or (peso_kg > 0 and peso_kg <= 400));

comment on column public.personas.peso_kg is
  'Peso actual en kilos. Solo para leer los macros en g/kg. Nulo = no se sabe.';

ALTER TABLE public.machine_ingredients
  ADD CONSTRAINT machine_ingredients_machine_position_key UNIQUE (machine_id, position);

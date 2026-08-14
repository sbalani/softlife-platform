CREATE INDEX IF NOT EXISTS machine_change_log_machine_id_idx ON public.machine_change_log (machine_id);
CREATE INDEX IF NOT EXISTS machine_change_log_actor_id_idx ON public.machine_change_log (actor_id);
CREATE INDEX IF NOT EXISTS machine_menu_snapshots_machine_id_idx ON public.machine_menu_snapshots (machine_id);

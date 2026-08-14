CREATE INDEX alerts_change_log_id_idx ON public.alerts (change_log_id);
CREATE INDEX alerts_resolved_by_idx ON public.alerts (resolved_by);
CREATE INDEX change_alert_rules_machine_id_idx ON public.change_alert_rules (machine_id);
CREATE INDEX change_alert_rules_created_by_idx ON public.change_alert_rules (created_by);

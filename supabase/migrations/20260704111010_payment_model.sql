-- Internal payment model per machine (not a Huaxin setting — for billing/revenue tracking)
-- automatic: end users pay via Nayax/card/coins directly
-- server:    franchisee collects payment manually (we bill them)
-- hybrid:    both methods possible
alter table public.machines add column if not exists payment_model text default 'automatic';

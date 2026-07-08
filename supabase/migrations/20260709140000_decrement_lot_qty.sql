-- Atomic decrement so concurrent refills against the same lot don't race
-- (a read-qty-then-write-qty round trip from the app would lose updates
-- under concurrent writes; a single UPDATE statement can't).
create or replace function public.decrement_lot_qty(p_lot_id uuid, p_amount double precision)
returns void language sql as $$
  update public.lots set qty_available = qty_available - p_amount where id = p_lot_id;
$$;

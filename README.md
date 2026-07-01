# SoftLife Platform

The independent **middleware + dashboard** for SoftLife: machine management,
Huaxin telemetry, HACCP, and inventory — multi-tenant for franchisees. Odoo
sits downstream (accounting / VeriFactu) and is integrated later.

**Stack:** Next.js 16 (App Router) + React 19 + Tailwind v4 on **Vercel**,
Postgres + Auth + RLS on **Supabase**.

## Run locally
```bash
cp .env.example .env.local      # fill in Supabase + Huaxin values (or leave blank for sample data)
npm install
npm run dev
```
Open http://localhost:3000 — it redirects to `/machines`. With no Supabase
keys it shows **branded sample data** so you can see the dashboard immediately.

## Set up Supabase
1. Create a project at supabase.com.
2. Open the SQL editor and run [`supabase/schema.sql`](./supabase/schema.sql).
3. Put the project URL + anon key + service role key into `.env.local`.

The schema is multi-tenant: every tenant-scoped table has `tenant_id` and is
gated by **Row-Level Security** (`tenant_id = current_tenant_id()`, admins see
all). A `handle_new_user` trigger auto-creates a profile on signup.

## Huaxin integration
The Huaxin client lives in [`src/lib/huaxin/client.ts`](./src/lib/huaxin/client.ts).
It uses Huaxin's **fixed credential block** (no per-request signing — verified
live against UAT). Set the five `HUAXIN_*` values in `.env.local`.

- **Webhook receiver** — `POST /api/huaxin/notify` stores order + fault events.
  Give Huaxin this URL as their `notify_url` (your Vercel domain + the path).
- **Device sync** — `GET /api/cron/huaxin-sync` pulls the Huaxin device list
  and upserts machines. Wire it up in `vercel.json` as a daily cron and protect
  it with `CRON_SECRET`.

> The Huaxin **UAT TLS certificate is expired**. Keep `HUAXIN_VERIFY_SSL=false`
> for UAT and turn it back on for production.

## Project layout
```
src/app/(dashboard)/        dashboard UI (sidebar shell + screens)
src/app/api/huaxin/notify   inbound webhook receiver (orders + faults)
src/app/api/cron/huaxin-sync  scheduled device sync
src/lib/huaxin/             Huaxin bridge client
src/lib/supabase/           server + service clients
src/lib/data/               data access (Supabase → sample fallback)
supabase/schema.sql         Postgres schema + RLS + dashboard view
```

## Status (v0.1)
- [x] Branded dashboard shell + Machines page (Supabase or sample data)
- [x] Supabase multi-tenant schema + RLS
- [x] Huaxin client + webhook + sync cron
- [ ] Auth + franchisee login (Supabase Auth + profile/role)
- [ ] Orders, Alerts, Temperatures, Inventory, Transfers, Franchisee screens
- [ ] Retarget the mobile app to `/api/*` (contract already defined)
- [ ] Odoo downstream (VeriFactu / invoicing)

# Franchisee Contract Reminders

This function sends the Spanish reminder for contract version `SL-GESTOR-2026-10-26-v3`. The database outbox snapshots each franchisee tenant's selected recipient and records missing recipients as `skipped`. Claims use leases and Resend receives a stable idempotency key for safe retries.

The migration defines but intentionally does not call `configure_franchisee_contract_reminder_schedule`. Activate the campaign only after the Resend key exists and the function is deployed:

```sh
npx supabase migration up --linked
npx supabase secrets set RESEND_API_KEY="$RESEND_API_KEY" RESEND_FROM_EMAIL="payments@softlife.es" PLATFORM_URL="https://platform.softlife.es"
npx supabase functions deploy franchisee-contract-reminders --no-verify-jwt --use-api
```

`RESEND_API_KEY` is required. `RESEND_FROM_EMAIL` defaults to `payments@softlife.es`, and `PLATFORM_URL` defaults to `https://platform.softlife.es`.

Then run this exact statement in the production Supabase SQL editor to create the Vault token and daily 08:00 UTC cron job:

```sql
SELECT public.configure_franchisee_contract_reminder_schedule(
  'https://awsfqnymosevmhawbukf.supabase.co/functions/v1/franchisee-contract-reminders'
);
```

For a manual synchronous run, retrieve `softlife_franchisee_contract_reminder_token` from Vault in the SQL editor and POST it as `x-cron-token`. The JSON response reports claimed, sent, failed, and total status counts.

```sql
SELECT decrypted_secret
FROM vault.decrypted_secrets
WHERE name = 'softlife_franchisee_contract_reminder_token';
```

```sh
curl --fail-with-body --request POST \
  --header "x-cron-token: $CRON_TOKEN" \
  --header "content-type: application/json" \
  --data '{}' \
  https://awsfqnymosevmhawbukf.supabase.co/functions/v1/franchisee-contract-reminders
```

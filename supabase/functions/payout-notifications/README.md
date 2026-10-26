# Payout Notifications

This function drains the durable paid-payout email and push queues. Resend receives a stable settlement idempotency key, Expo tokens are sent in chunks of 100, and `DeviceNotRegistered` tokens are removed. Inbox rows remain available independently of either delivery channel.

The migration defines `configure_payout_notifications_schedule` but intentionally does not call it. `RESEND_API_KEY` is currently absent, so do not activate the schedule yet.

After the key is available, apply and deploy explicitly:

```sh
npx supabase migration up --linked
npx supabase secrets set RESEND_API_KEY="$RESEND_API_KEY" RESEND_FROM_EMAIL="payments@softlife.es"
npx supabase functions deploy payout-notifications --no-verify-jwt --use-api
```

Then activate the single five-minute Supabase cron job from the production SQL editor:

```sql
SELECT public.configure_payout_notifications_schedule(
  'https://awsfqnymosevmhawbukf.supabase.co/functions/v1/payout-notifications'
);
```

No migration statement schedules the job. `RESEND_FROM_EMAIL` defaults to `payments@softlife.es`; `EXPO_ACCESS_TOKEN` is optional for Expo projects that do not require enhanced push security.

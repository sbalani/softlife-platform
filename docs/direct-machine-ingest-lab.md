# Direct machine ingestion lab

This experiment is isolated on the Git branch `experiment/direct-machine-ingest`
and the persistent, data-less Supabase branch `direct-machine-ingest`
(`wsaxjxtyrjjeyjmszulm`). It does not feed existing machines, alerts, orders,
temperature processing, or Huaxin synchronization.

## Receiver

Endpoint:

```text
https://wsaxjxtyrjjeyjmszulm.supabase.co/functions/v1/direct-machine-ingest-lab
```

Send JSON with a secret in `x-ingest-token`. If the test machine cannot set
headers, use `?token=...` instead. The token must never be committed.

```bash
curl --request POST "$DIRECT_MACHINE_INGEST_URL" \
  --header "content-type: application/json" \
  --header "x-ingest-token: $DIRECT_MACHINE_INGEST_TOKEN" \
  --data '{"imei":"test-machine","event":"status"}'
```

The receiver accepts only `POST`, caps bodies at 256 KiB, redacts credential
and network-address headers, and stores both the exact text body and parsed JSON
when valid. Only content metadata, user agent, and explicit device identifier
headers are retained. A daily service-only cleanup removes captures after 30
days.

## Analysis

Payload frequency by minute and tentative device identifier:

```sql
SELECT date_trunc('minute', received_at) AS minute, device_hint, count(*)
FROM public.direct_machine_payloads
GROUP BY 1, 2
ORDER BY 1 DESC, 2;
```

Recent payload shapes:

```sql
SELECT received_at, device_hint, content_type, body_size_bytes, body_sha256,
  body_json, body_text
FROM public.direct_machine_payloads
ORDER BY received_at DESC
LIMIT 100;
```

Repeated identical payloads:

```sql
SELECT body_sha256, count(*), min(received_at), max(received_at)
FROM public.direct_machine_payloads
GROUP BY body_sha256
HAVING count(*) > 1
ORDER BY count(*) DESC;
```

Do not connect this table to production processing until payload contracts,
authentication, replay behavior, ordering, frequency, and failure semantics are
understood and covered by a separate promotion plan.

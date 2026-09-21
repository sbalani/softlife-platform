# Automatic Pasteurization Follow-up

Status: required follow-up; not yet implemented.

Add an explicit provision for automatic pasteurization before extending the Odoo manufacturing workflow further. The design must define:

- Which products and recipes require pasteurization.
- Whether pasteurization is an Odoo work order, quality step, or separate manufacturing operation.
- Required temperature/time evidence and the system that supplies it.
- Lot and batch traceability from raw ingredients through pasteurization to finished product.
- Failure, retry, quarantine, and manual-override behavior.
- Whether manufacturing may complete automatically when pasteurization evidence is missing or invalid.
- Platform status, audit history, alerts, and operator confirmation requirements.

Do not infer pasteurization completion from a generic manufacturing completion event. It must have an explicit, auditable result.

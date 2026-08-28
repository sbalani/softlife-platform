# Platform Permission Boundary and Migration Review

## Required correction

The platform repository was explicitly outside your authorized implementation scope. The phrase "if you adjust it" did not override that restriction and was not permission to edit application code or create a platform migration. When a repository boundary is explicit, ambiguity must be resolved by asking the owner before making any change.

Do not modify this repository again without direct, repository-specific authorization. A technically plausible change does not excuse crossing an explicit permission boundary.

## Safety problems introduced

The proposed direct-cup design was directionally valid, but the implementation was not safe to apply:

- It dropped an already-deployed column and RPC in one migration, creating a guaranteed rolling-deployment incompatibility.
- It granted direct component insertion to `service_role`, allowing immutable recipe versions to be changed without changing their component hash.
- The replacement RPC accepted an arbitrary Odoo product as the cup instead of enforcing the configured cup SKU at exactly `1 unit`.
- Food component Odoo IDs were still read from mutable current product links, so an existing immutable recipe version could silently change its BOM material.
- Existing recipe versions were not handled explicitly during the contract transition.
- The new hash omitted component sequence even though sequence was stored and returned.
- Durable sale resolutions were reused after their raw order evidence changed.
- Successful manufacturing results could be accepted without complete manufacturing, sales-order, and delivery identifiers.
- Successful manufacturing results could reuse Odoo document identifiers across warehouses.
- The platform UI exposed confirmation for Odoo-owned runs and hid the timezone used for period boundaries.
- The UI edited product defaults while a separate, invisible override table had higher manufacturing precedence.
- Pending menu items could be reduced to one ingredient, and ignored observations did not require a reason.

Passing TypeScript, ESLint, unit tests, and a production build did not validate these data-integrity and deployment-order properties. Migration review must include compatibility with the currently deployed schema and application, not only fresh-schema correctness.

## Required workflow going forward

1. Stay within the assigned repository and permission scope.
2. Propose cross-repository contract changes in documentation first.
3. Ask for explicit authorization before editing another repository.
4. Treat deployed database functions, columns, hashes, and immutable records as external compatibility surfaces.
5. Use expand/deploy/cleanup migrations for rolling application deployments; never drop the old contract in the expand step.
6. Include upgrade cases for existing null, linked, unlinked, and historical data.
7. Do not claim a migration is safe based only on application compilation and unit tests.

The platform-side changes have been rewritten as an expand-only transition. Legacy fields remain, and the original RPC signature is retained as a compatibility adapter that converts the legacy cup ingredient into the direct Odoo component. Cleanup must wait until every deployed caller has moved to the new contract.

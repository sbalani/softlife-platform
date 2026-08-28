<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Supabase Operations

- Use the authenticated linked Supabase CLI workflow for this project (`npx supabase migration list --linked`, `npx supabase migration up --linked`, and other `npx supabase ...` commands).
- Do not use Docker, a local Supabase stack, direct Postgres tools, or `SUPABASE_DB_PASSWORD` as fallbacks unless the user explicitly requests that workflow.

## Delivery Status

- Every completion message must explicitly state whether changes were committed and pushed.
- If changes have not been pushed, say `NOT PUSHED` prominently and state that user confirmation is required before pushing.
- Do not describe implementation work as done without also reporting its commit and push status.

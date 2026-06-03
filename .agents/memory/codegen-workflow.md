---
name: API codegen workflow
description: How to run codegen and DB migrations in this Omniflow monorepo.
---

## Orval codegen (API client + Zod schemas)
```
pnpm --filter @workspace/api-spec run codegen
```
Regenerates `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/` from `lib/api-spec/openapi.yaml`.

## DB schema migration
1. Edit `lib/db/src/schema/*.ts`
2. Run: `pnpm --filter @workspace/db exec drizzle-kit push --force`
   - `--force` needed to skip interactive prompts

## Direct SQL (for seed/migration scripts)
`pg` module is available at: `/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg`
```js
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pg = require('/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
```
Run with: `node --input-type=module << 'EOF' ... EOF`

## tsx not available as pnpm exec
`pnpm exec tsx` doesn't work — tsx is not in PATH via pnpm exec in this environment. Use the node + direct require approach above.

**Why:** The `tsx` command requires being in the right node_modules context; use raw node with dynamic import/require of pg instead.

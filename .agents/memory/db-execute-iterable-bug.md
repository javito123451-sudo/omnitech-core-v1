---
name: db.execute() QueryResult not iterable
description: Drizzle db.execute(sql\`...\`) returns a QueryResult object with .rows, NOT an array. Desestructuring `const [x] = await db.execute(...)` fails with "(intermediate value) is not iterable".
---

## The bug

Drizzle's `db.execute(sql\`...\`)` returns a `QueryResult` object shaped like:

```js
{ rows: [...], command: "SELECT", rowCount: 1, ... }
```

It does **NOT** return an array. Therefore this pattern is invalid:

```js
// WRONG — throws "(intermediate value) is not iterable"
const [row] = await db.execute(sql\`SELECT ...\`);
```

## The correct pattern

```js
// CORRECT
const result = await db.execute(sql\`SELECT ...\`) as unknown as { rows: Array<MyRow> };
const rows = result.rows ?? [];
if (rows.length === 0) { /* handle empty */ }
const first = rows[0];
```

## Where it was found

- `control-center.ts:327` — `INSERT INTO support_sessions ... RETURNING id`
- `control-center.ts:342` — `SELECT FROM support_sessions ...`
- `control-center.ts:359` — same SELECT in exit endpoint

The error message in production logs was misleading: it looked like `TypeError: Cannot read properties of null (reading 'userId')` but the real error was `(intermediate value) is not iterable`. The user's report of "line 327, userId null" was a false lead — the actual crash was the destructuring of `db.execute()`.

## Prevention

- Always use `db.select().from().where()` for typed queries (returns arrays).
- Only use `db.execute(sql\`...\`)` for raw SQL that can't be expressed with Drizzle API.
- When using `db.execute()`, NEVER destructure with `const [x] = ...`. Always cast to `{ rows: Array<...> }`.

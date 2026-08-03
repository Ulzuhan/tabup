# TabUp

Shared expense tracking for trips: who paid what, in which currency, and who owes whom
at the end. Multi-currency, uneven splits, settle-up payments and CSV export.

**You do not need an account to use it.** Start a trip, share the link, done. An account
is only there to keep your trips together across devices.

---

## Running it

```bash
npm install
npm run dev            # http://localhost:3000
```

Production:

```bash
npm run build
npm run start
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `TABUP_DB` | `data/tabup.db` | SQLite database file |
| `TABUP_DATA_DIR` | `data/` | Where the exchange-rate cache is kept |
| `PORT` | `3000` | Port to listen on |

The older `SPLITTRIP_DB` and `SPLITTRIP_DATA_DIR` still work, and an existing
`data/splittrip.db` is picked up automatically, so a deployment from before the rename
keeps its data.

The database file and its directory are created on first start. There is no separate
migration step: the schema is applied on boot, and it is safe to run against a database
from an earlier version.

---

## Access model

Three states, and the whole authorisation story fits in them:

| Trip | Who can read | Who can write | Who can delete |
| --- | --- | --- | --- |
| **Anonymous** (no owner) | anyone with the link | anyone with the link | anyone with the link |
| **Owned** | owner + invited accounts | owner + editors | owner only |
| **Owned, shared as viewer** | that account too | no | no |

An anonymous trip is the default and the reason the app is usable in ten seconds at a
restaurant table. The link *is* the credential, which is the same bargain as a shared
Google Doc link — fine for a weekend in Lisbon, not for anything you would not put in a
group chat.

Claiming a trip closes it: once it has an owner, the link alone stops being enough.
This is one-way on purpose — someone who claimed a trip cannot silently reopen it to
everyone who still has the old link.

Signing in sends the trip ids this browser remembers, and any that still have no owner
become yours. Nothing is lost by having used the app anonymously first.

### What the free plan caps

Owning **3 trips**. Anonymous use is not capped: the limit is on keeping trips on an
account, not on splitting a bill.

---

## Why SQLite

It used to be one JSON file per trip, read and rewritten whole on every change. That
does not survive concurrent writes, which is the *normal* case here — several people
adding expenses to the same trip at once.

Measured on the old implementation, five simultaneous expenses:

```
2 requests → HTTP 500
3 requests → HTTP 200
1 expense actually saved
```

Two of those "successful" requests lost the user's data silently. For an app about
money that is the worst failure mode there is. The same test on SQLite:

```
10 requests → HTTP 200
10 expenses saved, total correct
```

Every write is a transaction. It either lands completely or not at all.

---

## Tests

Both suites run against a live server, no test framework:

```bash
npm run start &
npm run test:api     # 18 tests — splitting, balances, validation, concurrency
npm run test:auth    # 41 tests — accounts, ownership, sharing, plan limits
```

`test:api` includes the concurrency regression above. `test:auth` covers the isolation
boundary: a stranger who knows an owned trip's id gets a 404 on read, write, export and
delete, and an editor cannot delete or reshare a trip they do not own.

Point them at a scratch database so they do not touch your real one:

```bash
TABUP_DB=/tmp/test.db PORT=3999 npm run start &
BASE=http://127.0.0.1:3999 npm run test:api
BASE=http://127.0.0.1:3999 npm run test:auth
```

---

## Security notes

- **Passwords**: scrypt, N=16384, per-password salt. Cost parameters are stored in the
  hash, so raising them later does not lock out existing accounts.
- **Sessions**: the database holds a SHA-256 of the cookie token, never the token. A
  leaked database copy cannot be replayed as a login. Cookie is `httpOnly`,
  `sameSite=lax`, and `secure` in production.
- **Login throttling**: per IP and per account, 10 attempts per 15 minutes. In-process,
  so it assumes a single instance — running more than one means moving it to the
  database.
- **Enumeration**: a trip you cannot see returns 404, not 403. Failed logins do not say
  which half was wrong, and a login attempt against a non-existent account still runs a
  hash so the response time does not give it away.
- **CSV export**: fields starting with `=`, `+`, `-` or `@` are prefixed, so a crafted
  expense description cannot become a formula in Excel.

Not covered: there is no email verification, no password reset, and no CSRF token
beyond `sameSite=lax`. Those are the next things to add if this is ever exposed to
people you do not know.

---

## Migrating from the JSON version

```bash
node scripts/migrate-json.mjs [source-directory]   # defaults to .splittrip-data
```

Idempotent, and the JSON files are never modified or deleted. Trips whose id already
exists in the database are skipped. Imported trips arrive without an owner, so they
behave as anonymous trips and can be claimed.

---

## Layout

```
src/db/schema.ts      tables + why each one exists
src/db/index.ts       connection, pragmas, schema creation on boot
src/lib/store.ts      every read and write; the only place that touches the database
src/lib/auth.ts       passwords, sessions, throttling
src/lib/authorize.ts  the single gate every trip route goes through
src/app/api/          route handlers
scripts/              integration tests and the JSON importer
```

`authorize.ts` exists so that adding an endpoint without an access check is a visible
omission rather than an easy accident.

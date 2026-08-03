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
| `TABUP_ALLOW_REGISTRATION` | unset | `true` opens sign-ups; otherwise only the first account is allowed |
| `TABUP_FREE_TRIP_LIMIT` | unset | Caps how many trips an account may own; no cap by default |
| `TABUP_BACKUP_DIR` | `~/backups/tabup` | Where `backup-db.mjs` writes snapshots |
| `TABUP_BACKUP_KEEP` | `14` | Snapshots to keep |
| `TABUP_BACKUP_REMOTE` | unset | rsync target for offsite copies |

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

### Registration

Once an instance has its first account, sign-ups are refused unless
`TABUP_ALLOW_REGISTRATION=true`. Anything reachable from the internet with an open
registration endpoint collects accounts that are not yours. Nobody needs an account to
use a trip — the link is enough — so opening it is rarely the right answer.

### No cap on trips

There was one, of three. It saved no storage worth the name and it is exactly the sort
of invented scarcity people resent in Splitwise, whose free tier stops at a handful of
expenses a day. `TABUP_FREE_TRIP_LIMIT` can reinstate a cap if this ever becomes a paid
product; what is worth charging for is what costs money to run.

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

## Languages

Spanish and English, chosen from the header. The choice lives in a cookie; without one
the browser's `Accept-Language` decides, falling back to Spanish.

Deliberately **not** the sub-path routing Next's own guide recommends (`/es/trip/abc`).
A trip link is the credential for an anonymous trip, people have those links saved and
pasted into group chats, and prefixing every route would break every one of them — for
a two-language app that is a bad trade.

Spanish is the source of truth in `src/i18n/messages.ts` and its shape defines the
type, so a key missing from English is a compile error rather than an untranslated
string appearing in front of someone. Plurals go through `Intl.PluralRules` (`key_one`
/ `key_other`), because "1 gastos" is exactly the kind of detail that makes an app feel
unfinished.

## Offline and installing

The app is a PWA: installable from the browser, and a trip stays readable with no
connection — on a plane, on a mountain, or on roaming you would rather not pay for.

The service worker splits its rules deliberately:

- **Shell and static assets** — cache first. They only change when a new build ships.
- **API reads** — network first, cache only as a fallback. Balances are the reason this
  app exists, and showing a stale figure as if it were current would be worse than
  showing nothing, so a cached response is flagged and the page says the numbers are
  from the last time it had signal.

### Writing offline

New expenses and payments **do** queue. Typed with no signal, they go into IndexedDB,
appear in the list straight away, and are sent when the connection returns — with the
balances recomputed locally in the meantime, using the same functions the server runs,
because showing the expense but leaving the balances behind would be worse than useless.

Two things make this tractable without a full sync engine:

- **Creating commutes.** Two people adding expenses offline both end up with both
  expenses, in any order, with no conflict to resolve.
- **Every queued write carries a client id**, and the server treats a repeat as the same
  write. Without that, a request that arrived but whose response was lost would be
  duplicated by the retry — and duplicating a charge is worse than dropping one.

**Editing and deleting do not queue**, deliberately. They need the server's current
state to mean anything: editing an expense someone else already changed, or deleting one
they already deleted, are conflicts with no good silent answer. Offline they fail and
say so.

Icons are generated from one vector definition:

```bash
node scripts/generate-icons.mjs
```

## Operations

```bash
node scripts/backup-db.mjs                        # snapshot the database
node scripts/reset-password.mjs --list            # which accounts exist
node scripts/reset-password.mjs ana@example.com   # set a new password, print it
```

**Backups** use SQLite's backup API rather than copying the file. In WAL mode the `.db`
file alone is not the current state — recent commits live in `-wal` until a checkpoint —
so `cp` under a running server yields a snapshot missing writes, or a corrupt one if a
checkpoint lands mid-copy. Each snapshot is integrity checked *before* older ones are
rotated out, so a bad backup can never destroy the good ones.

Restore by stopping the server, gunzipping a snapshot over the database file, and
starting it again.

**Password resets** happen from the machine that holds the database. There is no
reset-by-email flow: for a handful of accounts, an email provider plus tokens and their
expiry is more machinery than the problem deserves. What this does close is the real
hole — forgetting a password used to mean losing the trips behind it for good. The
script signs out every existing session and verifies the stored hash before reporting
success.

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

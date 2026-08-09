# TabUp

Shared expense tracking for trips: who paid what, in which currency, and who owes whom
at the end. Multi-currency, uneven splits, settle-up payments and CSV export.

Every trip belongs to an account, and the people it splits between are `members` — which
is a different thing. An account is who may *open* a trip; a member is a column in its
arithmetic. Most members at a real table will never register here, and that is fine: a
member can be a bare name, and it can be tied to an account later.

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
| `TABUP_REGISTRATION` | `closed` | `closed`, `approval` or `open`; see [Registration](#registration) |
| `TABUP_ALLOW_REGISTRATION` | unset | Old flag, still honoured as `open` so upgrades do not change behaviour |
| `TABUP_OLLAMA_URL` | `http://127.0.0.1:11434` | Where the receipt-reading model lives |
| `TABUP_OCR_MODEL` | `qwen3.5:397b-cloud` | Vision model used to read receipts |
| `TABUP_OCR_TIMEOUT` | `60000` | Milliseconds before giving up on the model |
| `TABUP_FREE_TRIP_LIMIT` | unset | Caps how many trips an account may own; no cap by default |
| `TABUP_BACKUP_DIR` | `~/backups/tabup` | Where `backup-db.mjs` writes snapshots |
| `TABUP_BACKUP_KEEP` | `14` | Snapshots to keep |
| `TABUP_BACKUP_REMOTE` | unset | rsync target for offsite copies |
| `TABUP_PUSH_SUBJECT` | `mailto:tabup@localhost` | Contact a push service can complain to; part of VAPID |

The database file and its directory are created on first start. There is no separate
migration step: the schema is applied on boot, and it is safe to run against a database
from an earlier version.

---

## Two sections

**Trips** are shared, temporary and about who owes whom. **Fixed costs** —
subscriptions, insurance, rent — are personal, permanent and about where the money
goes. They are deliberately separate: merging them into one list would make both worse.

A fixed cost is stored as a *rule*, not a ledger: amount, period, when it started and
when it was cancelled. Any month, past or future, is computed from that — nothing is
generated, nothing breaks because the app went unopened for a while, and cancelling
something keeps the history of the months it was active.

A week is 52 charges a year, not 48, so weekly items convert at ×52/12. A charge on the
31st lands on the 28th in February rather than rolling into March. Both are covered by
`npm run test:recurring`.

Fixed costs require an account and are never shared: there is no link that grants access
to them, and every query is scoped by user id.

## Money in more than one currency

A trip is kept in **one currency**, chosen when it is created and fixed afterwards. Every
expense stores two figures: `amount` in whatever was typed, and `amountBase` in the trip's
currency. Everything that is arithmetic — balances, settlements, totals, the spending
pace, the category breakdown, the CSV — reads only `amountBase`. Nothing anywhere sums an
unconverted amount.

Rates come from [Frankfurter](https://frankfurter.app), which serves the European Central
Bank's daily reference rates against the euro; a conversion between any two currencies
goes through the euro on the way past. The list of currencies offered is exactly the set
the ECB publishes, so a currency that cannot be converted cannot be chosen.

Four rules, each of which was once broken:

- **Converted as of the day it was spent**, not the day it was typed. Expenses carry a
  date and can be backdated, and historical rates never change — which is what makes them
  worth keeping for good once fetched.
- **Converted once, then left alone.** An edit that does not change the amount, the
  currency or the date does not reconvert. The test used to be "did the request mention a
  currency", and the form mentions it on every save, so correcting a typo in a
  three-month-old expense silently repriced it and moved everybody's balance.
- **It says when it is guessing.** A rate that is not the one that applied — a cache that
  has gone a day without contact, or today's table standing in for a day that could not
  be fetched — still converts, because refusing would leave somebody unable to record what
  they spent, but the expense is marked and the screen shows it. The same goes for an
  expense typed with no connection at all: it counts at face value and says so until it
  syncs.
- **It never invents one.** With no table at all the write is refused with a 502. There is
  no path that falls back to 1:1.

**A settle-up carries its own currency too.** A peso debt is often cleared by a euro
transfer, which is the commonest way a trip actually ends; recording that as if the number
were pesos is wrong by a factor of sixty. Splid supports this and calls it a feature;
Splitwise does not.

For comparison: [Splitwise does not convert at all by
default](https://feedback.splitwise.com/knowledgebase/articles/301146-can-splitwise-do-currency-conversion-between-multi)
— it keeps a separate balance per currency, and conversion is a paid extra that rewrites
past expenses at today's rate. Splid converts automatically, as this does.

Fixed costs are the one place with a different base: they are one person's, are shown as a
monthly figure in euros, and so are stored in euros. Same rule about not reconverting on
an edit.

## Access model

Every trip has an owner. Knowing a trip's URL grants nothing — there was an anonymous
mode once, where the link was the whole credential, and it went because it needed a
second set of rules nobody could keep straight (claiming, ownerless deletion, trips
remembered only by one browser) and could not answer the obvious question of what
happens when two people claim the same link.

|  | Read | Add expenses and payments | Change one | Rename, budget, add or remove people, invite, hand over, delete |
| --- | --- | --- | --- | --- |
| **Owner** | yes | yes | any | yes |
| **Member** | yes | yes | the ones they entered, and the ones that say they paid | no |

There used to be a third row, and two of these used to be four. "Editor" and "viewer"
answered a different question from the one anybody asks: being an editor said nothing
about being in the split, so inviting a friend as one gave them the run of the trip while
leaving them out of every balance in it — and the owner then had to add them a second
time, by hand, as a name with no connection to their account. Two ideas of "who is in
this trip", disagreeing with each other.

There is one now. **A row in `trip_access` means a seat in `members`, and a seat linked to
an account means a row in `trip_access`.** What anyone may do follows from the trip
itself, so nothing is stored per person: the owner keeps the trip, everyone in it adds
expenses, and each may change the ones they entered. `expenses.created_by` and
`payments.created_by` are what that last rule reads; a row with no author — anything
written before the column existed, or left behind by a deleted account — belongs to
nobody and only the owner may touch it.

**Whoever it says paid may change it too**, even if somebody else typed it. Those are
different people — one person usually holds the phone at the table — and a rule that
follows only the typist means you cannot correct the record of your own money without
asking them. A settle-up works the same way: it is a statement about two people, and
either of them may take it back.

The trip can be **handed to somebody else in it**, which is the way out of the owner
being a single point of failure. The outgoing owner stays in as an ordinary member,
keeping their seat and every figure in it.

A trip you may not see returns 404 rather than 403, so the endpoint cannot be used to
probe which trip ids exist. An expense id from another trip gets the same 404, for the
same reason.

**Ids in a request body are checked against the trip in the URL.** Authorisation is per
trip, and an expense id, a payment id or a member id all arrive in the body — so
without that pairing, write access to any one trip would be write access to any row
whose id you knew, and a read-only guest is handed the ids of everything they can see.
`npm run test:members` is what keeps that honest.

### Members are not accounts

The people a trip splits between and the accounts that may open it are separate on
purpose:

- A **free member** is a name with no account behind it. Most people at a table are one
  — this instance does not even take open sign-ups — and refusing to split a taxi four
  ways until everyone has registered would be the wrong trade. It grants nobody
  anything: it is a column of arithmetic with a label on it.
- A **linked member** is tied to an account. That link is what lets the app say "you owe
  23" instead of "Andoni owes 23", and it is the only way settling up can mean anything
  between two people rather than between two strings.

Adding somebody **by email** does both at once: it seats them in the split and lets them
in. If nobody holds that address yet, the seat is made anyway and the invitation is
bound to it, so accepting later lands them in the right column instead of leaving them
outside the arithmetic. Adding somebody **by name** creates a free member that an
account can claim later.

Whoever creates a trip is its first member, so a trip of one is normal — you invite the
rest, and there is no minimum. Requiring two names up front was backwards: at the moment
of creating a trip you do not yet know what the second person will be called.

### Joining a trip

Accepting an invitation puts you in the split. Which of two things happens depends on
whether the trip still holds names somebody typed before you arrived:

- **Nothing free to claim** — you are seated on the way in, under your account's name,
  and never see a question.
- **Free members exist** — one of them may well be you, and matching "Andoni" to an
  account by spelling would be a guess about money, so the trip asks: the free names are
  offered, and "none of these, I am new" lets you join as yourself under a name you type.
  This is also how every trip made before any of this gets its members attached to real
  people, since all of theirs are bare text.

A link made for one address in particular is different again: it seats that person in the
seat kept for them, and that seat is offered to nobody else while the link is live.

A member's name is a per-trip **alias**: the same account is "Andoni" among friends and
"Papá" in the family trip, and neither is a lie about who they are. Your own name is
yours to change — it is the one thing in the trip settings that is not the owner's — and
the owner labels the free members, since somebody typed those in.

### Taking somebody out

One action, two outcomes, chosen by what the seat is rather than by a flag:

- **Somebody still in the trip** loses their access and keeps their seat. The column and
  every figure in it stay exactly where they were: "they have left the trip" is not a
  statement that their half of the taxi never happened.
- **Anyone else** — a free member, or an account already shown the door — is deleted, and
  the cascade takes the expenses they paid for, the payments they were part of and their
  share of everyone else's.

So pressing it twice does both, deliberately as two decisions. The owner's own seat is
refused, and refused before anything is written: a batch that failed halfway would report
an error over work it had already done.

**Nobody is deleted while the money still says something about them**, which is
Splitwise's rule and the right one: deleting a participant takes their expenses with
them, so everyone else's share of a bill they were part of silently changes. If they are
owed twelve euros, that is a fact about other people's pockets, and it does not stop
being true because somebody tapped an X. Settle up first — a recorded cash payment is
enough — and then there is nothing to lose. Only the deletions are checked; stepping out
of a trip changes no figure at all.

The departed seat **stays linked to its account**, and that is the point. Unlinking it
would turn a person's column of money into a free name for the next stranger with an
invitation to claim, and would hand them a second, empty column if they were ever invited
back. Instead `inTrip` goes false, and inviting them again puts them where their money
already is.

**And the link they already have does not undo it.** An invitation is a shared link that
lives in whatever chat the group uses, so it is still in the pocket of the person who was
just shown the door — and for a while it worked: 404 on the trip, scroll up, tap the same
link, 200, and write access back. Redeeming an invitation now refuses anybody who has a
seat in that trip and no way into it, because that combination only arises one way. The
link stays live for everyone else; it is that person who is refused. The owner can still
let them back in deliberately by adding their address again, which returns them to the
seat their figures are already in.

### Saying so, instead of changing it

Every expense carries **who entered it**, shown on the row whenever that is not the
person who paid, and **comments**, open to everyone in the trip. The two exist together
on purpose: a permission model that only lets some people change a figure has to give
everyone else a way to say it looks wrong, or the app becomes one where people quietly
overwrite each other — which is the complaint Splitwise collects daily for having no
permissions at all.

The **activity feed** is the other half. The model promises that each person answers for
what they entered and the owner may change anything; neither half means much while it
leaves no trace, and the owner's power to rewrite anybody's figures is exactly the thing
that should not be silent. Names are copied into each entry as text rather than read back
through the account, so a line stays legible after the person has left the trip, renamed
themselves or deleted their account.

Setting your own alias is deliberately not recorded: it is nobody else's business and
would fill the feed on the first day of any trip.

### Light and dark

Both, from one set of values. Every token is a `light-dark()` pair, so switching theme
flips `color-scheme` on `<html>` and the whole palette moves — no second block of
twenty-five variables to keep in step. The choice is a cookie read on the server, like
the language, so the first paint is already right rather than flashing the wrong one.

The light emerald is deeper than it looks like it should be. `--primary` fills buttons
*and* is used as text — links, the selected chip, a positive balance — and a vivid
emerald that passes as a fill fails as text on white, measured at 2.8:1. Every colour
pair in both themes now clears 4.5:1, checked by driving a browser and reading the
rendered pixels rather than the tokens.

### Groups, not only trips

A group has a **kind**: trip, home, couple or other. It changes no rule and no
arithmetic — an icon and a word — but calling everything a "trip" made half the real use
of this read as a mistake, since a flat share is not a holiday that never ends.

### Notifications

Sent by this server and nobody else, and this is the part worth knowing before turning
it on: **no third-party service, no account, no cost**. Web Push works by the browser
handing out a URL on its vendor's push service — Google's for Chrome, Mozilla's for
Firefox, Apple's for Safari — and this server POSTing an encrypted payload to it, signed
with a VAPID key pair it generates itself on first use and keeps in `app_settings`. There
is no Firebase project to register. The payload is encrypted to the browser's own key, so
the push service forwards bytes it cannot read.

Two real limits. It needs HTTPS, which this instance has. And on iOS it only works for a
PWA added to the Home Screen — Safari refuses it for a page in a tab.

Sent on: an expense added, a payment recorded, a comment written, being put in a group.
Never to whoever just did it, which is the fastest way to get somebody to turn them off.
The server sends the *pieces* and the service worker builds the sentence, because it has
no idea what language that browser reads and the browser does.

### Invitations

Sharing an owned trip with someone who has no account used to be impossible: the share
link returned 404 to them, and registration is closed by default, so there was no way
in at all — a friend scanning the QR of an owned trip simply hit a dead end.

The share dialog now offers an invitation link for owned trips, and the QR encodes that
instead of the raw URL. Opening it names the trip and lets the visitor sign in or
register; either way they land inside. **A valid invitation is itself permission to
register**, which is what makes this work on a closed instance.

Invitations last 7 days and are not single-use — a trip link gets forwarded around a
group, and a one-shot invite would work for whoever tapped first and leave everyone
else with an error they could not explain. Only the owner can create them.

That makes the link exactly as private as the conversation it is sent through, which is
the usual bargain for a group link and worth saying plainly: for those seven days, anyone
it is forwarded to can join. The one thing it cannot do is readmit somebody who was taken
out — see [Taking somebody out](#taking-somebody-out).

They no longer carry a role, because there is none to carry: whoever opens one joins the
trip. A QR code looks identical whether it hands over the trip or not, and the version
that only granted access was the one that left people running a trip they appeared
nowhere in.

An invitation made by adding somebody by email carries the member it was made for, so
accepting it seats that person. A plain invitation carries no member, and whoever
accepts is asked which participant they are.

### Registration

`TABUP_REGISTRATION` takes three values:

| Value | Who gets in |
| --- | --- |
| `closed` *(default)* | Invitation links only |
| `approval` | Anyone may ask; the admin lets them in |
| `open` | Anyone, immediately |

The very first account is always allowed regardless — otherwise a fresh install could
never be set up — and it becomes the **admin**, who is the only one who can see or act
on account requests.

A pending account is a real account with `approved_at` still null, rather than a row in
a separate requests table: it already has a hashed password and a claimed email address,
and a second half-user shape would mean getting password handling right in two places.
Signing in before approval returns 403 with `pending_approval`, told apart from a wrong
password on purpose — somebody waiting needs to know that is what is happening.

An invitation counts as an approval: the person who owns the trip is vouching for them.

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

No test framework. Most run against a live server:

```bash
TABUP_DB=/tmp/test.db PORT=3999 TABUP_REGISTRATION=open npm run start &
export BASE=http://127.0.0.1:3999

npm run test:api        # 25 — splitting, balances, validation, concurrency, page structure
npm run test:auth       # 83 — accounts, ownership, who may change what, invitations
npm run test:money      # 40 — currencies, rates, whole cents, settling, CSV
npm run test:members    # 55 — members and accounts, and isolation between trips
npm run test:social     # 58 — balances, authorship, comments, the feed, kinds, push
npm run test:races      # 18 — two people doing the same thing at the same instant
npm run test:account    # 24 — closing an account, and what it does to everyone else
npm run test:recurring  # 17 — fixed costs; pure functions, no server needed
```

`test:admin` needs its own empty database and `TABUP_REGISTRATION=approval`, because
what it tests starts with "whoever registers first is the admin":

```bash
rm -f data/test.db* && TABUP_DB=data/test.db TABUP_REGISTRATION=approval npm run start &
npm run test:admin      # 36 — approvals, passwords, recovery links, the error log
```

`test:receipts` stands up a fake Ollama on port 11500 and needs the app pointed at it,
because what it mainly checks is *what leaves the machine*:

```bash
TABUP_OLLAMA_URL=http://127.0.0.1:11500 npm run start &
npm run test:receipts   # 29 — photos, what is sent to the model, what it may say back
```

`test:restart` starts and stops its own server, so it takes no arguments and shares
nothing:

```bash
npm run test:restart    # 6 — what a restart must not change
```

It exists because every other suite talks to one long-lived server, and so none of them
can see a bug that only happens at boot — which is where the repairs live, and repairs
are the most dangerous code in the app: they rewrite everybody's data with nobody
watching. The one it was written for readmitted every person an owner had taken out of a
trip, on every single start.

Point them at a scratch database, as above, so they never touch the real one. Each suite
creates several accounts, and the registration limiter is per IP: run two of them back
to back against the same server and the second will start getting 429s. That is the
limiter working — restart against a fresh database.

What is worth knowing about each: `test:api` carries the concurrency regression above.
`test:auth` covers the isolation boundary from outside — a stranger who knows a trip's
id gets 404 on read, write, export and delete. `test:members` covers it from *inside*:
someone with legitimate write access on one trip pointing those calls at another trip's
ids.

---

## Languages

Spanish and English, chosen from the header. The choice lives in a cookie; without one
the browser's `Accept-Language` decides, falling back to Spanish.

Deliberately **not** the sub-path routing Next's own guide recommends (`/es/trip/abc`).
People have trip links saved and pasted into group chats, and prefixing every route
would break every one of them — for a two-language app that is a bad trade.

**Refusals from the server are codes, not sentences.** They used to be English prose
written in a route file and shown verbatim — so a Spanish app answered "Only whoever added
it, or the trip owner, can change that", in the middle of a screen with no other English
on it, at the one moment somebody is already annoyed that a thing did not work. Now a
refusal carries `code`, the client turns it into a sentence from the message tree, and the
English text travels beside it as the developer-facing half: it is what curl shows, what
the error log records and what a test asserts on. A code this build has never heard of
reads as "something went wrong" rather than as the code itself.

Spanish is the source of truth in `src/i18n/messages.ts` and its shape defines the
type, so a key missing from English is a compile error rather than an untranslated
string appearing in front of someone. Plurals go through `Intl.PluralRules` (`key_one`
/ `key_other`), because "1 gastos" is exactly the kind of detail that makes an app feel
unfinished.

## Offline and installing

The app is a PWA: installable from the browser, and a trip stays readable with no
connection — on a plane, on a mountain, or on roaming you would rather not pay for.

The service worker splits its rules deliberately:

- **Static assets** — cache first. They only change when a new build ships.
- **Pages** — network first. What a page contains depends on who is asking, so a shared
  cached copy would show one person another's view. The cache is the offline fallback.
- **API reads** — network first, cache only as a fallback. Balances are the reason this
  app exists, and showing a stale figure as if it were current would be worse than
  showing nothing, so a cached response is flagged and the page says the numbers are
  from the last time it had signal.

**The cache is emptied whenever the session changes** — signing out, and signing in too.
It belongs to the browser rather than to the account, and nothing used to clear it: one
person's trips stayed on disk after they signed out, and the next account on that device
would be handed them the moment the network failed, labelled as offline data, which says
nothing about *whose* it is. A phone gets passed around; that is the whole scenario.

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

**A queued write belongs to an account, not to the browser.** IndexedDB is per device and
a phone gets handed over. Without an owner on each write, one person's expense was
replayed under whoever signed in next: the server answered 404 for a trip they had no
access to, 404 is not retryable, and the write — the one thing in this app that exists
nowhere else — was deleted. Each write now carries the account that made it, only that
account's writes are ever sent, and the rest sit untouched until their owner comes back to
that device. Covered end to end by a browser walk that blocks the write endpoint, hands
the phone over, and checks the expense is still there afterwards.

**Editing and deleting do not queue**, deliberately. They need the server's current
state to mean anything: editing an expense someone else already changed, or deleting one
they already deleted, are conflicts with no good silent answer. Offline they fail and
say so.

Icons are generated from one vector definition:

```bash
node scripts/generate-icons.mjs
```

## Reports and sharing

- **CSV** — the whole trip, not just the expense list: each person's share as its own
  column, the payments, the closing balances and who pays whom. Exporting only the
  expenses looks complete until you try to reconstruct the accounts from it. Written
  with a BOM so Excel opens the accents correctly.
- **Printable report** at `/trip/<id>/print` — every browser turns that into a PDF, on
  desktop and on a phone, and does a better job of typography and page breaks than
  hand-positioned text in a PDF library would. No dependency.
- **Summary image** from the share dialog: total, who owes whom and the balances, drawn
  on a canvas and handed to the share sheet. At the end of a trip somebody sends this to
  the group, and until now that meant a badly cropped screenshot.

## Receipts

Photograph a receipt and a vision model fills the form in: merchant, total, currency,
date and category. Measured on four receipts — a clean render, a phone photo, a badly
degraded one, and a Filipino receipt in pesos where the total is *not* the largest
number on the page — `qwen3.5:397b-cloud` got all four right in 7–15s. `gemma4:31b-cloud`
also got all four but took 11–67s; `gemma4:e2b` running locally was correct at ~105s,
which is too slow to use at a table. Set `TABUP_OCR_MODEL` to change it.

The reading is a shortcut, never a gate: if the model is slow, missing or unsure, the
photo is still attached and the fields are typed by hand.

**The photo leaves the machine when the model is a cloud one, which the default is.** A
397-billion-parameter model at BF16 is some 800 GB of weights; it does not run on a mini
PC, and Ollama forwards the image to run it. That is a fair trade for OCR that works at a
table on modest hardware, but it is a fact about somebody's receipt and belongs in writing
rather than in an inference from a model name. Point `TABUP_OCR_MODEL` at a local vision
model to keep photos here, at the cost of speed.

Photos are re-encoded with sharp on upload. That is not about file size — a phone photo
carries EXIF, and EXIF carries **GPS coordinates**, so storing the original would mean
every receipt quietly records where its owner was standing, and a shared trip would hand
that to everyone with the link. Re-encoding drops it.

**The model is given the re-encoded copy, never the upload.** It used to be handed the
original: the stripped version was the one kept on disk and the one with the GPS in it was
the one sent away, which is precisely backwards. `test:receipts` stands up a fake Ollama,
uploads a photo with a marker in its EXIF, and fails if that marker reaches the model.

They live on disk under `data/receipts/<tripId>/`, never in the database, and travel in
the nightly backup as their own archive. Deleting an expense deletes its photo; anything
orphaned by an abandoned form is swept up six hours later by the app itself.

That sweep used to be the *backup script's* job and nobody else's, which is a strange
thing to depend on: a backup is what you run to copy the data, not the reason the data
stops growing. It now runs at startup and every six hours, along with the rows that expire
— sessions, invitations, spent recovery links. Those were already cleared, but only by the
boot migration, whose own comment gave the reason: "there is no other moment that reliably
runs". A server that stays up for a month therefore kept a month of dead rows. This is
that other moment.

## Budget and pace

An optional budget per trip, plus the daily average and a bar per day. The total on its
own never answered the question people actually ask halfway through a trip — "are we
going over?" — because a number means nothing without a rate to compare it to.

## Closing an account

From the account menu, with the password typed again — a session is whoever is holding the
phone, and an unlocked phone on a table should not be enough to delete somebody's spending
for good.

The dialog says what will happen before it asks for anything, because the consequences
reach other people's screens and none of them are guessable:

- **Groups they run** go to whoever else has been in them longest. Leaving `owner_id` null
  would strand a group everyone else still uses with nobody able to invite, rename or
  remove anyone.
- **Groups nobody else is in** are deleted with them. There is nobody to hand those to.
- **Their column in other people's groups stays**, with its name on it. Their half of the
  taxi happened, and it does not stop having happened because they left. It is marked as
  belonging to an account that is gone, so the group never offers it to the next person
  through the door — a free name is claimable, and that column is not free, it is nobody's.

Everything else the schema already described: sessions, push subscriptions, fixed costs
and access grants cascade away, while authorship on expenses, payments, comments and the
activity feed goes null — what they wrote stays and the name on it stops pointing anywhere.

Deliberately **not** refused over a balance. Being owed twelve euros is a good reason to
warn somebody and a bad reason to tell them they may not leave.

## Accessibility

Audited in a real browser rather than by reading, which is the only way to find out that a
focus ring is missing or that focus lands on `<body>`. What it turned up:

- **No `main` anywhere in the app.** Every page had a header and content and nothing
  saying which was which, so anything navigating by landmark — how a screen reader skims —
  had nothing to jump to.
- **Two pages with no heading at all**: the sign-in page, whose title was a styled
  paragraph, and the fixed-costs page, which has no visible title by design and now carries
  a screen-reader one.
- **The bottom bar on phones had no visible focus.** `outline-none` with a background tint
  behind it, the same treatment as hover, on muted text — tabbing to the navigation looked
  like tabbing to nothing.
- **Closing a dialog dropped focus on `<body>`.** Base UI returns focus to whatever opened
  a dialog, but only when that is a `Dialog.Trigger`, and these are opened from state by a
  button somewhere else. Open "Añadir gasto" from the keyboard, press Escape, and you were
  at the top of the document with the whole page to tab through again.

What was already right, and worth knowing: the focus trap holds and the page behind a
dialog is properly inert, every icon-only control has a label, no image is missing alt
text, toasts are announced through a polite live region, `lang` matches the chosen
language, and there is a `prefers-reduced-motion` block.

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

**Getting back into an account** has no email behind it, so it has no self-service
"forgot my password" either: you ask whoever runs the instance, and they generate a
**recovery link** from the admin panel and send it over whatever you already talk on.

The link is the credential for that one act, which is why its shape matters — it travels
through a chat and stays in it. So it expires in an hour, works exactly once, retires any
earlier link for the same account, and the moment it is spent every session of that
account is closed and whatever is left in the conversation is worthless. Only its hash is
stored, like sessions.

It replaces the admin typing a password and dictating it, which never expires, is
readable by anyone who scrolls back, and is a password the person did not choose. That
path still exists in the panel, and `scripts/reset-password.mjs` still works from the
machine itself, but both are now the fallback rather than the procedure.

## Security notes

- **Passwords**: scrypt, N=16384, per-password salt. Cost parameters are stored in the
  hash, so raising them later does not lock out existing accounts.
- **Sessions**: the database holds a SHA-256 of the cookie token, never the token. A
  leaked database copy cannot be replayed as a login. Cookie is `httpOnly`,
  `sameSite=lax`, and `secure` in production.
- **Login throttling**: per IP and per account, 10 attempts per 15 minutes. In-process,
  so it assumes a single instance — running more than one means moving it to the
  database. A successful sign-in clears both counters: the IP is taken from
  `X-Forwarded-For` or `X-Real-IP`, and behind a proxy that sets neither, *every* caller
  shares one counter — so without that clearing, ten correct sign-ins in a quarter of an
  hour would lock out the people using it properly.
- **Ids in request bodies** are checked against the trip in the URL, so write access to
  one trip cannot be pointed at another trip's rows. See [Access model](#access-model).
- **Email addresses**: only the owner is sent them, and only for the seats that have an
  account behind them. They typed those addresses in order to invite people; putting
  somebody in a trip is not the same as handing everyone else in it their address.
- **Enumeration**: a trip you cannot see returns 404, not 403. Failed logins do not say
  which half was wrong, and a login attempt against a non-existent account still runs a
  hash so the response time does not give it away.
- **CSV export**: fields starting with `=`, `+`, `-` or `@` are prefixed, so a crafted
  expense description cannot become a formula in Excel.
- **Single-use links really are**: a password reset is spent by the same statement that
  checks it is unspent (`WHERE used_at IS NULL`). Checking first and writing after left a
  hundred-millisecond gap — hashing a password is slow on purpose — and two redemptions
  arriving together both won it, the later one taking the earlier one's new session with
  it. Same shape as the invitation rule above: the guard belongs where the write is.
- **Endpoints in a body are claims**: turning notifications off is scoped to the account
  making the request. Unscoped, anybody who learned another browser's push endpoint could
  silently stop its notifications.
- **The admin panel is a door**: `/admin` is refused on the server, not merely emptied by
  the API. It used to load for anybody — headings, an empty list, a password dialog — with
  the data missing for reasons the page could not explain. 404, like a trip you cannot
  see: whether this instance has a panel at a guessable path is not worth confirming.
- **A reset link is a way back in, not a way past the queue**: redeeming one sets the
  password whatever the account's state, but only signs somebody in if they have been
  approved.
- **Response headers**: a content policy, `frame-ancestors 'none'` and `X-Frame-Options`
  against clickjacking, `nosniff`, and a referrer policy — invitations carry a token in
  the path, and a referrer carries the whole path. The policy is not nonce-based: that
  needs a proxy and makes every page dynamic. What is there still means an injected script
  cannot load code from another host or post anybody's expenses to one.

Not covered: there is no email verification and no CSRF token beyond `sameSite=lax`.
Losing a password is handled by the admin issuing a link, which is the section above —
there is no self-service reset, because there is no email to send it to.

---

## Migrating from the JSON version

```bash
node scripts/migrate-json.mjs [source-directory]   # defaults to .splittrip-data
```

Idempotent, and the JSON files are never modified or deleted. Trips whose id already
exists in the database are skipped. Imported trips arrive without an owner; the first
account to exist adopts them on the next start (`adoptOrphanTrips`), and their members
are bare names until somebody claims them.

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

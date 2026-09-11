# Security policy

TabUp holds who paid what on a trip, and who owes whom at the end. That is money
arithmetic plus a guest list: the interesting failures are not crashes, they are
one account reading or rewriting another table's numbers.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/Ulzuhan/tabup/security/advisories/new)
on this repository. That channel stays private until we publish it together.

Please do not open a public issue for anything exploitable.

**What to expect:** an acknowledgement within 72 hours, an assessment within
7 days, and a fix or a written explanation of why there is not going to be one.
You will be credited in the advisory unless you would rather not be. There is no
bounty.

## Where the detail lives

The full Internet-facing threat model, the findings and the verification evidence
are in [the security and infrastructure audit](docs/SECURITY-AUDIT.md), and the
short version — password hashing, session storage, login throttling, enumeration,
CSV formulas, single-use links, the admin door — is in the
[security notes](README.md#security-notes) of the README. This file is the
policy, not a second copy of them.

## What it is, in security terms

- **Two ways in, chosen by configuration.** By default accounts are TabUp's own,
  with scrypt-hashed passwords. Set the OIDC variables and `/login` stops
  rendering a form altogether: the local password paths are never reached.
- **A member is not an account.** Most people at a real table never register;
  they are a name in the arithmetic. Who may *open* a trip and who appears *in*
  it are deliberately different things.
- **The database stores a SHA-256 of the session token**, never the token, so a
  leaked copy cannot be replayed as a login.
- **Ids in a request body are claims, not authority.** They are checked against
  the trip in the URL, so write access to one trip cannot be aimed at another.
- **A trip you cannot see returns 404**, not 403 — including `/admin`.

## In scope

- Reading or writing a trip, group, expense, settlement or receipt that belongs
  to somebody else.
- Turning a member into an account, or an account into an owner, without an invitation.
- Redeeming a reset or invitation link twice, or past its state.
- Learning another person's e-mail address through the interface or an export.
- Session forgery, replay from a database copy, or a revoked session that still opens.
- Formula injection in an export, and injection through a description, a member
  name or a currency that reaches the page, the database or a report.
- Anything that scopes an action to the wrong account — push endpoints included.

## Out of scope

- Scanner output with no working exploit, or missing headers with no shown impact.
- Volumetric denial of service. A way *around* a documented limit is in scope;
  sending more traffic than a host can take is not.
- Misconfiguration of your own deployment, unless an unsafe default here causes it.
- Disagreeing with the split. Arithmetic bugs are welcome as issues, not as advisories.

## What it does not claim

Login throttling is in-process, which assumes a single instance; running more
than one means moving it to the database, and the audit says so. Behind a proxy
that sets neither `X-Forwarded-For` nor `X-Real-IP`, every caller shares one
counter. The receipts feature is off unless you name a model, and that default
changed on 2026-08-29 for a reason worth repeating: it used to be a cloud model,
so a fresh install forwarded somebody's receipt to a third party without anyone
asking for it. If you point it at a cloud model, photographs of receipts leave
your machine — that is your decision to make, not a default.

## Supply chain

Dependencies are pinned by `package-lock.json`; Renovate opens grouped updates
weekly and security updates immediately. Every GitHub Action is pinned by commit
SHA. The image is built with BuildKit provenance and an SBOM — metadata, not a
signature — and every published digest is scanned with Trivy for fixable
critical and high CVEs. A red run is not deployed.

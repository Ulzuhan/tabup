#!/usr/bin/env node
/**
 * Receipt photos: what is stored, what leaves, and what a model is allowed to say.
 *
 *   rm -f data/test.db* && TABUP_DB=data/test.db TABUP_REGISTRATION=open \
 *     TABUP_OLLAMA_URL=http://127.0.0.1:11500 npm run start &
 *   npm run test:receipts
 *
 * The suite stands up a fake Ollama on 11500 and keeps whatever image is posted to it.
 * That is the only way to check the thing that matters most here: **what leaves the
 * machine**. The default model is a cloud one — 397 billion parameters at BF16 is some
 * 800 GB of weights and does not run on a mini PC — so the bytes handed to Ollama are
 * bytes handed to somebody else, and they had better be the copy with the EXIF stripped
 * rather than the original off the phone with its GPS coordinates in it.
 *
 * The rest is the other half of the same idea: nothing a model says is believed. It is a
 * suggestion filling in a form a person is about to read.
 */
import http from "http";
import sharp from "sharp";

const BASE = process.env.BASE || `http://127.0.0.1:${process.env.PORT || 3000}`;
const FAKE_OLLAMA_PORT = Number(process.env.FAKE_OLLAMA_PORT || 11500);
/** Written into the upload's EXIF. If it comes out the other side, metadata leaked. */
const MARKER = "TABUP-EXIF-LEAK-MARKER";

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `  ${ok ? "✓" : "✗"} ${name}${ok ? "" : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`
  );
  if (ok) passed++;
  else failed++;
}

function client() {
  let cookie = "";
  return async (path, options = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(cookie ? { cookie } : {}),
        ...(options.headers || {}),
      },
    });
    const sc = res.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const type = res.headers.get("content-type") ?? "";
    return {
      status: res.status,
      body: type.includes("json") ? await res.json().catch(() => ({})) : null,
      bytes: type.includes("image") ? Buffer.from(await res.arrayBuffer()) : null,
    };
  };
}

const uniq = () => Math.random().toString(36).slice(2, 10);

/** What the fake model was last handed, and what it should answer next. */
const seen = { image: null, calls: 0 };
let reply = { response: '{"merchant":"Bar Pepe","total":12.5,"currency":"EUR","category":"food"}' };
let delayMs = 0;

const ollama = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    seen.calls++;
    try {
      const parsed = JSON.parse(body);
      seen.image = Buffer.from(parsed.images?.[0] ?? "", "base64");
    } catch {
      seen.image = null;
    }
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply));
  });
});

async function main() {
  await new Promise((resolve) => ollama.listen(FAKE_OLLAMA_PORT, "127.0.0.1", resolve));

  const api = client();
  await api("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `photo-${uniq()}@example.com`,
      name: "Ana",
      password: "a long enough password",
    }),
  });
  const trip = (
    await api("/api/trips", {
      method: "POST",
      body: JSON.stringify({ name: "Fotos", currency: "EUR", members: [] }),
    })
  ).body;

  const upload = async (buffer, filename = "ticket.jpg", query = "") => {
    const form = new FormData();
    form.append("photo", new Blob([buffer], { type: "image/jpeg" }), filename);
    return api(`/api/trips/${trip.id}/receipt${query}`, { method: "POST", body: form });
  };

  const crossOriginForm = new FormData();
  crossOriginForm.append("photo", new Blob([Buffer.from("not important")]), "ticket.jpg");
  check(
    "a sibling origin cannot force an upload",
    (await api(`/api/trips/${trip.id}/receipt`, {
      method: "POST",
      body: crossOriginForm,
      headers: { Origin: "https://evil.example.com", "Sec-Fetch-Site": "same-site" },
    })).status,
    403
  );

  // A real JPEG carrying metadata, the way a phone photo does.
  const withExif = await sharp({
    create: { width: 900, height: 1200, channels: 3, background: "#ffffff" },
  })
    .withMetadata({ exif: { IFD0: { Copyright: MARKER, Artist: MARKER } } })
    .jpeg()
    .toBuffer();

  check("the fixture really carries the marker", withExif.includes(MARKER), true);

  // ── What leaves the machine ─────────────────────────────────────────
  console.log("\nWhat is sent to the model");
  const scanned = await upload(withExif);
  check("the upload is accepted", scanned.status, 200);
  check("and a photo is stored", typeof scanned.body.receipt, "string");
  check("the model was called", seen.calls > 0, true);
  check("it was given an image", Boolean(seen.image?.length), true);
  // The whole point. The original is what the phone produced; the model must get the
  // re-encoded copy, which sharp writes without metadata.
  check("with no EXIF from the original", seen.image.includes(MARKER), false);
  check("and smaller than the original", seen.image.length < withExif.length, true);

  const stored = await api(
    `/api/trips/${trip.id}/receipt?file=${encodeURIComponent(scanned.body.receipt)}`
  );
  check("the stored copy comes back", stored.status, 200);
  check("and it has no EXIF either", stored.bytes.includes(MARKER), false);

  // ── Nothing a model says is believed ────────────────────────────────
  console.log("\nWhat the model is allowed to say");
  reply = {
    response: JSON.stringify({
      merchant: "x".repeat(500),
      total: 1e12,
      currency: "XYZ",
      date: "1899-01-01",
      category: "'; DROP TABLE expenses; --",
    }),
  };
  const hostile = await upload(withExif);
  check("a merchant name is cut to a sane length", hostile.body.fields.merchant.length, 100);
  check("an absurd total is dropped", hostile.body.fields.total, undefined);
  check("a currency this app cannot convert is dropped", hostile.body.fields.currency, undefined);
  check("a date from the wrong century is dropped", hostile.body.fields.date, undefined);
  check("a category that is not one is dropped", hostile.body.fields.category, undefined);

  reply = { response: "Sure! Here is the receipt:\n```json\n{\"total\": 9.99}\n```" };
  const chatty = await upload(withExif);
  check("a model that will not stop talking is still read", chatty.body.fields.total, 9.99);

  reply = { response: "I could not read that, sorry." };
  const useless = await upload(withExif);
  check("prose with no JSON gives nothing", useless.body.fields, null);
  check("and the photo is stored regardless", typeof useless.body.receipt, "string");

  // ── When the model is slow, broken or absent ────────────────────────
  console.log("\nWhen the model does not answer");
  reply = { error: "model not found" };
  const broken = await upload(withExif);
  check("an error from Ollama does not fail the upload", broken.status, 200);
  check("the photo is still stored", typeof broken.body.receipt, "string");
  check("and the form is left alone", broken.body.fields, null);

  reply = { response: '{"total":5}' };
  const skipped = await upload(withExif, "ticket.jpg", "?scan=false");
  const before = seen.calls;
  check("asking not to scan stores without reading", typeof skipped.body.receipt, "string");
  check("and does not call the model again", seen.calls, before);

  // ── What is not an image ────────────────────────────────────────────
  console.log("\nWhat is not a photo");
  check(
    "an HTML file named .jpg is refused",
    (await upload(Buffer.from("<script>alert(1)</script>"), "evil.jpg")).status,
    400
  );
  check(
    "an empty upload is refused",
    (await upload(Buffer.alloc(0))).status,
    400
  );
  const huge = Buffer.alloc(13 * 1024 * 1024, 1);
  check("something over the size limit is refused", (await upload(huge)).status, 413);

  // ── Who may see a photo ─────────────────────────────────────────────
  console.log("\nWho may look at it");
  const stranger = client();
  await stranger("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: `nadie-${uniq()}@example.com`,
      name: "Nadie",
      password: "a long enough password",
    }),
  });
  check(
    "a stranger cannot read a photo from a trip they are not in",
    (
      await stranger(
        `/api/trips/${trip.id}/receipt?file=${encodeURIComponent(scanned.body.receipt)}`
      )
    ).status,
    404
  );
  for (const attempt of ["../../../etc/passwd", "..%2f..%2fsecret.jpg", "not-a-filename"]) {
    check(
      `a crafted filename gets nothing: ${attempt.slice(0, 24)}`,
      (await api(`/api/trips/${trip.id}/receipt?file=${encodeURIComponent(attempt)}`)).status,
      404
    );
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  ollama.close();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("The test itself broke:", error);
  ollama.close();
  process.exit(1);
});

import { randomBytes } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";
import sharp from "sharp";
import { logError } from "./errors";

/**
 * Receipt photos and reading them.
 *
 * Photos live on disk under data/receipts/<tripId>/, never in the database: SQLite
 * would carry them into every backup and every read of the file, and the backup is
 * meant to stay small enough to run nightly without thinking about it.
 */

const DATA_DIR = process.env.TABUP_DATA_DIR?.trim() || join(process.cwd(), "data");
const RECEIPTS_DIR = join(DATA_DIR, "receipts");

/** Bigger than any phone photo needs to be for this, small enough to bound abuse. */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

const OLLAMA = process.env.TABUP_OLLAMA_URL?.trim() || "http://127.0.0.1:11434";
const OCR_MODEL = process.env.TABUP_OCR_MODEL?.trim() || "qwen3.5:397b-cloud";
/** Measured 7–15s on real photos; this is the ceiling before giving up. */
const OCR_TIMEOUT_MS = Number(process.env.TABUP_OCR_TIMEOUT || 60_000);

/**
 * Where a receipt lives, with the id checked rather than trusted.
 *
 * Both parts come from a URL, so a crafted id like `../../etc` must not be able to
 * escape the receipts directory — the resolved path is compared against it.
 */
function receiptPath(tripId: string, filename: string): string | null {
  if (!/^[0-9a-f]{8,32}$/.test(tripId)) return null;
  if (!/^[0-9a-f]{8,40}\.(jpe?g|png|webp)$/i.test(filename)) return null;

  const path = resolve(join(RECEIPTS_DIR, tripId, filename));
  return path.startsWith(resolve(RECEIPTS_DIR)) ? path : null;
}

export async function readReceipt(tripId: string, filename: string): Promise<Buffer | null> {
  const path = receiptPath(tripId, filename);
  if (!path || !existsSync(path)) return null;
  return readFile(path);
}

export async function deleteReceipt(tripId: string, filename: string): Promise<void> {
  const path = receiptPath(tripId, filename);
  if (path && existsSync(path)) await unlink(path).catch(() => {});
}

/**
 * Stores an uploaded photo, re-encoded.
 *
 * Re-encoding is not about size. A phone photo carries EXIF, and EXIF carries GPS
 * coordinates — storing the original would mean every receipt quietly records where its
 * owner was standing, and a shared trip would hand that to everyone with the link.
 * sharp drops metadata unless asked to keep it, and rotating by EXIF first means the
 * image still comes out the right way up.
 */
export async function storeReceipt(
  tripId: string,
  input: Buffer
): Promise<{ filename: string; bytes: number } | null> {
  if (!/^[0-9a-f]{8,32}$/.test(tripId)) return null;

  const dir = join(RECEIPTS_DIR, tripId);
  await mkdir(dir, { recursive: true });

  const filename = `${randomBytes(16).toString("hex")}.jpg`;

  try {
    const output = await sharp(input)
      .rotate()
      // 1600px keeps small print legible for the model while a photo stays a few
      // hundred KB rather than several MB.
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();

    await writeFile(join(dir, filename), output);
    return { filename, bytes: output.length };
  } catch {
    // Anything sharp cannot decode is not an image, whatever the request claimed.
    return null;
  }
}

export interface ReceiptReading {
  merchant?: string;
  total?: number;
  currency?: string;
  date?: string;
  category?: string;
}

const PROMPT = `Extract this receipt as strict JSON and nothing else. No prose, no markdown fence.
{"merchant":string,"total":number,"currency":"EUR"|"USD"|"GBP"|"PHP"|"THB"|"JPY"|"MXN"|"BRL"|...,"date":"YYYY-MM-DD","category":"food"|"transport"|"accommodation"|"activity"|"shopping"|"health"|"other"}
total is the final amount actually due — not the subtotal, and not the cash tendered.
If a field is unreadable, omit it. Never invent a value.`;

/**
 * Reads a receipt with a vision model through Ollama.
 *
 * Returns null rather than throwing on any failure: OCR is a convenience on top of a
 * form the user can always fill in themselves, so a model being slow, missing or
 * talkative must never stop an expense from being added.
 */
export async function readReceiptFields(image: Buffer): Promise<ReceiptReading | null> {
  try {
    const res = await fetch(`${OLLAMA}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OCR_MODEL,
        prompt: PROMPT,
        images: [image.toString("base64")],
        stream: false,
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
    });

    if (!res.ok) {
      // Recorded rather than swallowed: the whole point of the log is that a model that
      // has stopped answering should be visible without anyone stumbling into it.
      logError("receipt OCR", new Error(`Ollama replied ${res.status} for model ${OCR_MODEL}`));
      return null;
    }
    const data = await res.json();
    if (data.error || typeof data.response !== "string") {
      logError("receipt OCR", new Error(String(data.error ?? "Model returned no text")));
      return null;
    }

    // Models wrap JSON in a fence often enough that stripping it is cheaper than
    // fighting about it in the prompt.
    const text = data.response.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;

    const parsed = JSON.parse(text.slice(start, end + 1));
    return sanitise(parsed);
  } catch (error) {
    logError("receipt OCR", error);
    return null;
  }
}

/** Nothing from a model reaches the form without being checked first. */
function sanitise(raw: Record<string, unknown>): ReceiptReading {
  const out: ReceiptReading = {};

  if (typeof raw.merchant === "string" && raw.merchant.trim()) {
    out.merchant = raw.merchant.trim().slice(0, 100);
  }

  const total = typeof raw.total === "number" ? raw.total : parseFloat(String(raw.total));
  if (isFinite(total) && total > 0 && total < 1e9) out.total = Math.round(total * 100) / 100;

  if (typeof raw.currency === "string" && /^[A-Z]{3}$/.test(raw.currency.trim().toUpperCase())) {
    out.currency = raw.currency.trim().toUpperCase();
  }

  if (typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date.trim())) {
    const parsedDate = new Date(`${raw.date.trim()}T12:00:00`);
    // A model misreading a year is common; a date in 1970 or 2150 is not a date.
    const year = parsedDate.getFullYear();
    if (!isNaN(parsedDate.getTime()) && year > 2000 && year < 2100) out.date = raw.date.trim();
  }

  const categories = ["food", "transport", "accommodation", "activity", "shopping", "health", "other"];
  if (typeof raw.category === "string" && categories.includes(raw.category.trim().toLowerCase())) {
    out.category = raw.category.trim().toLowerCase();
  }

  return out;
}

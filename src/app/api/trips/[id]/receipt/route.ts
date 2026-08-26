import { NextRequest, NextResponse } from "next/server";
import { fail } from "@/lib/api-error";
import { authorizeTrip } from "@/lib/authorize";
import {
  MAX_UPLOAD_BYTES,
  readReceipt,
  readReceiptFields,
  storeReceipt,
} from "@/lib/receipts";

/**
 * Uploading a receipt photo, and reading it.
 *
 * The photo is stored and the extracted fields come back in the same response, so the
 * form can fill itself in one round trip. The expense does not exist yet at this point;
 * it carries the returned filename when it is created.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/trips/[id]/receipt">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "write");
  if (!auth.ok) return auth.response;

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    return fail("photo_too_large", 413);
  }

  let bytes: Buffer;
  try {
    const form = await request.formData();
    const file = form.get("photo");
    if (!(file instanceof File)) {
      return fail("not_an_image", 400);
    }
    // Checked again after reading: content-length is a claim, not a guarantee.
    if (file.size > MAX_UPLOAD_BYTES) {
      return fail("photo_too_large", 413);
    }
    bytes = Buffer.from(await file.arrayBuffer());
  } catch {
    return fail("not_an_image", 400);
  }

  // storeReceipt re-encodes with sharp, which both strips EXIF (a phone photo carries
  // GPS coordinates) and rejects anything that is not actually an image.
  const stored = await storeReceipt(id, bytes);
  if (!stored) {
    return fail("not_an_image", 400);
  }

  /**
   * The model gets the stripped copy, never the upload.
   *
   * This used to pass `bytes` — the original straight off the phone, EXIF and GPS
   * coordinates intact — while the sanitised version was the one kept on disk. Exactly
   * backwards: the copy that stayed here was clean and the copy that left carried where
   * the photo was taken. With the default model, "left" means left the machine.
   */
  const scan = request.nextUrl.searchParams.get("scan") !== "false";
  const fields = scan ? await readReceiptFields(stored.sanitised) : null;

  return NextResponse.json({
    receipt: stored.filename,
    bytes: stored.bytes,
    // null means the model was unavailable, too slow, or unsure — the form stays as it
    // was and the person types it themselves.
    fields,
  });
}

/** Serves a stored photo, gated by the same access rules as the trip. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/trips/[id]/receipt">) {
  const { id } = await ctx.params;
  const auth = await authorizeTrip(id, "read");
  if (!auth.ok) return auth.response;

  const filename = request.nextUrl.searchParams.get("file");
  if (!filename) {
    return fail("no_file", 400);
  }

  const image = await readReceipt(id, filename);
  if (!image) {
    return fail("not_found", 404);
  }

  return new NextResponse(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/jpeg",
      // Immutable because the filename is random and content never changes; private
      // because a shared cache must not hand someone else's receipt to a stranger.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}

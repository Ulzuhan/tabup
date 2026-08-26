import { NextResponse } from "next/server";

/**
 * Refusals a person can actually read.
 *
 * Every error out of an API route used to be an English sentence, and the client showed
 * it verbatim: a Spanish app answering "Only whoever added it, or the trip owner, can
 * change that". Fifteen or so of them, in the middle of a screen with no other English on
 * it — and they turn up at exactly the wrong moment, when somebody is already annoyed
 * that a thing did not work.
 *
 * Translating on the server would mean the server deciding what language somebody reads,
 * from a cookie, for a response that is often not read by a person at all. So the wire
 * carries a `code`, the client turns it into a sentence, and the English `error` stays as
 * the developer-facing detail — it is what curl shows, what the error log records and what
 * a test asserts on. Two audiences, two fields, neither pretending to be the other.
 *
 * `pending_approval` and `settle_first` already worked this way. This is the rest of them.
 */
export const ERROR_TEXT = {
  // Who you are
  signin_required: "Sign in first",
  wrong_credentials: "Wrong email or password",
  pending_approval: "This account is waiting to be approved",
  registration_closed: "This server is not accepting new accounts. Use an invitation link.",
  email_taken: "That email is already registered",
  invalid_email: "Enter a valid email address",
  name_length: "Name must be 1-80 characters",
  password_short: "Password must be at least 8 characters",
  password_long: "Password must be at most 200 characters",
  throttled: "Too many attempts, try again later",
  not_allowed: "Not allowed",

  // What you may touch
  not_found: "Not found",
  owner_only: "Only the trip owner can do that",
  author_only: "Only whoever added it, or the trip owner, can change that",
  name_not_yours: "Only they can change that name",

  // Members
  already_in_trip: "They are already in this trip",
  member_taken: "That person is already taken",
  duplicate_name: "That name is already taken in this trip",
  needs_owner: "A trip cannot be left without its owner",
  not_an_account: "Only somebody with an account, still in the trip, can be given it",
  settle_first: "Settle up before removing them",

  // Money
  amount_range: "Amount must be a positive finite number up to 1 billion",
  budget_range: "Budget must be a positive number up to 1 billion",
  invalid_date: "Invalid date",
  settle_self: "Cannot settle with yourself",
  rate_unavailable: "No exchange rate for that day",
  trip_limit: "This account has reached its limit of trips",
  name_required: "A name is required",
  member_name_length: "Each member name must be 1-50 characters",
  invalid_currency: "That currency is not one this app can convert",
  invalid_period: "That is not a period this app knows",

  // Photos
  photo_too_large: "That photo is too large",
  not_an_image: "That does not look like an image",

  // Cuando la petición viene mal formada
  bad_json: "The request body was not valid JSON",
  missing_field: "A required field is missing",
  invalid_member: "That is not a member of this trip",
  no_file: "No file was sent",
  bad_trip_id: "That trip ID is not valid",
  invite_expired: "This invitation is no longer valid",
  not_a_subscription: "That is not a push subscription",
  nothing_to_say: "Nothing to say, or no such expense",

  // When it is this end that broke
  save_failed: "Could not save that",
} as const;

export type ErrorCode = keyof typeof ERROR_TEXT;

/**
 * The one way to refuse a request.
 *
 * `extra` exists for the refusals that carry a fact the sentence needs — which people
 * still have a balance, which currency had no rate — because a message that says "settle
 * up first" without saying with whom sends somebody hunting.
 */
export function fail(
  code: ErrorCode,
  status: number,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ error: ERROR_TEXT[code], code, ...extra }, { status });
}

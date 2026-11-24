import { NextResponse } from "next/server";

function notFound() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const HEAD = notFound;

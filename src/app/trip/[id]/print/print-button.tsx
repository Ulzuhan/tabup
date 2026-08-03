"use client";

import { Printer } from "lucide-react";

/**
 * Opens the browser's print dialog, where "Save as PDF" lives on every platform.
 *
 * A client component purely so the report itself can stay server-rendered.
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-lg border border-[#d9dbe3] px-3 py-1.5 text-sm text-[#16171d] hover:bg-[#f4f5f8]"
    >
      <Printer className="size-4" />
      PDF
    </button>
  );
}

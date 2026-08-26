/** Wordmark. Kept in one place so the pages that show it cannot drift. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      Tab<span className="text-primary">Up</span>
    </span>
  );
}

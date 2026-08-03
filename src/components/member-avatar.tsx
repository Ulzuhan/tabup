import { cn } from "@/lib/utils";

/**
 * A trip member.
 *
 * Members already carry an emoji chosen at creation, and that stays — it is how people
 * tell each other apart at a glance and it is genuinely theirs. What changes is the
 * frame: a sized, centred well instead of a loose emoji in a text run, so rows keep a
 * consistent rhythm regardless of how wide a given emoji renders.
 */
export function MemberAvatar({
  emoji,
  name,
  size = "md",
  className,
}: {
  emoji?: string;
  name?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "size-6 text-[13px]",
    md: "size-8 text-[15px]",
    lg: "size-10 text-lg",
  };

  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full bg-secondary leading-none",
        sizes[size],
        className
      )}
      title={name}
      aria-hidden={!name}
      aria-label={name}
    >
      {emoji ?? name?.[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

/** Overlapping avatars for a member list that has to fit on one line. */
export function MemberStack({
  members,
  max = 5,
  /**
   * The ring fakes a gap between overlapping avatars, so it has to match whatever is
   * behind them — on the page background a card-coloured ring reads as dirt.
   */
  ringClass = "ring-background",
}: {
  members: { id: string; name: string; emoji: string }[];
  max?: number;
  ringClass?: string;
}) {
  const shown = members.slice(0, max);
  const rest = members.length - shown.length;

  return (
    <div className="flex items-center">
      <div className="flex -space-x-1">
        {shown.map((m) => (
          <MemberAvatar
            key={m.id}
            emoji={m.emoji}
            name={m.name}
            size="md"
            className={cn("ring-2", ringClass)}
          />
        ))}
      </div>
      {rest > 0 && <span className="ml-2 text-xs text-muted-foreground">+{rest}</span>}
    </div>
  );
}

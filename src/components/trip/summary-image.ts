/**
 * Renders the closing summary of a trip as an image.
 *
 * At the end of a trip somebody has to tell the group who owes what, and what actually
 * happens is a screenshot — cropped badly, showing whatever was on screen at the time.
 * A generated image says exactly the right thing at a size that reads on a phone, and
 * can go straight into the share sheet.
 *
 * Drawn on a canvas rather than rendered from DOM: no dependency, and it does not
 * depend on what the page happens to look like at that moment.
 */

interface SummaryInput {
  tripName: string;
  currency: string;
  total: number;
  expenseCount: number;
  balances: { name: string; emoji: string; balance: number }[];
  settlements: { fromName: string; toName: string; amount: number }[];
  locale: string;
  labels: {
    total: string;
    settlements: string;
    allSettled: string;
    expenses: string;
  };
}

const BG = "#141520";
const CARD = "#1e2030";
const TEXT = "#f2f2f5";
const MUTED = "#9a9db0";
const PRIMARY = "#3ddc97";
const DANGER = "#f2645a";

const SYMBOLS: Record<string, string> = {
  EUR: "€", USD: "$", GBP: "£", JPY: "¥", CHF: "CHF", MXN: "$", BRL: "R$",
};

export function renderSummary(input: SummaryInput): HTMLCanvasElement {
  const symbol = SYMBOLS[input.currency] ?? input.currency;
  const money = (n: number) =>
    `${symbol}${new Intl.NumberFormat(input.locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(n))}`;

  const W = 1080;
  const PAD = 72;
  const rowH = 76;

  // Height is computed before drawing so the canvas is exactly as tall as its content
  // and the image has no dead space at the bottom.
  const rows = input.settlements.length || 1;
  const H = 460 + rows * rowH + 120;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const font = (size: number, weight = "400") =>
    `${weight} ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Brand wash across the top, the same one the app has behind its header.
  const glow = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.7);
  glow.addColorStop(0, "rgba(61, 220, 151, 0.16)");
  glow.addColorStop(1, "rgba(61, 220, 151, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, 420);

  // ── Wordmark ──
  ctx.font = font(34, "600");
  ctx.fillStyle = TEXT;
  ctx.fillText("Tab", PAD, 90);
  ctx.fillStyle = PRIMARY;
  ctx.fillText("Up", PAD + ctx.measureText("Tab").width, 90);

  // ── Trip name ──
  ctx.fillStyle = TEXT;
  ctx.font = font(56, "600");
  const name =
    input.tripName.length > 26 ? `${input.tripName.slice(0, 25)}…` : input.tripName;
  ctx.fillText(name, PAD, 190);

  // ── Total ──
  ctx.fillStyle = MUTED;
  ctx.font = font(26);
  ctx.fillText(input.labels.total.toUpperCase(), PAD, 250);

  ctx.fillStyle = TEXT;
  ctx.font = font(84, "700");
  ctx.fillText(money(input.total), PAD, 340);

  ctx.fillStyle = MUTED;
  ctx.font = font(26);
  ctx.fillText(`${input.expenseCount} ${input.labels.expenses}`, PAD, 386);

  // ── Settlements ──
  ctx.fillStyle = MUTED;
  ctx.font = font(26, "500");
  ctx.fillText(input.labels.settlements.toUpperCase(), PAD, 452);

  let y = 480;

  if (input.settlements.length === 0) {
    roundedRect(ctx, PAD, y, W - PAD * 2, 64, 16, CARD);
    ctx.fillStyle = PRIMARY;
    ctx.font = font(30, "500");
    ctx.fillText(input.labels.allSettled, PAD + 28, y + 42);
  } else {
    for (const s of input.settlements) {
      roundedRect(ctx, PAD, y, W - PAD * 2, 64, 16, CARD);

      ctx.fillStyle = TEXT;
      ctx.font = font(30, "500");
      const from = clip(ctx, s.fromName, 260);
      ctx.fillText(from, PAD + 28, y + 42);

      const arrowX = PAD + 28 + ctx.measureText(from).width + 20;
      ctx.fillStyle = MUTED;
      ctx.font = font(30);
      ctx.fillText("→", arrowX, y + 42);

      ctx.fillStyle = TEXT;
      ctx.font = font(30, "500");
      ctx.fillText(clip(ctx, s.toName, 260), arrowX + 44, y + 42);

      ctx.fillStyle = PRIMARY;
      ctx.font = font(32, "600");
      const amount = money(s.amount);
      ctx.fillText(amount, W - PAD - 28 - ctx.measureText(amount).width, y + 42);

      y += rowH;
    }
  }

  // ── Balances strip ──
  y += 36;
  ctx.font = font(24);
  let x = PAD;
  for (const b of input.balances) {
    const settled = Math.abs(b.balance) < 0.01;
    const label = `${b.name} ${settled ? "0" : (b.balance > 0 ? "+" : "−") + money(b.balance)}`;
    const width = ctx.measureText(label).width + 36;

    // Wrap rather than run off the edge when a trip has many members.
    if (x + width > W - PAD) {
      x = PAD;
      y += 46;
    }

    roundedRect(ctx, x, y - 26, width, 40, 20, CARD);
    ctx.fillStyle = settled ? MUTED : b.balance > 0 ? PRIMARY : DANGER;
    ctx.fillText(label, x + 18, y);
    x += width + 12;
  }

  return canvas;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Truncates to fit a width, so one long name cannot push the amount off the image. */
function clip(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

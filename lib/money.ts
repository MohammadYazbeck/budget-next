export type MoneyInput =
  | string
  | number
  | bigint
  | { toString(): string }
  | null
  | undefined;

export function moneyToCents(value: MoneyInput): number {
  if (value === null || value === undefined) return 0;

  const raw = value.toString().replaceAll(",", "").trim();
  if (!raw) return 0;

  const sign = raw.startsWith("-") ? -1 : 1;
  const unsigned = raw.replace(/^[+-]/, "");
  const [wholePart = "0", fractionPart = ""] = unsigned.split(".");
  const whole = Number.parseInt(wholePart || "0", 10);
  const fractionDigits = fractionPart.padEnd(3, "0");
  const cents = Number.parseInt(fractionDigits.slice(0, 2), 10);
  const shouldRound = Number.parseInt(fractionDigits.slice(2, 3), 10) >= 5;

  if (!Number.isFinite(whole) || !Number.isFinite(cents)) return 0;

  return sign * (whole * 100 + cents + (shouldRound ? 1 : 0));
}

export function centsToDecimalString(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(Math.round(cents));
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");

  return `${sign}${whole}.${fraction}`;
}

export function formatMoney(value: MoneyInput): string {
  return formatCents(moneyToCents(value));
}

export function formatCents(cents: number): string {
  const amount = Number(centsToDecimalString(cents));

  return `$${amount.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}`;
}

export function sumCents(values: MoneyInput[]): number {
  return values.reduce<number>(
    (total, value) => total + moneyToCents(value),
    0,
  );
}

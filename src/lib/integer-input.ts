export function parseIntegerInput(value: string) {
  const normalized = value.normalize("NFKC").trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(normalized)) return NaN;
  const number = Number(normalized.replaceAll(",", ""));
  return Number.isInteger(number) &&
    number >= -2147483648 &&
    number <= 2147483647
    ? number
    : NaN;
}

export function formatIntegerInput(value: string, signed = false) {
  const normalized = value.normalize("NFKC").trim();
  const number = parseIntegerInput(normalized);
  // Preserve invalid input so validation can explain it; never turn 1.5 into 15.
  if (!Number.isFinite(number)) return normalized;
  const sign = signed && normalized.startsWith("+") ? "+" : "";
  return `${sign}${new Intl.NumberFormat("ja-JP").format(number)}`;
}

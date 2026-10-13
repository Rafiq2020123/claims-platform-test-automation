// Dollars in the UI, integer cents everywhere else.

export function formatCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}$${dollars}.${rest}`;
}

// "1,234.5" -> 123450. An optional leading $, optional thousands separators in the right places,
// up to two decimals. Anything else ("1,2", "1$2", "12.345") is null rather than a guess.
const DOLLARS = /^\$?(\d{1,3}(,\d{3})*|\d+)(\.\d{1,2})?$/;

export function parseDollars(text) {
  const trimmed = String(text).trim();
  if (!DOLLARS.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.replace(/[$,]/g, '').split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

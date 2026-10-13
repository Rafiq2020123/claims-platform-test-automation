// Dollars in the UI, integer cents everywhere else.

export function formatCents(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}$${dollars}.${rest}`;
}

// "1,234.5" -> 123450. Returns null for anything that isn't a plain dollar amount.
export function parseDollars(text) {
  const cleaned = String(text).trim().replace(/[$,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

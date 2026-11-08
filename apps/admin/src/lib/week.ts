/** The Monday of the week before the one containing `now`, in Bangkok — the usual week to pay. */
export function previousMonday(now: Date = new Date()): string {
  const bkk = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const day = bkk.getUTCDay(); // 0 Sun … 6 Sat
  const sinceMonday = (day + 6) % 7;
  const thisMonday = new Date(Date.UTC(bkk.getUTCFullYear(), bkk.getUTCMonth(), bkk.getUTCDate() - sinceMonday));
  return new Date(thisMonday.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

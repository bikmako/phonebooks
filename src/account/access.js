export const MAX_OFFLINE_MS = 12 * 60 * 60 * 1000;
export const WRITE_LEASE_MS = 25 * 1000;
export const canRead = status => ["trial", "active", "lifetime", "expired"].includes(status);
const canWrite = status => ["trial", "active", "lifetime"].includes(status);

// The server supplies the epoch and the end of the entitlement. Elapsed time
// can only advance, even if the wall clock moves backwards or the tab sleeps.
export function accessLease(account, clocks = { wall: Date.now, monotonic: () => performance.now() }, verificationElapsed = 0) {
  const wallStart = clocks.wall();
  const monotonicStart = clocks.monotonic();
  const epoch = Date.parse(account.serverNow);
  const expiry = account.expiresAt ? Date.parse(account.expiresAt) : Infinity;
  let elapsed = 0;
  return {
    account,
    state(connected) {
      elapsed = Math.max(elapsed, clocks.monotonic() - monotonicStart, clocks.wall() - wallStart);
      const age = verificationElapsed + elapsed;
      const remaining = expiry - epoch - age;
      const read = canRead(account.status) && age < MAX_OFFLINE_MS;
      return {
        read,
        write: read && connected && age < WRITE_LEASE_MS && canWrite(account.status) && remaining > 0,
        expired: account.status === "expired" || remaining <= 0,
        reminder: account.status === "active" && remaining > 0 && remaining <= 259200000
          ? (remaining <= 86400000 ? "Подписка заканчивается в течение суток." : "До конца подписки меньше трёх дней.") : "",
      };
    },
  };
}

/**
 * Whether this device has seen how to play. Kept on the device, so a guest without an account is
 * covered too; storage that throws (private window, blocked site data) counts as not seen.
 */
const KEY = 'closeup-howto-seen';

export function useHowTo() {
  const open = useState('howto-open', () => false);

  function seen(): boolean {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  }

  /** Opens it the first time only. */
  function offer(): void {
    if (!seen()) open.value = true;
  }

  function close(): void {
    open.value = false;
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // Shown again next time: harmless.
    }
  }

  return { open, offer, close, show: () => (open.value = true) };
}

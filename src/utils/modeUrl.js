export function crossModeUrl(value, origin) {
  try {
    const url = new URL(value);
    const loopback = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    // A different port on the same hostname still receives host cookies.
    if (url.hostname !== new URL(origin).hostname && !url.username && !url.password && (url.protocol === 'https:' || loopback)) {
      return url.href;
    }
  } catch {}
  return '';
}

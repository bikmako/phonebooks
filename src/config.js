// Replaced by Vite at build time. Node consumers default to the paid application.
export const IS_DEMO = typeof __PHONEBOOKS_DEMO__ !== 'undefined' && __PHONEBOOKS_DEMO__;
export const STORAGE_PREFIX = IS_DEMO ? 'phonebooks.demo.' : 'phonebooks.';
export const SERVICE_WORKER = IS_DEMO ? './sw-demo.js' : './sw.js';
export const DEMO_TRANSFER_ERROR = 'В ДЕМО перенос данных и резервные копии отключены';
export function requireDataTransfer() {
  if (IS_DEMO) throw new Error(DEMO_TRANSFER_ERROR);
}
export function sellerContact(value) {
  if (!value || /[\s\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) return url.href;
    if (url.protocol === 'mailto:' && /^[^@?]+@[^@?]+\.[^@?]+$/.test(url.pathname) && !url.search) return url.href;
    if (url.protocol === 'tel:' && /^\+?[\d()-]+$/.test(url.pathname)) return url.href;
  } catch { /* Unconfigured contact has a local explanation, never a fake link. */ }
  return null;
}
export const SELLER_CONTACT = sellerContact(typeof __PHONEBOOKS_SELLER_CONTACT__ === 'undefined' ? '' : __PHONEBOOKS_SELLER_CONTACT__);
export function assertDemoOrigin(origin) {
  // All repositories on bikmako.github.io share the paid app's origin.
  if (IS_DEMO && origin === 'https://bikmako.github.io') {
    throw new Error('ДЕМО нужно разместить на отдельном домене, отличном от bikmako.github.io');
  }
}

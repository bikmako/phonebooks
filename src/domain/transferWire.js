export const TRANSFER_CHUNK_BYTES = 384 * 1024;
export const TRANSFER_MAX_BYTES = 12 * 1024 * 1024;
export const TRANSFER_CHUNK_REQUEST_BYTES = 512 * 1024 + 4096;

export async function sha256Hex(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('');
}

export function base64Bytes(bytes) {
  let binary = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(binary);
}

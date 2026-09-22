export const utf8 = new TextEncoder();
export const decoder = new TextDecoder('utf-8', { fatal: true });
export function encode(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function decode(value, maximum = 4_194_304) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > Math.ceil(maximum * 4 / 3)) throw new Error('Invalid encoded value');
  const bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), character => character.charCodeAt(0));
  if (bytes.length > maximum || encode(bytes) !== value) throw new Error('Invalid encoded value');
  return bytes;
}
export function positive(value, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('Invalid configured limit');
  return value;
}
export function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) throw new Error('Invalid object');
}

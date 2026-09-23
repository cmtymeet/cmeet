import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

export function absolute(value) {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('Absolute configured path required');
  return value;
}
export async function readBounded(path, maximum, privateFile = false) {
  const file = await open(absolute(path), 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > maximum || (privateFile && (info.mode & 0o077) !== 0)) throw new Error('Configuration file rejected');
    const bytes = Buffer.alloc(Number(info.size) + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== info.size) throw new Error('Configuration file changed');
    return bytes.subarray(0, bytesRead);
  } finally { await file.close(); }
}
export async function jsonFile(path, privateFile = false) {
  const bytes = await readBounded(path, 1_048_576, privateFile);
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  finally { if (privateFile) bytes.fill(0); }
}
export function positive(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Explicit positive configuration value required');
  return value;
}


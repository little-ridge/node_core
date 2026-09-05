import { createHmac, timingSafeEqual } from 'node:crypto';

export function signatureValid(raw: string, header: string, secret: string): boolean {
  const trimmed = header.trim();
  if (secret === '' || trimmed === '') {
    return false;
  }

  const provided = trimmed.toLowerCase().startsWith('sha256=')
    ? trimmed.slice(7)
    : trimmed;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(provided, 'hex');
  if (a.length === 0 || a.length !== b.length) {
    return false;
  }

  return timingSafeEqual(a, b);
}

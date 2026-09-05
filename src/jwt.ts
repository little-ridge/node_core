import { jwtVerify } from 'jose';
import type { JwtClaims, JwtVerifier } from './types.ts';

export function createJwtVerifier(secret: string): JwtVerifier {
  const key = new TextEncoder().encode(secret);

  return {
    async verify(token: string): Promise<JwtClaims> {
      if (!secret) {
        throw new Error('jwt_secret_missing');
      }

      const { payload } = await jwtVerify(token, key, {
        algorithms: ['HS256'],
      });

      const sub = typeof payload.sub === 'string' ? payload.sub : '';
      if (sub === '') {
        throw new Error('jwt_missing_sub');
      }

      return {
        sub,
        iss: typeof payload.iss === 'string' ? payload.iss : undefined,
        aud: payload.aud,
        exp: typeof payload.exp === 'number' ? payload.exp : undefined,
        iat: typeof payload.iat === 'number' ? payload.iat : undefined,
        name: typeof payload.name === 'string' ? payload.name : undefined,
      };
    },
  };
}

export function bearerToken(header: string | undefined): string {
  if (!header) {
    return '';
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

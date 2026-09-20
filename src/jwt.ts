import { decodeJwt, jwtVerify } from 'jose';
import { canonicalizeOrigin, createSiteRegistry } from './sites.ts';
import type { JwtClaims, JwtVerifier, SiteRecord, SiteRegistry } from './types.ts';

export function createJwtVerifier(secretOrSites: string | SiteRegistry): JwtVerifier {
  const sites = typeof secretOrSites === 'string'
    ? createSiteRegistry([{
        origin: 'https://jwt.local',
        jwtSecret: secretOrSites,
        webhookSecret: '',
        wpBaseUrl: 'https://jwt.local',
      }])
    : secretOrSites;
  const singleSecret = typeof secretOrSites === 'string';

  return {
    async verify(token: string, originHint?: string): Promise<JwtClaims> {
      const site = resolveVerifySite(sites, token, originHint);
      if (!site || site.jwtSecret === '') {
        throw new Error('jwt_secret_missing');
      }

      const claims = await verifyWith(site, token);
      if (!singleSecret) {
        const iss = claims.iss ? canonicalizeOrigin(claims.iss) : '';
        if (iss !== '' && iss !== site.origin) {
          throw new Error('iss_mismatch');
        }
        if (iss === '' && originHint && canonicalizeOrigin(originHint) !== site.origin) {
          throw new Error('iss_mismatch');
        }
      }

      return claims;
    },
  };
}

function resolveVerifySite(
  sites: SiteRegistry,
  token: string,
  originHint?: string
): SiteRecord | undefined {
  const hinted = originHint ? sites.resolve(originHint) : undefined;
  if (hinted) {
    return hinted;
  }

  try {
    const decoded = decodeJwt(token);
    if (typeof decoded.iss === 'string' && decoded.iss !== '') {
      const fromIss = sites.resolve(decoded.iss);
      if (fromIss) {
        return fromIss;
      }
    }
  } catch {
    // Signature check happens after the site is chosen.
  }

  return sites.defaultSite();
}

async function verifyWith(site: SiteRecord, token: string): Promise<JwtClaims> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(site.jwtSecret), {
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
}

export function bearerToken(header: string | undefined): string {
  if (!header) {
    return '';
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

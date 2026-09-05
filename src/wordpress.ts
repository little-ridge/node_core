import type { WordPressClient } from './types.ts';

export function createWordPressClient(baseUrl: string): WordPressClient {
  const root = baseUrl.replace(/\/+$/, '');

  return {
    async getJson(path: string): Promise<unknown> {
      if (root === '') {
        throw new Error('wp_base_url_missing');
      }

      const url = path.startsWith('http')
        ? path
        : `${root}/${path.replace(/^\/+/, '')}`;
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`wp_http_${response.status}`);
      }

      return response.json();
    },
  };
}

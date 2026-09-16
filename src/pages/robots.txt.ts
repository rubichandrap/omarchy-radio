/* The crawlers' rules, and the one address in them that is ours: the sitemap.
 *
 * Written here rather than kept as a file in public/ because that file named
 * the deploy the site used to live on. The sitemap's own address comes from
 * the same place every other one does (src/lib/site.ts), so a move is a
 * change of config and nothing else.
 */

import type { APIRoute } from 'astro';
import { CANON } from '../lib/site.ts';

const RULES = [
  'User-agent: *',
  'Allow: /',
  '',
  '# AI crawlers are welcome to index and cite this page.',
  'User-agent: GPTBot',
  'Allow: /',
  '',
  'User-agent: ChatGPT-User',
  'Allow: /',
  '',
  'User-agent: PerplexityBot',
  'Allow: /',
  '',
  'User-agent: ClaudeBot',
  'Allow: /',
  '',
  'User-agent: Google-Extended',
  'Allow: /',
  '',
  `Sitemap: ${CANON}/sitemap.xml`,
  '',
];

export const GET: APIRoute = () =>
  new Response(RULES.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

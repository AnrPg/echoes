import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

// Phase 0: passive inspector. No host permissions beyond chatgpt.com, no network requests of our own.
export default defineManifest({
  manifest_version: 3,
  name: 'Echoes (Phase 0 inspector)',
  version: pkg.version,
  description: 'Local-only. Observes chatgpt.com API traffic shapes to answer the Build Plan open questions.',
  permissions: ['storage', 'unlimitedStorage'],
  host_permissions: ['https://chatgpt.com/*'],
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  action: { default_title: 'Open Phase 0 inspector' },
  content_scripts: [
    {
      // Main world, document_start: must wrap fetch before ChatGPT's bundle grabs a reference to it.
      matches: ['https://chatgpt.com/*'],
      js: ['src/monitor/fetch-hook.main.iife.ts'],
      run_at: 'document_start',
      world: 'MAIN',
    },
    {
      matches: ['https://chatgpt.com/*'],
      js: ['src/content/chatgpt.content.iife.ts'],
      run_at: 'document_start',
    },
  ],
});

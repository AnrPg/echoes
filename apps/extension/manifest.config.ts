import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json' with { type: 'json' };

// v1: export. Local only: the one host permission is chatgpt.com, every request runs inside the user's own
// ChatGPT tab through the page bridge, and nothing is sent anywhere else.
export default defineManifest({
  manifest_version: 3,
  name: 'Echoes',
  version: pkg.version,
  description: 'Export your ChatGPT chats and Projects to Markdown or JSON, locally. No servers, no tracking.',
  permissions: ['storage', 'unlimitedStorage'],
  host_permissions: ['https://chatgpt.com/*'],
  background: { service_worker: 'src/background/service-worker.ts', type: 'module' },
  action: { default_title: 'Export with Echoes' },
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

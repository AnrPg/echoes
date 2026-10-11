import { render } from 'preact';
import { App } from './app';
import { ExportController } from './controller';

// Apply the page's saved light/dark choice before the first paint (see PageThemeToggle).
try {
  const t = localStorage.getItem('echoes:page-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset['theme'] = t;
} catch {
  // storage blocked: follow the system
}

const params = new URLSearchParams(location.search);
const tab = params.get('tab');
const controller = new ExportController(tab ? Number(tab) : undefined);
render(<App controller={controller} initialChatId={params.get('chat') ?? undefined} initialScope={params.get('scope') ?? undefined} />, document.getElementById('app')!);

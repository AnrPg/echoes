import { render } from 'preact';
import { App } from './app';
import { ExportController } from './controller';

const params = new URLSearchParams(location.search);
const tab = params.get('tab');
const controller = new ExportController(tab ? Number(tab) : undefined);
render(<App controller={controller} chatId={params.get('chat') ?? undefined} />, document.getElementById('app')!);

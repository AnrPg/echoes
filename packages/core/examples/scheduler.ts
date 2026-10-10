// Send requests through the polite queue with an injected transport, and handle an expired session.
// Run: node examples/scheduler.ts
import { Scheduler, type TransportRequest } from '@echoes/core';

export async function main(): Promise<string[]> {
  const out: string[] = [];
  let loggedIn = false;

  // A host supplies the transport. In the extension it wraps fetch inside the logged-in page; here it is a stub
  // that answers 401 until the "user" logs in.
  const transport = async (req: TransportRequest) => {
    const status = loggedIn ? 200 : 401;
    return { status, headers: new Headers(), url: req.url };
  };

  // Real deployments keep the defaults (about 1 request per second plus jitter); the example runs faster.
  const scheduler = new Scheduler({ transport, intervalMs: 20, jitterMs: 10 });
  scheduler.subscribe((e) => {
    out.push(`event: ${e.type}${'reason' in e ? ` (${e.reason})` : ''}`);
    if (e.type === 'paused') {
      // The host would now ask the user to refresh chatgpt.com or log in, then call resume(). Never automatically.
      loggedIn = true;
      scheduler.resume();
    }
  });

  const res = await scheduler.request({ url: 'https://example.invalid/conversation/1', method: 'GET' });
  out.push(`status: ${res.status}`);
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log((await main()).join('\n'));

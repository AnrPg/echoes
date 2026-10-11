// Timers for the request queue, kept off the page's main thread. Chrome slows a hidden page's main-thread timers
// down to about one per minute after five minutes ("intensive throttling"); a dedicated worker's timers are exempt.

type Message = { id: number; ms: number } | { id: number; cancel: true };

const timers = new Map<number, ReturnType<typeof setTimeout>>();
const scope = self as unknown as { onmessage: ((e: MessageEvent<Message>) => void) | null; postMessage(id: number): void };

scope.onmessage = (e) => {
  const m = e.data;
  if ('cancel' in m) {
    clearTimeout(timers.get(m.id));
    timers.delete(m.id);
    return;
  }
  timers.set(
    m.id,
    setTimeout(() => {
      timers.delete(m.id);
      scope.postMessage(m.id);
    }, m.ms),
  );
};

// Minimal, spec-following Server-Sent Events parser (WHATWG "event stream interpretation").
// Used only to learn the shapes of streamed events; it never rewrites anything.

export interface SseEvent {
  event?: string;
  data: string;
}

export function parseSse(text: string): SseEvent[] {
  const out: SseEvent[] = [];
  let event: string | undefined;
  let data: string[] = [];
  const dispatch = () => {
    if (data.length > 0) out.push(event === undefined ? { data: data.join('\n') } : { event, data: data.join('\n') });
    event = undefined;
    data = [];
  };
  // Pitfall: streams may use \r\n, \r or \n line endings.
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line === '') { dispatch(); continue; }
    if (line.startsWith(':')) continue; // comment / keep-alive
    const i = line.indexOf(':');
    const field = i === -1 ? line : line.slice(0, i);
    let value = i === -1 ? '' : line.slice(i + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    // "id" and "retry" are irrelevant for shape capture.
  }
  dispatch(); // tolerate a missing trailing blank line
  return out;
}

export type ParsedData = { kind: 'json'; value: unknown } | { kind: 'done' } | { kind: 'text'; length: number };

export function parseSseData(data: string): ParsedData {
  if (data.trim() === '[DONE]') return { kind: 'done' };
  try {
    return { kind: 'json', value: JSON.parse(data) };
  } catch {
    return { kind: 'text', length: data.length };
  }
}

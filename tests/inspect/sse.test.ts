import { describe, expect, it } from 'vitest';
import { parseSse, parseSseData } from '../../src/inspect/sse';
import { summarizeSse } from '../../src/monitor/observe';

describe('parseSse', () => {
  it('handles events, multi-line data, comments and CRLF', () => {
    const text = ': keep-alive\r\nevent: delta\r\ndata: {"a":1}\r\n\r\ndata: line1\ndata: line2\n\ndata: [DONE]';
    expect(parseSse(text)).toEqual([
      { event: 'delta', data: '{"a":1}' },
      { data: 'line1\nline2' },
      { data: '[DONE]' },
    ]);
  });
  it('strips exactly one leading space', () => {
    expect(parseSse('data:  x\n\n')).toEqual([{ data: ' x' }]);
  });
  it('classifies data payloads', () => {
    expect(parseSseData('[DONE]')).toEqual({ kind: 'done' });
    expect(parseSseData('{"x":1}')).toEqual({ kind: 'json', value: { x: 1 } });
    expect(parseSseData('"v1"')).toEqual({ kind: 'json', value: 'v1' });
    expect(parseSseData('oops')).toEqual({ kind: 'text', length: 4 });
  });
});

describe('summarizeSse', () => {
  it('merges JSON event shapes and counts the rest', () => {
    const s = summarizeSse('event: a\ndata: {"o":"add"}\n\nevent: b\ndata: {"o":"patch","v":1}\n\ndata: junk\n\ndata: [DONE]\n\n');
    expect(s.events).toBe(4);
    expect(s.eventNames).toEqual(['a', 'b']);
    expect(s.sawDone).toBe(true);
    expect(s.nonJson).toBe(1);
    expect(s.data!.obj!.keys.o!.shape.str!.values).toEqual(['add', 'patch']);
    expect(s.data!.obj!.keys.v!.present).toBe(1);
  });
});

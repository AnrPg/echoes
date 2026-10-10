import { describe, expect, it } from 'vitest';
import { TIMELINE_CAP, addMarker, applyRecord, emptyState } from '../../src/inspect/aggregate';
import { EnvelopeZ, type FetchRecord } from '../../src/inspect/messages';
import { buildReport, renderTimeline } from '../../src/inspect/report';
import { shapeOf } from '../../src/inspect/shape';

const rec = (over: Partial<FetchRecord> = {}): FetchRecord => ({
  v: 1, kind: 'fetch', t: 1_000, method: 'GET',
  url: { host: 'chatgpt.com', path: '/api/thing/:id', query: [] },
  reqHeaders: ['authorization', 'content-type'], ms: 5, status: 200, resContentType: 'application/json',
  resBody: shapeOf({ a: 1 }), ...over,
});

describe('applyRecord', () => {
  it('aggregates per endpoint template', () => {
    const s = emptyState();
    applyRecord(s, rec());
    applyRecord(s, rec({ t: 2_000, status: 404, resBody: shapeOf({ a: 2, b: 'x' }) }));
    const e = s.endpoints['GET chatgpt.com/api/thing/:id']!;
    expect(e.count).toBe(2);
    expect(e.statuses).toEqual({ '200': 1, '404': 1 });
    expect(e.resBody!.obj!.keys.b!.present).toBe(1);
    expect(e.first).toBe(1_000);
    expect(e.last).toBe(2_000);
  });

  it('keeps the timeline ordered by request start and capped', () => {
    const s = emptyState();
    applyRecord(s, rec({ t: 30 }));
    addMarker(s, 'click', 20);
    applyRecord(s, rec({ t: 10 }));
    expect(s.timeline.map((e) => e.t)).toEqual([10, 20, 30]);
    for (let i = 0; i < TIMELINE_CAP + 10; i++) applyRecord(s, rec({ t: 100 + i }));
    expect(s.timeline.length).toBe(TIMELINE_CAP);
  });
});

describe('report', () => {
  it('shows a window of requests around markers', () => {
    const s = emptyState();
    for (let i = 0; i < 50; i++) applyRecord(s, rec({ t: i }));
    addMarker(s, 'branch', 25.5);
    const lines = renderTimeline(s, 2, 3);
    expect(lines.filter((l) => l.includes('MARK: branch'))).toHaveLength(1);
    expect(lines).toHaveLength(2 + 1 + 3); // ellipses only between kept windows, not at the ends
  });

  it('never includes header values or ids, only names and templates', () => {
    const s = emptyState();
    applyRecord(s, rec());
    const md = buildReport(s, 0);
    expect(md).toContain('request header names: authorization, content-type');
    expect(md).toContain('### GET chatgpt.com/api/thing/:id');
  });
});

describe('EnvelopeZ', () => {
  it('rejects forged or malformed page messages', () => {
    expect(EnvelopeZ.safeParse({ channel: 'cgx-phase0-capture', record: { kind: 'fetch' } }).success).toBe(false);
    expect(EnvelopeZ.safeParse({ channel: 'other', record: rec() }).success).toBe(false);
    expect(EnvelopeZ.safeParse({ channel: 'cgx-phase0-capture', record: rec() }).success).toBe(true);
  });
});

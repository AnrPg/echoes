// Aggregates capture records into one entry per endpoint template, plus a capped timeline.
// Pure functions, so the content script, the inspector page and tests share one implementation.

import { z } from 'zod';
import type { CaptureRecord } from './messages';
import { mergeShapes, type Shape } from './shape';

export interface EndpointAgg {
  key: string;
  kind: 'fetch' | 'websocket';
  method?: string;
  host: string;
  path: string;
  query: string[];
  count: number;
  first: number;
  last: number;
  statuses: Record<string, number>;
  reqHeaders: string[];
  reqContentTypes: string[];
  resContentTypes: string[];
  reqBody?: Shape;
  resBody?: Shape;
  sse?: { streams: number; events: number; eventNames: string[]; sawDone: boolean; nonJson: number; data?: Shape };
  errors: Record<string, number>;
}

export interface TimelineEntry {
  t: number;
  key?: string;
  status?: number;
  marker?: string;
}

export interface RawIndexEntry {
  id: string;
  t: number;
  key: string;
  bytes: number;
}

export interface CaptureState {
  v: 1;
  endpoints: Record<string, EndpointAgg>;
  timeline: TimelineEntry[];
  rawIndex: RawIndexEntry[];
}

export const TIMELINE_CAP = 3000;

export const emptyState = (): CaptureState => ({ v: 1, endpoints: {}, timeline: [], rawIndex: [] });

// Loose check for state read back from storage: wrong version or shape → start fresh, loudly.
export const CaptureStateZ = z.object({
  v: z.literal(1),
  endpoints: z.record(z.string(), z.any()),
  timeline: z.array(z.object({ t: z.number() }).passthrough()),
  rawIndex: z.array(z.object({ id: z.string(), t: z.number(), key: z.string(), bytes: z.number() })),
});

export function endpointKey(r: CaptureRecord): string {
  const q = r.url.query.length ? `?${r.url.query.join('&')}` : '';
  return r.kind === 'websocket' ? `WS ${r.url.host}${r.url.path}${q}` : `${r.method} ${r.url.host}${r.url.path}${q}`;
}

const union = (a: string[], b: (string | undefined)[]) =>
  [...new Set([...a, ...b.filter((x): x is string => x !== undefined)])].sort();
const mergeOpt = (a: Shape | undefined, b: Shape | undefined) => (a && b ? mergeShapes(a, b) : (a ?? b));

/** Mutates and returns `state`. */
export function applyRecord(state: CaptureState, r: CaptureRecord): CaptureState {
  const key = endpointKey(r);
  const prev = state.endpoints[key];
  const e: EndpointAgg = prev ?? {
    key, kind: r.kind, host: r.url.host, path: r.url.path, query: r.url.query,
    count: 0, first: r.t, last: r.t, statuses: {}, reqHeaders: [], reqContentTypes: [], resContentTypes: [], errors: {},
  };
  e.count++;
  e.first = Math.min(e.first, r.t);
  e.last = Math.max(e.last, r.t);
  if (r.kind === 'fetch') {
    e.method = r.method;
    if (r.status !== undefined) e.statuses[String(r.status)] = (e.statuses[String(r.status)] ?? 0) + 1;
    e.reqHeaders = union(e.reqHeaders, r.reqHeaders);
    e.reqContentTypes = union(e.reqContentTypes, [r.reqContentType]);
    e.resContentTypes = union(e.resContentTypes, [r.resContentType]);
    const rb = mergeOpt(e.reqBody, r.reqBody);
    if (rb) e.reqBody = rb;
    const sb = mergeOpt(e.resBody, r.resBody);
    if (sb) e.resBody = sb;
    if (r.sse) {
      const s = e.sse ?? { streams: 0, events: 0, eventNames: [], sawDone: false, nonJson: 0 };
      const data = mergeOpt(s.data, r.sse.data);
      e.sse = {
        streams: s.streams + 1,
        events: s.events + r.sse.events,
        eventNames: union(s.eventNames, r.sse.eventNames),
        sawDone: s.sawDone || r.sse.sawDone,
        nonJson: s.nonJson + r.sse.nonJson,
        ...(data ? { data } : {}),
      };
    }
    if (r.error) e.errors[r.error] = (e.errors[r.error] ?? 0) + 1;
  }
  state.endpoints[key] = e;
  const entry: TimelineEntry = { t: r.t, key };
  if (r.kind === 'fetch' && r.status !== undefined) entry.status = r.status;
  pushTimeline(state, entry);
  return state;
}

export function addMarker(state: CaptureState, label: string, t: number): CaptureState {
  pushTimeline(state, { t, marker: label.slice(0, 200) });
  return state;
}

function pushTimeline(state: CaptureState, entry: TimelineEntry) {
  state.timeline.push(entry);
  // Records arrive when responses finish, so keep the timeline ordered by request start.
  state.timeline.sort((a, b) => a.t - b.t);
  if (state.timeline.length > TIMELINE_CAP) state.timeline.splice(0, state.timeline.length - TIMELINE_CAP);
}

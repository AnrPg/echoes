// Text report of a capture: what ANR shares back so we can answer the Phase 0 open questions.
// Contains endpoint templates, header NAMES, shapes and enum-like literals only, no content.

import type { CaptureState, EndpointAgg } from './aggregate';
import { renderShape } from './render';

const iso = (t: number) => new Date(t).toISOString();

export function sortEndpoints(state: CaptureState): EndpointAgg[] {
  return Object.values(state.endpoints).sort((a, b) => a.first - b.first);
}

export function renderEndpoint(e: EndpointAgg): string {
  const lines = [`### ${e.key}`, ''];
  lines.push(`- seen: ${e.count}× (${iso(e.first)} → ${iso(e.last)})`);
  const st = Object.entries(e.statuses).map(([s, n]) => `${s}×${n}`).join(', ');
  if (st) lines.push(`- statuses: ${st}`);
  if (e.reqHeaders.length) lines.push(`- request header names: ${e.reqHeaders.join(', ')}`);
  if (e.reqContentTypes.length) lines.push(`- request content-type: ${e.reqContentTypes.join(', ')}`);
  if (e.resContentTypes.length) lines.push(`- response content-type: ${e.resContentTypes.join(', ')}`);
  const errs = Object.entries(e.errors).map(([s, n]) => `${s}×${n}`).join(', ');
  if (errs) lines.push(`- errors: ${errs}`);
  if (e.reqBody) lines.push('', 'Request body:', '```ts', renderShape(e.reqBody), '```');
  if (e.resBody) lines.push('', 'Response body:', '```ts', renderShape(e.resBody), '```');
  if (e.sse) {
    lines.push('', `Stream: ${e.sse.streams} stream(s), ${e.sse.events} events, names [${e.sse.eventNames.join(', ')}], [DONE] ${e.sse.sawDone ? 'seen' : 'not seen'}, non-JSON data ${e.sse.nonJson}`);
    if (e.sse.data) lines.push('```ts', renderShape(e.sse.data), '```');
  }
  return lines.join('\n');
}

export function buildReport(state: CaptureState, now = Date.now()): string {
  const eps = sortEndpoints(state);
  const out = [
    '# Phase 0 capture report',
    '',
    `Generated ${iso(now)}. ${eps.length} endpoint templates, ${state.timeline.length} timeline entries.`,
    'Ids are replaced by :id / <id>; only machine-token literals are kept. Review before sharing anyway.',
    '',
    '## Timeline (markers and the requests around them)',
    '',
    '```text',
    ...renderTimeline(state),
    '```',
    '',
    '## Endpoints',
    '',
    ...eps.map(renderEndpoint),
  ];
  return out.join('\n') + '\n';
}

/** Markers with the 8 requests before and 25 after each; the whole timeline if there are no markers. */
export function renderTimeline(state: CaptureState, before = 8, after = 25): string[] {
  const tl = state.timeline;
  const markerIdx = tl.flatMap((e, i) => (e.marker !== undefined ? [i] : []));
  const keep = new Set<number>();
  if (markerIdx.length === 0) tl.forEach((_e, i) => keep.add(i));
  for (const m of markerIdx) for (let i = Math.max(0, m - before); i <= Math.min(tl.length - 1, m + after); i++) keep.add(i);
  const lines: string[] = [];
  let last = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (last !== -1 && i !== last + 1) lines.push('   …');
    const e = tl[i]!;
    lines.push(e.marker !== undefined ? `${iso(e.t)}  ==== MARK: ${e.marker}` : `${iso(e.t)}  ${e.status ?? '---'}  ${e.key}`);
    last = i;
  }
  return lines;
}

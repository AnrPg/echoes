// Records sent from the main-world fetch hook to the isolated content script.
// window.postMessage is visible to (and forgeable by) the page, so the receiver validates with zod
// and the payload never contains secrets: header NAMES only, shapes instead of bodies.

import { z } from 'zod';
import type { Shape } from './shape';

import { CHANNEL } from './channel';
export { CHANNEL };

// Shapes are recursive and produced by our own code; validate the envelope and keep shapes opaque.
const ShapeZ = z.custom<Shape>(
  (v) => typeof v === 'object' && v !== null && typeof (v as { n?: unknown }).n === 'number' && Array.isArray((v as { kinds?: unknown }).kinds),
  { message: 'not a Shape' },
);

const UrlZ = z.object({ host: z.string(), path: z.string(), query: z.array(z.string()) });

export const SseSummaryZ = z.object({
  events: z.number().int().nonnegative(),
  eventNames: z.array(z.string()),
  sawDone: z.boolean(),
  nonJson: z.number().int().nonnegative(),
  data: ShapeZ.optional(),
});

export const FetchRecordZ = z.object({
  v: z.literal(1),
  kind: z.literal('fetch'),
  t: z.number(),
  method: z.string(),
  url: UrlZ,
  reqHeaders: z.array(z.string()),
  reqContentType: z.string().optional(),
  reqBody: ShapeZ.optional(),
  status: z.number().int().optional(),
  resContentType: z.string().optional(),
  resBody: ShapeZ.optional(),
  sse: SseSummaryZ.optional(),
  error: z.string().optional(),
  ms: z.number(),
  /** Full JSON body, only for GET under /backend-api/ and only kept if the user enabled raw capture. */
  raw: z.unknown().optional(),
});

export const SocketRecordZ = z.object({
  v: z.literal(1),
  kind: z.literal('websocket'),
  t: z.number(),
  url: UrlZ,
});

export const CaptureRecordZ = z.discriminatedUnion('kind', [FetchRecordZ, SocketRecordZ]);
export type FetchRecord = z.infer<typeof FetchRecordZ>;
export type SocketRecord = z.infer<typeof SocketRecordZ>;
export type CaptureRecord = z.infer<typeof CaptureRecordZ>;

export const EnvelopeZ = z.object({ channel: z.literal(CHANNEL), record: CaptureRecordZ });

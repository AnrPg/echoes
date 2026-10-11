// chrome.storage.local layout for Phase 0. Raw bodies live under their own keys so that
// flushing the aggregate never rewrites megabytes of raw JSON.

import { CaptureStateZ, emptyState, type CaptureState } from './aggregate';

export const STATE_KEY = 'phase0:state';
export const SETTINGS_KEY = 'phase0:settings';
export const RAW_PREFIX = 'phase0:raw:';
export const RAW_CAP = 300;

export interface Settings {
  /** Diagnostics capture of API shapes (the Phase 0 inspector). Off by default; switched on for bug reports. */
  capture: boolean;
  /** Keep full JSON bodies of GET /backend-api/* responses (personal data!). Off by default. */
  raw: boolean;
}

export async function loadState(): Promise<CaptureState> {
  const got = await chrome.storage.local.get(STATE_KEY);
  const parsed = CaptureStateZ.safeParse(got[STATE_KEY]);
  if (got[STATE_KEY] !== undefined && !parsed.success) {
    console.warn('[echoes] stored capture state is invalid; starting fresh', parsed.error);
  }
  return parsed.success ? (parsed.data as CaptureState) : emptyState();
}

export const saveState = (s: CaptureState) => chrome.storage.local.set({ [STATE_KEY]: s });

export async function loadSettings(): Promise<Settings> {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  const s = got[SETTINGS_KEY] as Partial<Settings> | undefined;
  return { capture: s?.capture === true, raw: s?.raw === true };
}

export const saveSettings = (s: Settings) => chrome.storage.local.set({ [SETTINGS_KEY]: s });

export async function clearAll(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k === STATE_KEY || k.startsWith(RAW_PREFIX));
  await chrome.storage.local.remove(keys);
}

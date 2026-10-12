// The activity log: one running record of what the export page did, like a terminal. Entries are never cleared when
// the user opens another chat or Project in ChatGPT; each one names the chat or Project it was about instead.

import type { ExportReport } from '../../export/run';
import type { SelfTestResult } from '../../export/self-test';
import { summarizeWarnings } from './notes';

export type LogLevel = 'info' | 'ok' | 'warn' | 'error';

export interface LogLine {
  text: string;
  level?: LogLevel;
}

export interface LogEntry {
  id: number;
  /** Epoch milliseconds. */
  at: number;
  /** What the action was about: a chat title, a Project, or the whole account. */
  context: string;
  level: LogLevel;
  title: string;
  lines?: LogLine[];
}

export type NewLogEntry = Omit<LogEntry, 'id' | 'at' | 'context'>;

/** Keep the log bounded on long sessions. */
export const MAX_LOG_ENTRIES = 300;

export function appendLog(log: readonly LogEntry[], entry: NewLogEntry, context: string, at: number): LogEntry[] {
  const id = (log.at(-1)?.id ?? 0) + 1;
  return [...log, { ...entry, id, at, context }].slice(-MAX_LOG_ENTRIES);
}

/** Warnings from a single-chat action (PDF, picked turns), or a plain "done" when there were none. */
export function notesEntry(what: string, warnings: readonly string[]): NewLogEntry {
  const notes = summarizeWarnings(warnings);
  if (notes.length === 0) return { level: 'ok', title: what };
  return { level: 'warn', title: `${what}. Notes on what was kept differently:`, lines: notes.map((text) => ({ text })) };
}

/**
 * After the print window closes. Echoes cannot tell whether a PDF was saved (the browser does not say), so the entry
 * says what makes a file and where it goes.
 */
export function printedEntry(warnings: readonly string[]): NewLogEntry {
  const notes = summarizeWarnings(warnings);
  return {
    level: notes.length ? 'warn' : 'ok',
    title: 'Print window closed',
    lines: [
      { text: 'A PDF is saved only if Destination was "Save as PDF" and you pressed Save. It is in the folder you picked then (usually Downloads).' },
      { text: 'Cancelled, or printed to paper? Press the button again and choose "Save as PDF".' },
      ...notes.map((text) => ({ level: 'warn' as const, text })),
    ],
  };
}

export function reportEntry(report: ExportReport): NewLogEntry {
  const count = (s: string) => report.job.items.filter((i) => i.status === s).length;
  const failed = count('failed');
  const written = count('done') - report.verified.length;
  const lines: LogLine[] = report.job.items
    .filter((i) => i.status === 'failed' || report.warnings[i.conversationId])
    .map((i) => ({
      level: i.status === 'failed' ? 'error' : 'warn',
      text: `${i.title || i.conversationId}: ${i.error ?? summarizeWarnings(report.warnings[i.conversationId]!).join('; ')}`,
    }));
  const entry: NewLogEntry = {
    level: failed ? 'error' : lines.length ? 'warn' : 'ok',
    title: `Export finished: ${written} written, ${report.verified.length} re-checked and unchanged, ${count('skipped')} skipped, ${failed} failed. Details are in echoes-report.json next to the files.`,
  };
  if (lines.length) entry.lines = lines;
  return entry;
}

export function checkEntry(check: SelfTestResult): NewLogEntry {
  const skipped = check.checks.some((c) => c.skipped);
  const lines: LogLine[] = check.checks.map((c) => ({
    level: c.skipped ? 'info' : c.ok ? 'ok' : 'error',
    text: `${c.skipped ? '–' : c.ok ? '✓' : '✗'} ${c.name}: ${c.detail}`,
  }));
  if (skipped) lines.push({ level: 'info', text: 'Lines marked – were not tested because this chat has nothing to test them on. Open a chat that has them and run the check again.' });
  return { level: check.ok ? 'ok' : 'error', title: check.ok ? 'Compatibility check passed' : 'Compatibility check found problems', lines };
}

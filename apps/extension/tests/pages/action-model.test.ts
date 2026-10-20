import { TURN_PRESETS } from '@echoes/core';
import { describe, expect, it } from 'vitest';
import { formatOf, primaryAction, settingsSummary, turnFiles, withFormat, type ActionState } from '../../src/pages/export/action-model';
import { DEFAULT_PAGE_SETTINGS } from '../../src/pages/export/controller';

const base: ActionState = { scope: 'chat', settings: DEFAULT_PAGE_SETTINGS, connected: true, busy: false, chatOpen: true };
const theme = (t: string) => (t === 'chatgpt' ? 'Like ChatGPT' : t);

describe('the one export button', () => {
  it('says what it will do, for each scope and format', () => {
    expect(primaryAction(base)).toEqual({ label: 'Export this chat as Markdown' });
    expect(primaryAction({ ...base, settings: withFormat(DEFAULT_PAGE_SETTINGS, 'pdf') }).label).toBe('Save this chat as PDF');
    expect(primaryAction({ ...base, scope: 'turns', pickedTurns: 1 }).label).toBe('Export 1 turn as Markdown');
    expect(primaryAction({ ...base, scope: 'turns', pickedTurns: 9, settings: withFormat(DEFAULT_PAGE_SETTINGS, 'pdf') }).label).toBe('Save 9 turns as PDF');
    expect(primaryAction({ ...base, scope: 'many', pickedChats: 42, settings: withFormat(DEFAULT_PAGE_SETTINGS, 'html') }).label).toBe('Export 42 chats as HTML');
  });

  it('says why it cannot be pressed', () => {
    expect(primaryAction({ ...base, chatOpen: false }).blocked).toBe('Open a chat in the ChatGPT tab first.');
    expect(primaryAction({ ...base, scope: 'turns', pickedTurns: 0 }).blocked).toBe('Tick at least one turn.');
    expect(primaryAction({ ...base, scope: 'many' }).blocked).toBe('Load your chats first.');
    expect(primaryAction({ ...base, connected: false }).blocked).toBe('Open chatgpt.com and log in first.');
    expect(primaryAction({ ...base, busy: true }).blocked).toBe('Wait for the current task to finish.');
  });
});

describe('many chats in one file', () => {
  const merged = { ...DEFAULT_PAGE_SETTINGS, layout: 'merged' as const };
  it('says it makes one file, and allows PDF', () => {
    expect(primaryAction({ ...base, scope: 'many', pickedChats: 4, settings: merged }).label).toBe('Export 4 chats into one Markdown file');
    expect(primaryAction({ ...base, scope: 'many', pickedChats: 4, settings: withFormat(merged, 'pdf') })).toEqual({ label: 'Save 4 chats as one PDF' });
    expect(primaryAction({ ...base, scope: 'many', pickedChats: 4, settings: withFormat(merged, 'resources') }).label).toBe('Export 4 chats as Resources only');
  });

  it('PDF per chat: one print window each', () => {
    expect(primaryAction({ ...base, scope: 'many', pickedChats: 3, settings: withFormat(DEFAULT_PAGE_SETTINGS, 'pdf') })).toEqual({ label: 'Save 3 chats as PDFs, one print window each' });
  });

  it('shows the layout in the summary for many chats only', () => {
    expect(settingsSummary(merged, 'many', theme)).toBe('Markdown · GitHub style · Full archive · shown version only · one file');
    expect(settingsSummary(DEFAULT_PAGE_SETTINGS, 'many', theme)).toBe('Markdown · GitHub style · Full archive · shown version only · a file per chat');
    expect(settingsSummary(merged, 'chat', theme)).toBe('Markdown · GitHub style · Full archive · shown version only');
  });
});

describe('some turns in groups', () => {
  const groups = { ...DEFAULT_PAGE_SETTINGS, turnsPerFile: 5 };
  const turns = (n: number, settings = groups) => primaryAction({ ...base, scope: 'turns', pickedTurns: n, turnFiles: turnFiles(settings, n), settings });

  it('counts the files: the last one holds what is left', () => {
    expect(turnFiles(groups, 12)).toBe(3);
    expect(turnFiles(groups, 10)).toBe(2);
    expect(turnFiles(groups, 5)).toBe(1);
    expect(turnFiles(DEFAULT_PAGE_SETTINGS, 12)).toBe(1);
  });

  it('JSON and Resources only never split', () => {
    expect(turnFiles(withFormat(groups, 'json'), 12)).toBe(1);
    expect(turnFiles(withFormat(groups, 'resources'), 12)).toBe(1);
  });

  it('the button says how many files, or print windows', () => {
    expect(turns(12).label).toBe('Export 12 turns into 3 Markdown files');
    expect(turns(4).label).toBe('Export 4 turns as Markdown');
    expect(turns(12, withFormat(groups, 'pdf')).label).toBe('Save 12 turns as 3 PDFs, one print window each');
  });

  it('the summary shows the group size for some turns only', () => {
    expect(settingsSummary(groups, 'turns', theme)).toBe('Markdown · GitHub style · Full archive · 5 turns per file');
    expect(settingsSummary(groups, 'chat', theme)).toBe('Markdown · GitHub style · Full archive · shown version only');
    expect(settingsSummary(withFormat(groups, 'json'), 'turns', theme)).toBe('Echoes JSON · Full archive');
  });
});

describe('Format menu with PDF', () => {
  it('keeps the file format behind PDF, and brings it back', () => {
    const html = withFormat(DEFAULT_PAGE_SETTINGS, 'html');
    const pdf = withFormat(html, 'pdf');
    expect(formatOf(pdf)).toBe('pdf');
    expect(pdf.format).toBe('html');
    expect(formatOf(withFormat(pdf, 'json'))).toBe('json');
  });

  it('summarizes only the settings that apply', () => {
    expect(settingsSummary(DEFAULT_PAGE_SETTINGS, 'chat', theme)).toBe('Markdown · GitHub style · Full archive · shown version only');
    const pdf = { ...withFormat(DEFAULT_PAGE_SETTINGS, 'pdf'), theme: 'chatgpt' as const, turns: { ...TURN_PRESETS.studyNotes } };
    expect(settingsSummary(pdf, 'turns', theme)).toBe('PDF · Like ChatGPT look · Study notes');
    expect(settingsSummary(withFormat(DEFAULT_PAGE_SETTINGS, 'resources'), 'many', theme)).toBe('Resources only · shown version only');
  });
});

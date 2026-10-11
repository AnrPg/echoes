import { describe, expect, it } from 'vitest';
import { listingText } from '../../src/pages/export/listing';

describe('listingText', () => {
  it('says how far the chat list has got', () => {
    expect(listingText({ projectsDone: 0, projects: 0, chats: 21 }, false)).toBe('Found 21 chats so far…');
    expect(listingText({ projectsDone: 5, projects: 60, chats: 1 }, false)).toBe('Found 1 chat so far. Projects listed: 5 of 60…');
    expect(listingText({ projectsDone: 0, projects: 1, chats: 2 }, true)).toBe('Found 2 chats in this Project so far…');
  });
});

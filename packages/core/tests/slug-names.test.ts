import { describe, expect, it } from 'vitest';
import { linkPath, slugFileName, uniqueSlugName } from '../src/output/filenames';

describe('viewer-safe resource names', () => {
  it('has no spaces, brackets or other characters Markdown viewers trip on', () => {
    expect(slugFileName('Choose SSH IP')).toBe('choose-ssh-ip');
    expect(slugFileName('image-gen-1(1)')).toBe('image-gen-1-1');
    expect(slugFileName('  Q3: plans / "draft"?  ')).toBe('q3-plans-draft');
    expect(slugFileName('Ελληνικά & हिन्दी')).toBe('ελληνικά-हिन्दी');
    expect(slugFileName('***')).toBe('file');
    expect(slugFileName('CON')).toBe('con_');
  });

  it('is deterministic and collision-safe without brackets', () => {
    const taken = new Set<string>();
    expect(uniqueSlugName('image', '.png', taken)).toBe('image.png');
    expect(uniqueSlugName('Image', '.png', taken)).toBe('image-2.png');
    expect(uniqueSlugName('image', '.png', taken)).toBe('image-3.png');
  });

  it('links to a path without percent signs when nothing needs escaping', () => {
    expect(linkPath('choose-ssh-ip_files', 'image-gen-1.png')).toBe('choose-ssh-ip_files/image-gen-1.png');
    expect(linkPath('ελληνικά_files', 'a.png')).toBe('ελληνικά_files/a.png');
  });
});

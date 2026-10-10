// Deterministic anonymizer for captured raw JSON, applied BEFORE a sample becomes a fixture.
// It rewrites identifiers consistently (same input id → same fake id, in keys and values alike,
// so tree links like parent/children keep working), redacts emails and personal-looking fields,
// and strips URL query strings (signed download tokens).
//
// It does NOT rewrite free text (messages, titles). Those must be reviewed by hand: the report
// counts them so nothing is assumed safe. Rewriting prose would break LaTeX/code that golden
// tests depend on; a structure-preserving scrambler is a v1 decision.

import { classifyString } from './strings';

export interface AnonReport {
  ids: number;
  emails: number;
  urls: number;
  redactedFields: number;
  /** Number of free-text strings left unchanged; review them before committing. */
  textStrings: number;
  /** Keys under which free text was found (for the manual review). */
  textKeys: string[];
}

const PERSONAL_KEY = /(e-?mail|phone|user_?name|full_?name|first_?name|last_?name|account_?user|avatar|picture|ip_?addr)/i;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_PREFIX = /^((?:[a-z]+-)+|[a-z]+_)(.+)$/;

export class Anonymizer {
  private ids = new Map<string, string>();
  private emails = new Map<string, string>();
  private textKeys = new Set<string>();
  readonly report: AnonReport = { ids: 0, emails: 0, urls: 0, redactedFields: 0, textStrings: 0, textKeys: [] };

  run(value: unknown): unknown {
    const out = this.walk(value, undefined);
    this.report.textKeys = [...this.textKeys].sort();
    return out;
  }

  private walk(v: unknown, key: string | undefined): unknown {
    if (Array.isArray(v)) return v.map((x) => this.walk(x, key));
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        const nk = this.isId(k) ? this.id(k) : k;
        out[nk] = this.isPersonal(k, x) ? this.redact() : this.walk(x, k);
      }
      return out;
    }
    if (typeof v === 'string') return this.str(v, key);
    return v;
  }

  private str(s: string, key: string | undefined): string {
    switch (classifyString(s)) {
      case 'uuid':
      case 'id':
        return this.id(s);
      case 'email':
        return this.email(s);
      case 'url':
        return this.url(s);
      case 'text':
        this.report.textStrings++;
        if (key !== undefined) this.textKeys.add(key);
        // Emails embedded in prose are still personal data.
        return s.replace(EMAIL_IN_TEXT, (m) => this.email(m));
      default:
        return s;
    }
  }

  private isPersonal(key: string, x: unknown): boolean {
    if (typeof x !== 'string' || x === '') return false;
    // "name" is personal when it is prose ("Γιώργος Π."), not when it is a machine token ("python").
    return PERSONAL_KEY.test(key) || (/^(display_)?name$/i.test(key) && classifyString(x) === 'text');
  }

  private isId(s: string): boolean {
    const c = classifyString(s);
    return c === 'uuid' || c === 'id';
  }

  id(s: string): string {
    const hit = this.ids.get(s);
    if (hit) return hit;
    const n = this.ids.size + 1;
    let fake: string;
    if (UUID.test(s)) fake = `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
    else {
      const prefix = ID_PREFIX.exec(s)?.[1] ?? '';
      fake = `${prefix}anon${String(n).padStart(12, '0')}`;
    }
    this.ids.set(s, fake);
    this.report.ids++;
    return fake;
  }

  private email(s: string): string {
    const hit = this.emails.get(s.toLowerCase());
    if (hit) return hit;
    const fake = `user${this.emails.size + 1}@example.com`;
    this.emails.set(s.toLowerCase(), fake);
    this.report.emails++;
    return fake;
  }

  private url(s: string): string {
    try {
      const u = new URL(s);
      const path = u.pathname
        .split('/')
        .map((seg) => (seg && this.isId(decodeURIComponent(seg)) ? this.id(decodeURIComponent(seg)) : seg))
        .join('/');
      this.report.urls++;
      return `${u.protocol}//${u.host}${path}`;
    } catch {
      return s;
    }
  }

  private redact(): string {
    this.report.redactedFields++;
    return '<redacted>';
  }
}

export function anonymize(value: unknown): { value: unknown; report: AnonReport } {
  const a = new Anonymizer();
  const out = a.run(value);
  return { value: out, report: a.report };
}

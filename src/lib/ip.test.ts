import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getClientIp } from './ip';
import { getSiteUrl, getSiteHost } from './site-url';

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

describe('getClientIp()', () => {
  it('returns the RIGHTMOST x-forwarded-for entry (the one the proxy appended)', () => {
    // The whole point: the leftmost value is client-controlled. An attacker
    // sends "1.1.1.1, 2.2.2.2, 3.3.3.3" and every entry but the last is a lie
    // the proxy never verified. Taking the leftmost would let one attacker
    // rotate the key past an IP-based rate limit at will.
    expect(getClientIp(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' }))).toBe('3.3.3.3');
  });

  it('survives a spoofed prefix — the real IP still wins', () => {
    const spoof = Array.from({ length: 20 }, (_, i) => `10.0.0.${i}`).join(', ');
    expect(getClientIp(req({ 'x-forwarded-for': `${spoof}, 8.8.8.8` }))).toBe('8.8.8.8');
  });

  it('trims whitespace around the value', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '9.9.9.9 ,  5.5.5.5  ' }))).toBe('5.5.5.5');
  });

  it('skips empty trailing segments instead of returning ""', () => {
    // A trailing comma is a classic way to make a naive split return empty and
    // collapse every client onto the same "" bucket in the rate limiter.
    expect(getClientIp(req({ 'x-forwarded-for': '4.4.4.4, ,' }))).toBe('4.4.4.4');
  });

  it('handles a single value with no commas', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '7.7.7.7' }))).toBe('7.7.7.7');
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', () => {
    expect(getClientIp(req({ 'x-real-ip': '6.6.6.6' }))).toBe('6.6.6.6');
  });

  it('prefers x-forwarded-for over x-real-ip', () => {
    expect(
      getClientIp(req({ 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '2.2.2.2' })),
    ).toBe('1.1.1.1');
  });

  it('returns "unknown" rather than empty/undefined when no header is present', () => {
    // Every absent IP must collapse to ONE bucket: a limiter keying on "" or
    // "undefined" is still a limiter, but an unloggable one.
    expect(getClientIp(req({}))).toBe('unknown');
  });

  it('ignores a whitespace-only x-real-ip', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '1.1.1.1', 'x-real-ip': '   ' }))).toBe('1.1.1.1');
  });
});

describe('getSiteUrl() / getSiteHost()', () => {
  const original = process.env.NEXT_PUBLIC_SITE_URL;
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = original;
  });

  it('returns the configured origin with no trailing slash', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://dokanstore.xyz/';
    const { getSiteUrl: f } = await import('./site-url');
    expect(f()).toBe('https://dokanstore.xyz'); // one slash only, never two
  });

  it('leaves a clean origin untouched', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://dokanstore.xyz';
    const { getSiteUrl: f } = await import('./site-url');
    expect(f()).toBe('https://dokanstore.xyz');
  });

  it('falls back to localhost ONLY when unset — and never reads a request header', async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    const { getSiteUrl: f } = await import('./site-url');
    expect(f()).toBe('http://localhost:3000');
  });

  it('strips the scheme for the host-only form', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://dokanstore.xyz';
    expect(getSiteHost()).toBe('dokanstore.xyz');
  });
});

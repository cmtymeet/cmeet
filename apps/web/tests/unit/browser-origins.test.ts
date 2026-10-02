import { describe, expect, it } from 'vitest';
import { isVaultHost, memberOriginOf, parseOrigin, resolveVaultOrigins } from '../../src/browser/origins.js';
import { frameSource } from '../../build/csp.js';

describe('exact origin parsing', () => {
  it('accepts exact https origins and local http only when allowed', () => {
    expect(parseOrigin('https://anna.cmeet.example').origin).toBe('https://anna.cmeet.example');
    expect(parseOrigin('http://anna.localhost:4173', { allowInsecureLocal: true }).port).toBe('4173');
    expect(parseOrigin('http://localhost:4173', { allowInsecureLocal: true }).hostname).toBe('localhost');
  });

  it('rejects malformed, insecure, inexact and credentialed origins', () => {
    expect(() => parseOrigin('not an origin')).toThrow('malformed');
    expect(() => parseOrigin('http://anna.cmeet.example')).toThrow('https');
    expect(() => parseOrigin('http://anna.cmeet.example', { allowInsecureLocal: true })).toThrow('https');
    expect(() => parseOrigin('http://anna.localhost:1')).toThrow('https');
    expect(() => parseOrigin('https://anna.cmeet.example/')).toThrow('exact');
    expect(() => parseOrigin('https://anna.cmeet.example/path')).toThrow('exact');
    expect(() => parseOrigin('https://user@anna.cmeet.example')).toThrow('exact');
    expect(() => parseOrigin('https://user:pw@anna.cmeet.example')).toThrow('exact');
    expect(() => parseOrigin('https://Anna.cmeet.example')).toThrow('exact');
  });
});

describe('vault origin derivation', () => {
  it('derives the vault host as a subdomain of the community host', () => {
    expect(resolveVaultOrigins('https://anna.cmeet.example')).toEqual({
      member_origin: 'https://anna.cmeet.example',
      vault_origin: 'https://vault.anna.cmeet.example',
      vault_url: 'https://vault.anna.cmeet.example/',
      popup_url: 'https://vault.anna.cmeet.example/#/ceremony/',
    });
    expect(resolveVaultOrigins('http://anna.localhost:4173', { allowInsecureLocal: true }).vault_origin).toBe('http://vault.anna.localhost:4173');
  });

  it('refuses addresses that are not a community host', () => {
    expect(() => resolveVaultOrigins('https://vault.anna.cmeet.example')).toThrow('community host');
    expect(() => resolveVaultOrigins('https://localhost')).toThrow('community host');
    expect(() => resolveVaultOrigins('https://127.0.0.1')).toThrow('community host');
    expect(() => resolveVaultOrigins('https://[::1]')).toThrow('community host');
    expect(() => resolveVaultOrigins('https://anna.cmeet.example/x')).toThrow('exact');
  });

  it('recognises the vault host by its first label only', () => {
    expect(isVaultHost('vault.anna.cmeet.example')).toBe(true);
    expect(isVaultHost('anna.vault.cmeet.example')).toBe(false);
    expect(isVaultHost('vault.example')).toBe(false);
    expect(isVaultHost('notvault.anna.cmeet.example')).toBe(false);
  });

  it('maps a vault origin back to its member origin', () => {
    expect(memberOriginOf('https://vault.anna.cmeet.example')).toBe('https://anna.cmeet.example');
    expect(memberOriginOf('http://vault.anna.localhost:4173', { allowInsecureLocal: true })).toBe('http://anna.localhost:4173');
    expect(memberOriginOf('https://anna.cmeet.example')).toBeNull();
    expect(() => memberOriginOf('https://vault.anna.cmeet.example/x')).toThrow('exact');
  });
});

describe('frame policy', () => {
  it('allows one exact vault origin in production and none by default', () => {
    expect(frameSource(undefined, false)).toBe("frame-src 'none'");
    expect(frameSource('', false)).toBe("frame-src 'none'");
    expect(frameSource('https://vault.anna.cmeet.example', false)).toBe('frame-src https://vault.anna.cmeet.example');
    expect(() => frameSource('http://vault.anna.cmeet.example', false)).toThrow('exact https origin');
    expect(() => frameSource('https://vault.anna.cmeet.example/x', false)).toThrow('exact https origin');
    expect(frameSource(undefined, true)).toContain('localhost');
  });
});

import { describe, expect, test } from 'bun:test';
import { API_VERSION } from '@pixprite/api';
import { parseManifest, validateManifest } from './manifest';
import { resolvePath, safePath } from './paths';
import { METHODS, missingPermission, PERMISSION_FOR_METHOD } from './protocol';

const manifest = () => ({ id: 'security-test', name: 'Security', version: '1.0.0', apiVersion: API_VERSION });

describe('extension capability boundary', () => {
  test('every protected method rejects a missing capability', () => {
    for (const method of METHODS) {
      const permission = PERMISSION_FOR_METHOD[method];
      expect(missingPermission(method, [], 'https://example.test/file')).toBe(permission === 'network' ? 'network:example.test' : permission);
      if (permission && permission !== 'network') expect(missingPermission(method, [permission])).toBeNull();
    }
    expect(missingPermission('__proto__', [])).toBe('__proto__');
    expect(missingPermission('constructor', [])).toBe('constructor');
  });
  test('network hosts match exactly, including ports; URL credentials and suffixes give no extra access', () => {
    const permissions = ['network:allowed.test', 'network:localhost:4173'];
    for (const url of ['https://allowed.test/', 'https://allowed.test:443/a', 'http://localhost:4173']) expect(missingPermission('net.fetch', permissions, url)).toBeNull();
    for (const url of ['https://allowed.test.evil.test', 'https://allowed.test@evil.test', 'https://allowed.test:444', 'http://localhost:4174', 'invalid']) expect(missingPermission('net.fetch', permissions, url)).not.toBeNull();
    expect(missingPermission('net.fetch', ['network:*'], 'https://other.test')).toBeNull();
  });
});

describe('untrusted package paths and manifests', () => {
  const attacks = ['../main.js', 'a/../../main.js', '/main.js', '//evil.test/main.js', 'https://evil.test/a', 'a\\..\\main.js', '%2e%2e/main.js', 'a/%252e%252e/main.js', 'a?x.js', 'a#x.js', 'a\n.js', 'a/./main.js'];
  test('all package path fields reject traversal and URL rewriting', () => {
    for (const path of attacks) {
      expect(safePath(path)).toBe(false);
      const fields = [
        { entry: path }, { icon: path },
        { contributes: { tools: [{ id: 'a', label: 'a', group: 'a', icon: path }] }, entry: 'main.js' },
        { permissions: ['ui:panel'], contributes: { panels: [{ id: 'a', label: 'a', dock: 'left', page: path }] } },
        { permissions: ['ui:panel'], contributes: { widgets: [{ id: 'a', slot: 'toolbar', page: path }] } },
        { contributes: { locales: path } },
        { contributes: { iconPacks: [{ id: 'icons', label: 'Icons', icons: path }] } },
        { contributes: { languages: [{ code: 'en', name: 'English', dir: 'ltr', dict: path }] } },
        { contributes: { languages: [{ code: 'en', name: 'English', dir: 'ltr', dict: 'en.json', extensions: { a: path } }] } },
      ];
      for (const field of fields) expect(validateManifest({ ...manifest(), ...field }).some(e => e.includes('relative path'))).toBe(true);
    }
    expect(safePath('src/main.ts')).toBe(true);
    expect(safePath('locales/')).toBe(true);
  });
  test('relative import normalization permits internal parents but refuses escapes and encoded separators', () => {
    expect(resolvePath('src/../main.ts')).toBe('main.ts');
    for (const p of ['../secret.ts', 'src/../../secret.ts', 'src/..\\secret.ts', 'src/%2e%2e/secret.ts', '/secret.ts']) expect(resolvePath(p)).toBeNull();
  });
  test('malformed manifests reject before they can become installed code', () => {
    for (const value of [null, [], {}, { ...manifest(), apiVersion: 99 }, { ...manifest(), permissions: 'storage' }, { ...manifest(), permissions: ['unknown'] }, { ...manifest(), contributes: [] }, { ...manifest(), contributes: { panels: [null] } }, { ...manifest(), contributes: { commands: [{ id: 'x', label: 'x' }] } }]) expect(() => parseManifest(value)).toThrow('Invalid manifest');
    expect(parseManifest(manifest()).id).toBe('security-test');
  });
});

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const scan = require('./backup-scan.js');

const rules = (text, allow) => scan.scanText('f.md', text, allow).map((h) => h.rule);
const ghp = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';

describe('secret scan', () => {
  it.each([
    ['private-key', '-----BEGIN RSA PRIVATE KEY-----'],
    ['private-key', '-----BEGIN PRIVATE KEY-----'],
    ['api-key-sk', 'key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv'],
    ['api-key-sk', 'sk-AbCdEfGhIjKlMnOpQrStUvWx'],
    ['github-token', ghp],
    ['github-token', 'github_pat_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0'],
    ['slack-token', 'xoxb-1234567890-abcdefghij'],
    ['aws-access-key', 'AKIAIOSFODNN7EXAMPLE'],
    ['google-api-key', 'AIza' + 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'],
    ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc_def'],
    ['credential-assignment', 'password = hunter2hunter2hunter2'],
    ['credential-assignment', 'api_key: Zk39fj20dkQpa81x'],
    ['credential-assignment', '"client_secret": "Zk39fj20dkQpa81x"'],
    ['credential-assignment', 'DB_PASSWD=Zk39fj20dkQpa81x'],
  ])('flags %s', (rule, text) => {
    expect(rules(text)).toContain(rule);
  });

  it.each([
    'password = <your-password-here>',
    'token: ${GITHUB_TOKEN_VALUE}',
    'secret = xxxxxxxxxxxxxxxx',
    'api_key: changeme-changeme',
    'password: example-password-1',
    'max_tokens: 100000000000',
    'token = process.env.GITHUB_TOKEN',
    'password = short',
    'const secretary = true;',
  ])('ignores placeholder/benign %s', (text) => {
    expect(rules(text)).toEqual([]);
  });
});

describe('private-data scan', () => {
  it('flags e-mail, phone, IBAN, card', () => {
    expect(rules('mail me: jane.doe@example.org')).toContain('email');
    expect(rules('call +49 170 1234567')).toContain('phone');
    expect(rules('call 0170 1234567')).toContain('phone');
    expect(rules('call 030 123456')).toContain('phone');
    expect(rules('IBAN DE89 3704 0044 0532 0130 00')).toContain('iban');
    expect(rules('DE89370400440532013000')).toContain('iban');
    expect(rules('card 4111 1111 1111 1111')).toContain('credit-card');
    expect(rules('card 4111111111111111')).toContain('credit-card');
    expect(rules('amex 3782 822463 10005')).toContain('credit-card');
  });

  it.each([
    'version 1.2.3 and v10.20.30-beta.4',
    'released 2026-10-19 at 12:30:45',
    'date 19.10.2026 / 2026/10/19',
    'sha 9fceb02d0ae598e95dc970b74767f19372d61af8',
    'sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    'id 123e4567-e89b-12d3-a456-426614174000',
    'ts 1760875800000',
    'big 12345678901234567890',
    'range 0.12.345 and 10-20-30',
    'npm @scope/package@1.2.3',
    'build 20261019123045',
  ])('does not flag %s', (text) => {
    expect(rules(text)).toEqual([]);
  });

  it('validates checksums', () => {
    expect(scan.luhnValid('4111 1111 1111 1111')).toBe(true);
    expect(scan.luhnValid('4111 1111 1111 1112')).toBe(false);
    expect(scan.ibanValid('DE89 3704 0044 0532 0130 00')).toBe(true);
    expect(scan.ibanValid('DE89 3704 0044 0532 0130 01')).toBe(false);
    expect(rules('DE89 3704 0044 0532 0130 01')).not.toContain('iban');
    expect(rules('card 4111 1111 1111 1112')).not.toContain('credit-card');
  });
});

describe('allow file', () => {
  const text = 'Contact a@b.org\nsecond line ' + ghp + '\n';

  it('is strict when empty', () => {
    expect(scan.scanText('f.md', text, scan.parseAllow('')).length).toBe(2);
  });

  it('skips a file by glob, with comments ignored', () => {
    const allow = scan.parseAllow('# note\nagents/*.md\n');
    expect(scan.scanText('agents/x.md', text, allow)).toEqual([]);
    expect(scan.scanText('skills/x.md', text, allow).length).toBe(2);
  });

  it('skips one rule in a file', () => {
    const allow = scan.parseAllow('f.md:email');
    expect(scan.scanText('f.md', text, allow).map((h) => h.rule)).toEqual(['github-token']);
  });

  it('allows one value by sha256 only', () => {
    const allow = scan.parseAllow(`value-sha256:${scan.sha256('a@b.org')}`);
    expect(scan.scanText('f.md', text, allow).map((h) => h.rule)).toEqual(['github-token']);
  });

  it('anchors leading-slash globs and handles **', () => {
    const allow = scan.parseAllow('/notes/**/*.md');
    expect(scan.scanText('notes/a/b.md', text, allow)).toEqual([]);
    expect(scan.scanText('x/notes/a/b.md', text, allow).length).toBe(2);
  });
});

describe('hits and files', () => {
  it('carry file, line, rule and never the value', () => {
    const hits = scan.scanText('a/b.md', `ok\n${ghp}\nmail x@y.org`);
    expect(hits).toEqual([
      { file: 'a/b.md', line: 2, rule: 'github-token' },
      { file: 'a/b.md', line: 3, rule: 'email' },
    ]);
    expect(JSON.stringify(hits)).not.toContain('ghp_');
    expect(JSON.stringify(hits)).not.toContain('x@y.org');
  });

  it('reports binary and oversized files as unscannable, allowlistable', () => {
    const bin = Buffer.from([1, 2, 0, 3]);
    expect(scan.scanBuffer('a.bin', bin)).toEqual([{ file: 'a.bin', line: 0, rule: 'unscannable' }]);
    const big = Buffer.alloc(scan.MAX_BYTES + 1, 97);
    expect(scan.scanBuffer('big.txt', big)[0].rule).toBe('unscannable');
    expect(scan.scanBuffer('a.bin', bin, scan.parseAllow('a.bin:unscannable'))).toEqual([]);
    expect(scan.scanBuffer('a.bin', bin, scan.parseAllow('*.bin'))).toEqual([]);
  });

  it('scans text buffers', () => {
    expect(scan.scanBuffer('a.md', Buffer.from(ghp))[0].rule).toBe('github-token');
  });
});

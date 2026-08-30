import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionConfigErrors, assertProductionConfig, DEFAULT_AUTH_SECRET, type BootConfig } from '../src/env.js';
import { clientIpKey } from '../src/rateLimit.js';
import { normalizeTeamDomain, accessCertsUrl, emailFromPayload } from '../src/accessJwt.js';

const base: BootConfig = {
  nodeEnv: 'production',
  authProvider: 'session',
  authSecret: 'a-long-random-production-secret',
  cfAccessTeamDomain: '',
  cfAccessAud: '',
};

test('the production guard is silent outside production', () => {
  const dev: BootConfig = { ...base, nodeEnv: 'development', authSecret: DEFAULT_AUTH_SECRET, authProvider: 'cloudflare-access' };
  assert.deepEqual(productionConfigErrors(dev), []);
  assert.doesNotThrow(() => assertProductionConfig(dev));
});

test('production refuses the default or empty AUTH_SECRET', () => {
  assert.equal(productionConfigErrors({ ...base, authSecret: DEFAULT_AUTH_SECRET }).length, 1);
  assert.equal(productionConfigErrors({ ...base, authSecret: '' }).length, 1);
  assert.throws(() => assertProductionConfig({ ...base, authSecret: DEFAULT_AUTH_SECRET }), /AUTH_SECRET/);
  assert.deepEqual(productionConfigErrors(base), []);
});

test('production Access mode requires the team domain and audience', () => {
  const access: BootConfig = { ...base, authProvider: 'cloudflare-access' };
  assert.equal(productionConfigErrors(access).length, 2);
  assert.equal(productionConfigErrors({ ...access, cfAccessTeamDomain: 'https://x.cloudflareaccess.com' }).length, 1);
  assert.deepEqual(
    productionConfigErrors({ ...access, cfAccessTeamDomain: 'https://x.cloudflareaccess.com', cfAccessAud: 'abc123' }),
    [],
  );
  // Session mode does not need them.
  assert.deepEqual(productionConfigErrors(base), []);
});

test('clientIpKey prefers CF-Connecting-IP over the socket address', () => {
  assert.equal(clientIpKey({ headers: { 'cf-connecting-ip': '203.0.113.7' }, ip: '10.0.0.1' }), '203.0.113.7');
  assert.equal(clientIpKey({ headers: { 'cf-connecting-ip': '  203.0.113.7  ' }, ip: '10.0.0.1' }), '203.0.113.7');
  assert.equal(clientIpKey({ headers: { 'cf-connecting-ip': ['203.0.113.7', '198.51.100.2'] }, ip: '10.0.0.1' }), '203.0.113.7');
});

test('clientIpKey falls back to req.ip, and never to an empty key', () => {
  assert.equal(clientIpKey({ headers: {}, ip: '10.0.0.1' }), '10.0.0.1');
  assert.equal(clientIpKey({ headers: { 'cf-connecting-ip': '   ' }, ip: '10.0.0.1' }), '10.0.0.1');
  assert.equal(clientIpKey({ headers: {} }), 'unknown');
});

test('clientIpKey buckets IPv6 by /56 rather than by address', () => {
  const a = clientIpKey({ headers: { 'cf-connecting-ip': '2001:db8:1234:5678::1' } });
  const b = clientIpKey({ headers: { 'cf-connecting-ip': '2001:db8:1234:5678::99' } });
  assert.equal(a, b);
  assert.notEqual(a, clientIpKey({ headers: { 'cf-connecting-ip': '2001:db8:9999:5678::1' } }));
});

test('normalizeTeamDomain yields the issuer Access actually stamps', () => {
  assert.equal(normalizeTeamDomain('https://ethandbard.cloudflareaccess.com'), 'https://ethandbard.cloudflareaccess.com');
  assert.equal(normalizeTeamDomain('https://ethandbard.cloudflareaccess.com/'), 'https://ethandbard.cloudflareaccess.com');
  assert.equal(normalizeTeamDomain(' ethandbard.cloudflareaccess.com '), 'https://ethandbard.cloudflareaccess.com');
  assert.equal(normalizeTeamDomain(''), '');
  assert.equal(
    accessCertsUrl('ethandbard.cloudflareaccess.com/'),
    'https://ethandbard.cloudflareaccess.com/cdn-cgi/access/certs',
  );
});

test('emailFromPayload requires both an expiry and an email claim', () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  assert.equal(emailFromPayload({ exp, email: 'ethan@thebardfamily.com' }), 'ethan@thebardfamily.com');
  // A service-token assertion carries no email — it is nobody, not everybody.
  assert.equal(emailFromPayload({ exp, common_name: 'ci-runner' }), null);
  // A token with no expiry would never age out.
  assert.equal(emailFromPayload({ email: 'ethan@thebardfamily.com' }), null);
  assert.equal(emailFromPayload({ exp, email: '' }), null);
});

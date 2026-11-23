import assert from 'node:assert/strict';
import test from 'node:test';
import { sitesIdentity } from '../server/sites-identity.mjs';

test('hosted owner identity survives internal routing and distinguishes missing and viewer sessions', () => {
  const env = { SITES_MANAGED_IDENTITY: 'enabled', OWNER_EMAIL: 'owner@example.test' };
  const request = headers => new Request('https://worker.internal/isletme', { headers });
  const owner = request({ 'oai-authenticated-user-id': 'subject', 'oai-authenticated-user-email': 'Owner@example.test' });
  assert.equal(sitesIdentity(owner, env).OWNER_HOSTED_IDENTITY, 'owner');
  assert.deepEqual(sitesIdentity(owner, { OWNER_EMAIL: env.OWNER_EMAIL }), {});
  assert.equal(sitesIdentity(request({ 'oai-authenticated-user-email': env.OWNER_EMAIL }), env).OWNER_HOSTED_IDENTITY, 'missing');
  const viewer = request({ 'oai-authenticated-user-id': 'viewer', 'oai-authenticated-user-email': 'other@example.test' });
  assert.deepEqual(sitesIdentity(viewer, env), { OWNER_HOSTED_IDENTITY: 'other' });
});

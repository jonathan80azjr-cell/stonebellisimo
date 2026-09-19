import assert from 'node:assert/strict';
import test from 'node:test';
import { deterministicIdentityLeadId, leadIdentityKeys, normalizeLeadEmail, normalizeLeadPhone, normalizeLeadSurname } from '../src/lead-identity.mjs';

test('lead identities normalize deterministically without exposing contact values', () => {
  assert.equal(normalizeLeadEmail(' Ada@Example.COM '), 'ada@example.com');
  assert.equal(normalizeLeadPhone('(201) 555-0100'), '+12015550100');
  assert.equal(normalizeLeadSurname(" O'Connor "), 'oconnor');
  const first = leadIdentityKeys({ email: 'Ada@example.com', phone: '201-555-0100', lastName: 'Stone' });
  const second = leadIdentityKeys({ email: 'ada@example.com', phone: '+1 201 555 0100', lastName: 'stone' });
  assert.deepEqual(first, second);
  assert.deepEqual(first.map(identity => identity.type), ['phone_surname', 'email']);
  assert.equal(first.some(identity => identity.id.includes('ada@example.com')), false);
  assert.equal(deterministicIdentityLeadId('instagram:account:contact'), deterministicIdentityLeadId('instagram:account:contact'));
});

test('a household phone is never an automatic identity without a matching surname', () => {
  const withoutSurname = leadIdentityKeys({ phone: '201-555-0100' });
  const stone = leadIdentityKeys({ phone: '201-555-0100', lastName: 'Stone' });
  const rivera = leadIdentityKeys({ phone: '201-555-0100', lastName: 'Rivera' });
  assert.equal(withoutSurname.some(identity => identity.type.includes('phone')), false);
  assert.notEqual(stone.find(identity => identity.type === 'phone_surname').id, rivera.find(identity => identity.type === 'phone_surname').id);
});

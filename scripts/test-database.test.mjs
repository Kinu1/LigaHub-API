import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  testDatabaseEnvironment,
  validateTestDatabaseUrl,
} from './test-database.mjs';

const url = (name, host = '127.0.0.1') =>
  `postgresql://fixture:secret@${host}:5433/${name}?schema=public`;

test('test URL is mandatory, even when application URL exists', () => {
  assert.throws(
    () => testDatabaseEnvironment({ DATABASE_URL: url('ligahub') }),
    /DATABASE_TEST_URL/,
  );
});
test('rejects habitual application database and ambiguous names', () => {
  for (const name of [
    'ligahub',
    'contest',
    'latest',
    'testproduction',
    'productiontest',
  ])
    assert.throws(
      () => validateTestDatabaseUrl(url(name)),
      /identificar teste/,
    );
});
test('accepts explicitly identified dedicated databases', () => {
  for (const name of [
    'ligahub_test',
    'ligahub_browser_test',
    'test_ligahub',
    'ligahub-tests',
  ]) {
    assert.equal(
      testDatabaseEnvironment({
        DATABASE_TEST_URL: url(name),
        DATABASE_URL: url('ligahub'),
      }).DATABASE_URL,
      url(name),
    );
  }
});
test('rejects application database aliases, alternate schemas and direct URL', () => {
  const selected = url('ligahub_test');
  assert.throws(
    () =>
      testDatabaseEnvironment({
        DATABASE_TEST_URL: selected,
        DATABASE_URL: url('ligahub_test', 'localhost').replace(
          'public',
          'other',
        ),
      }),
    /diferente/,
  );
  assert.throws(
    () =>
      testDatabaseEnvironment({
        DATABASE_TEST_URL: selected,
        DIRECT_URL: selected,
      }),
    /diferente/,
  );
});
test('CI retains its existing exclusive service database', () => {
  const selected = url('ligahub_browser_test');
  assert.equal(
    testDatabaseEnvironment({
      DATABASE_TEST_URL: selected,
      DATABASE_URL: selected,
      CI: 'true',
      GITHUB_ACTIONS: 'true',
    }).DIRECT_URL,
    selected,
  );
  assert.throws(
    () =>
      testDatabaseEnvironment({
        DATABASE_TEST_URL: url('ligahub'),
        CI: 'true',
        GITHUB_ACTIONS: 'true',
      }),
    /identificar teste/,
  );
});
test('rejects remote hosts, wrong protocol and query overrides without leaking secrets', () => {
  for (const selected of [
    url('ligahub_test', 'db.example.com'),
    'https://fixture:secret@localhost/ligahub_test',
    `${url('ligahub_test')}&host=db.example.com`,
    'secret',
  ]) {
    assert.throws(
      () => validateTestDatabaseUrl(selected),
      (error) => !error.message.includes('secret'),
    );
  }
});

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseDatabase(value) {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
    const name = decodeURIComponent(url.pathname.slice(1));
    if (!name || name.includes('/')) throw new Error();
    if (
      [...url.searchParams.keys()].some((key) =>
        [
          'host',
          'port',
          'database',
          'dbname',
          'user',
          'password',
          'options',
        ].includes(key.toLowerCase()),
      )
    )
      throw new Error();
    return { url, name };
  } catch {
    throw new Error(
      'URL de banco de testes inválida; valores de conexão foram ocultados.',
    );
  }
}

export function validateTestDatabaseUrl(value) {
  if (!value?.trim())
    throw new Error(
      'Configure DATABASE_TEST_URL explicitamente; DATABASE_URL não é usada como alternativa.',
    );
  const { url, name } = parseDatabase(value);
  if (!localHosts.has(url.hostname))
    throw new Error(
      'DATABASE_TEST_URL exige PostgreSQL local ou do job de CI.',
    );
  if (!/(^|[_-])tests?([_-]|$)/i.test(name))
    throw new Error(
      'O nome do banco em DATABASE_TEST_URL deve identificar teste: use, por exemplo, ligahub_test.',
    );
  return url.toString();
}

function sameDatabase(left, right) {
  const a = parseDatabase(left);
  const b = parseDatabase(right);
  const host = (url) =>
    localHosts.has(url.hostname) ? 'loopback' : url.hostname;
  return (
    host(a.url) === host(b.url) &&
    (a.url.port || '5432') === (b.url.port || '5432') &&
    a.name === b.name
  );
}

export function testDatabaseEnvironment(environment = process.env) {
  const selected = validateTestDatabaseUrl(environment.DATABASE_TEST_URL);
  // No GitHub Actions, DATABASE_URL já aponta para o serviço exclusivo criado pelo job.
  const exclusiveCi =
    environment.GITHUB_ACTIONS === 'true' && environment.CI === 'true';
  for (const application of [
    environment.DATABASE_URL,
    environment.DIRECT_URL,
  ]) {
    if (application && sameDatabase(selected, application) && !exclusiveCi)
      throw new Error(
        'DATABASE_TEST_URL deve apontar para um banco diferente de DATABASE_URL e DIRECT_URL.',
      );
  }
  return { DATABASE_URL: selected, DIRECT_URL: selected };
}

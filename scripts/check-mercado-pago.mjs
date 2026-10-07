import 'dotenv/config';

let failures = 0;
function report(name, valid, message) {
  console.log(`${valid ? 'OK' : 'PENDENTE'} ${name}: ${message}`);
  if (!valid) failures++;
}

function required(name) {
  const value = process.env[name]?.trim();
  const valid =
    Boolean(value) &&
    !/SUBSTITUA|troque|segredo-da|identificador-da/i.test(value);
  report(
    name,
    valid,
    valid ? 'preenchido; valor oculto.' : 'preencha no .env local.',
  );
}

function endpoint(name, expectedPath) {
  let valid = false;
  try {
    const url = new URL(process.env[name] ?? '');
    valid =
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      url.pathname === expectedPath &&
      !url.search &&
      !url.hash &&
      !/(^|\.)(localhost|example|invalid|test)$|^127\.|^\[::1\]$/i.test(
        url.hostname,
      ) &&
      !/SEU_HOST|SUA_API/i.test(url.hostname);
  } catch {
    // Não exponha uma URL inválida, pois ela pode conter credenciais.
  }
  report(
    name,
    valid,
    valid
      ? 'formato HTTPS válido; acessibilidade externa ainda não verificada.'
      : `configure uma URL pública HTTPS com o caminho ${expectedPath}.`,
  );
}

console.log('Verificação local do Mercado Pago (sem chamadas ao provedor).');
const fixedAccount = Boolean(
  process.env.MERCADO_PAGO_TEST_ACCESS_TOKEN ||
  process.env.MERCADO_PAGO_TEST_PUBLIC_KEY,
);
if (fixedAccount) {
  required('MERCADO_PAGO_TEST_ACCESS_TOKEN');
  required('MERCADO_PAGO_TEST_PUBLIC_KEY');
  report(
    'Conta fixa de teste',
    process.env.MERCADO_PAGO_TEST_MODE === 'true',
    'exige MERCADO_PAGO_TEST_MODE=true explicitamente.',
  );
} else {
  required('MERCADO_PAGO_CLIENT_ID');
  required('MERCADO_PAGO_CLIENT_SECRET');
}
required('MERCADO_PAGO_WEBHOOK_SECRET');
if (!fixedAccount)
  endpoint('MERCADO_PAGO_REDIRECT_URI', '/payments/accounts/callback');
endpoint('MERCADO_PAGO_NOTIFICATION_URL', '/payments/webhook');

const key = process.env.CREDENTIALS_ENCRYPTION_KEY ?? '';
const validKey =
  /^[A-Za-z0-9+/]{43}=$/.test(key) && Buffer.from(key, 'base64').length === 32;
report(
  'CREDENTIALS_ENCRYPTION_KEY',
  validKey,
  validKey
    ? 'chave de 32 bytes em base64; valor oculto.'
    : 'execute npm.cmd run env:init; preserve a chave de contas já conectadas.',
);

const mode = process.env.MERCADO_PAGO_TEST_MODE ?? 'true';
report(
  'MERCADO_PAGO_TEST_MODE',
  mode === 'true' || mode === 'false',
  mode === 'true'
    ? 'ambiente de teste selecionado.'
    : mode === 'false'
      ? 'ambiente de produção selecionado; permite cobranças reais.'
      : 'use true para testes ou false para produção.',
);

console.log(
  failures
    ? `${failures} pendência(s). A configuração ainda não está pronta para o roteiro de pagamentos.`
    : 'Configuração local preenchida. Próximo passo: conectar o organizador e testar o fluxo no provedor.',
);
console.log(
  'Este comando não valida credenciais, recebimento de webhooks ou pagamentos.',
);
process.exitCode = failures ? 1 : 0;

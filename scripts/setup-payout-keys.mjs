// Gera chaves locais sem imprimir a chave privada nem ativar transferências.
import {
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'dotenv';

const directory = resolve('.test-temp', 'mercado-pago-payouts');
mkdirSync(directory, { recursive: true });
const privatePath = resolve(directory, 'private.pem');
const publicPath = resolve(directory, 'public.pem');
if (!existsSync(privatePath)) {
  if (existsSync(publicPath))
    throw new Error(
      'Chave pública existente sem chave privada; restaure o par antes de continuar.',
    );
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  writeFileSync(
    privatePath,
    privateKey.export({ type: 'pkcs8', format: 'pem' }),
    { flag: 'wx', mode: 0o600 },
  );
  writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), {
    flag: 'wx',
  });
}
const privatePem = readFileSync(privatePath);
const privateKey = createPrivateKey(privatePem);
if (privateKey.asymmetricKeyType !== 'ed25519')
  throw new Error('Algoritmo da chave existente inválido.');
const publicPem = createPublicKey(privateKey).export({
  type: 'spki',
  format: 'pem',
});
if (existsSync(publicPath) && readFileSync(publicPath, 'utf8') !== publicPem)
  throw new Error('As chaves existentes não pertencem ao mesmo par.');
if (!existsSync(publicPath))
  writeFileSync(publicPath, publicPem, { flag: 'wx' });
const body = Buffer.from('validacao-local-ligahub');
if (
  !verify(null, body, createPublicKey(privateKey), sign(null, body, privateKey))
)
  throw new Error('Falha na validação local da assinatura.');

if (process.argv.includes('--configure-local')) {
  const envPath = resolve('.env');
  const previous = readFileSync(envPath, 'utf8');
  const env = parse(previous);
  const encoded = privatePem.toString('base64');
  if (
    env.MERCADO_PAGO_PAYOUTS_PRIVATE_KEY_BASE64 &&
    env.MERCADO_PAGO_PAYOUTS_PRIVATE_KEY_BASE64 !== encoded
  )
    throw new Error(
      'A configuração já possui outra chave; nenhuma credencial foi substituída.',
    );
  let next = previous;
  const put = (name, value) => {
    const pattern = new RegExp(`^${name}=.*$`, 'm');
    next = pattern.test(next)
      ? next.replace(pattern, `${name}=${value}`)
      : `${next.trimEnd()}\n${name}=${value}\n`;
  };
  put('MERCADO_PAGO_PAYOUTS_PRIVATE_KEY_BASE64', encoded);
  // Não modifica flags já existentes. Uma configuração nova começa desativada.
  if (env.MERCADO_PAGO_PAYOUTS_ENABLED === undefined)
    put('MERCADO_PAGO_PAYOUTS_ENABLED', 'false');
  if (env.MERCADO_PAGO_PIX_PLATFORM_ACCOUNT_ID === undefined)
    put('MERCADO_PAGO_PIX_PLATFORM_ACCOUNT_ID', '');
  writeFileSync(envPath, next);
  console.log(
    'Chave privada configurada no .env local. Flags existentes preservadas.',
  );
}
console.log(`Chave pública para a equipe de Integrações: ${publicPath}`);
console.log(
  'Validação local da assinatura aprovada. Isso não comprova habilitação no Mercado Pago.',
);

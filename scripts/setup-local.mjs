import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const path = '.env';
let contents = existsSync(path) ? readFileSync(path, 'utf8') : readFileSync('.env.example', 'utf8');
for (const [name, value] of Object.entries({ JWT_SECRET: randomBytes(48).toString('hex'), CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64') })) {
  const match = new RegExp(`^${name}=(.*)$`, 'm').exec(contents);
  if (!match || !match[1] || match[1].includes('SUBSTITUA')) {
    contents = match ? contents.replace(match[0], `${name}=${value}`) : `${contents.trimEnd()}\n${name}=${value}\n`;
  }
}
writeFileSync(path, contents, { mode: 0o600 });
console.log('Configuração local preparada; segredos existentes foram preservados.');

// Medição do build de produção com fixtures fictícias e cache frio por tela.
// Uso: node scripts/frontend-performance.mjs [diretório do dist] [arquivo JSON] [--baseline]
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const root = resolve(process.argv[2] ?? 'frontend/dist');
const verifyLazyCard = process.argv[4] !== '--baseline';
const server = createServer(async (req, res) => {
  try {
    let path = resolve(
      root,
      `.${new URL(req.url, 'http://localhost').pathname}`,
    );
    if (!path.startsWith(root + sep)) path = resolve(root, 'index.html');
    let body;
    try {
      body = await readFile(path);
    } catch {
      path = resolve(root, 'index.html');
      body = await readFile(path);
    }
    const type =
      {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.woff2': 'font/woff2',
      }[extname(path)] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Encoding': 'gzip',
      'Cache-Control': 'no-store',
    });
    res.end(gzipSync(body));
  } catch {
    res.writeHead(500);
    res.end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
const event = {
  publicId: '7610c4b6-ec08-4fce-9335-b2357ca2eaba',
  title: 'Jornada de teste',
  description: 'Fixture de desempenho',
  location: 'Auditório',
  startsAt: '2030-10-08T15:00:00Z',
  priceInCents: 2500,
  availableSpots: 10,
  acceptingRegistrations: true,
  form: [],
  status: 'published',
};
const registration = {
  id: 'fixture',
  name: 'Participante de teste',
  email: 'teste@example.com',
  status: 'reserved',
  priceInCents: 2500,
  reservationExpiresAt: '2030-10-08T15:00:00Z',
  event,
  payments: [],
  answers: {},
};
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [screen, path, ready] of [
    ['evento', `/eventos/${event.publicId}`, 'Nome completo'],
    ['recuperacao', '/recuperar', 'Seu e-mail'],
    ['pagamento-pix', '/inscricao/fixture', 'CPF do pagador'],
  ]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const sdkRequests = [];
    await page.route('**/api/**', (route) => {
      const url = new URL(route.request().url());
      const value = url.pathname.endsWith('/browser/csrf')
        ? { token: 'fixture' }
        : url.pathname.endsWith('/checkout')
          ? {
              publicKey: 'TEST-fixture',
              amountInCents: 2500,
              maxInstallments: 3,
            }
          : url.pathname.includes('/public/events/')
            ? event
            : registration;
      return route.fulfill({ json: value });
    });
    // Isola os recursos externos: a medição cobre apenas o JS do build local.
    await page.route(/https:\/\//, (route) => {
      sdkRequests.push(route.request().url());
      return route.abort();
    });
    const session = await context.newCDPSession(page);
    await session.send('Network.enable');
    const scripts = new Set();
    const cardChunks = new Set();
    const bytes = new Map();
    session.on('Network.responseReceived', ({ requestId, type, response }) => {
      if (type === 'Script' && response.url.startsWith(origin))
        scripts.add(requestId);
      if (type === 'Script' && response.url.includes('/card-checkout-'))
        cardChunks.add(requestId);
    });
    session.on('Network.loadingFinished', ({ requestId, encodedDataLength }) =>
      bytes.set(requestId, encodedDataLength),
    );
    await page.goto(origin + path);
    await page.getByLabel(ready, { exact: true }).waitFor();
    await page.waitForLoadState('networkidle');
    const measure = (name) => ({
      screen: name,
      jsRequests: scripts.size,
      jsTransferBytes: [...scripts].reduce(
        (sum, id) => sum + (bytes.get(id) ?? 0),
        0,
      ),
      externalSdkRequests: sdkRequests.length,
      cardSdkChunks: cardChunks.size,
    });
    results.push(measure(screen));
    assert.equal(
      sdkRequests.length,
      0,
      'SDK externo carregado antes de abrir cartão',
    );
    if (verifyLazyCard)
      assert.equal(
        cardChunks.size,
        0,
        'Módulo do cartão carregado antecipadamente',
      );
    if (screen === 'pagamento-pix') {
      await page
        .getByLabel('Nome completo do pagador', { exact: true })
        .fill('Pagador de teste');
      await page
        .getByLabel('CPF do pagador', { exact: true })
        .fill('52998224725');
      await page.getByRole('button', { name: 'Cartão', exact: true }).click();
      await page.waitForTimeout(1500);
      if (verifyLazyCard)
        assert.equal(cardChunks.size, 1, 'Módulo do cartão não foi solicitado');
      results.push(measure('pagamento-cartao'));
      await page.getByRole('button', { name: 'Pix', exact: true }).click();
      assert.equal(
        await page
          .getByLabel('Nome completo do pagador', { exact: true })
          .inputValue(),
        'Pagador de teste',
      );
      assert.equal(
        await page.getByLabel('CPF do pagador', { exact: true }).inputValue(),
        '52998224725',
      );
    }
    await context.close();
  }
  const report = {
    method:
      'Chromium CDP encodedDataLength, gzip HTTP, cold context per screen, API fixture, external SDK blocked',
    results,
  };
  console.log(JSON.stringify(report, null, 2));
  if (process.argv[3])
    await writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n');
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}

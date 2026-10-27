import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

async function control(
  request: APIRequestContext,
  path: string,
  method: 'GET' | 'POST' = 'POST',
) {
  const response = await request.fetch(
    `http://127.0.0.1:3100/__browser/${path}`,
    {
      method,
      headers: { 'x-browser-test': 'controle-local-de-testes' },
    },
  );
  expect(
    response.ok(),
    `Controle ${path}: HTTP ${response.status()}`,
  ).toBeTruthy();
  return response.json();
}
async function reserve(page: Page, publicId: string) {
  await page.goto(`/eventos/${publicId}`);
  await page
    .getByLabel('Nome completo', { exact: true })
    .fill('Ana Participante');
  await page.getByLabel(/E-mail/).fill('ana@example.com');
  await page.getByRole('button', { name: /Revisar minha/ }).click();
  await page.getByRole('button', { name: /Reservar e escolher/ }).click();
  await expect(page).toHaveURL(/\/inscricao\/[0-9a-f-]+$/);
  await expect(
    page.getByRole('heading', { name: 'Como você prefere pagar?' }),
  ).toBeVisible();
  return new URL(page.url()).pathname.split('/').pop()!;
}
async function pay(page: Page) {
  await page.getByLabel(/CPF do pagador/).fill('12345678909');
  await page.getByRole('button', { name: 'Revisar pagamento Pix' }).click();
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
}
async function reviewCard(page: Page, installments = '3') {
  await page.getByRole('button', { name: 'Cartão', exact: true }).click();
  await page
    .getByLabel('Parcelas do cartão de teste')
    .selectOption(installments);
  await page.getByRole('button', { name: 'Revisar cartão de teste' }).click();
  await expect(
    page.getByRole('heading', { name: 'Revise o pagamento' }),
  ).toBeVisible();
  await expect(
    page.getByText(`Cartão em ${installments} parcela(s)`, { exact: false }),
  ).toBeVisible();
}

test('cartão simulado preserva parcelas na revisão e confirma após aprovação', async ({
  page,
  request,
}, info) => {
  const fixture = await control(request, 'fixture');
  const id = await reserve(page, fixture.publicId);
  await reviewCard(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('revisao-cartao.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(page.getByText('Pendente', { exact: true })).toBeVisible();
  expect((await control(request, 'charges', 'GET')).payments).toEqual([
    { method: 'card', installments: 3, amount: 25, status: 'pending' },
  ]);
  await control(request, `payments/${id}/approved`);
  await page.getByRole('button', { name: 'Atualizar situação' }).click();
  await expect(page.getByText('Confirmada', { exact: true })).toBeVisible();
});

test('cartão recusado permite nova tentativa com outra chave', async ({
  page,
  request,
}) => {
  const fixture = await control(request, 'fixture');
  await reserve(page, fixture.publicId);
  await control(request, 'reject-payment');
  const keys: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/payments'))
      keys.push(req.headers()['idempotency-key']);
  });
  await reviewCard(page);
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(page.getByText('Recusado', { exact: true })).toBeVisible();
  await reviewCard(page, '2');
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(page.getByText('Pendente', { exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).not.toBe(keys[0]);
  expect((await control(request, 'charges', 'GET')).payments).toEqual([
    { method: 'card', installments: 3, amount: 25, status: 'rejected' },
    { method: 'card', installments: 2, amount: 25, status: 'pending' },
  ]);
});

test('resposta incerta de cartão repete chave e token sem nova cobrança', async ({
  page,
  request,
}) => {
  const fixture = await control(request, 'fixture');
  await reserve(page, fixture.publicId);
  await control(request, 'lose-response');
  const submitted: { key: string; token: string; installments: number }[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/payments')) {
      const body = req.postDataJSON();
      submitted.push({
        key: req.headers()['idempotency-key'],
        token: body.cardToken,
        installments: body.installments,
      });
    }
  });
  await reviewCard(page);
  await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(
    page.getByRole('button', { name: 'Repetir mesma tentativa' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Revisar cartão de teste' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Repetir mesma tentativa' }).click();
  await expect(page.getByText('Pendente', { exact: true })).toBeVisible();
  expect(submitted).toHaveLength(2);
  expect(submitted[0]).toEqual(submitted[1]);
  expect(submitted[0].key).toBeTruthy();
  expect(submitted[0].token).toMatch(/^token-ficticio-/);
  expect(submitted[0].installments).toBe(3);
  expect((await control(request, 'charges', 'GET')).createdCharges).toBe(1);
});
test('administrador filtra o financeiro e a API recusa filtros inválidos', async ({
  page,
  request,
}, info) => {
  const fixture = await control(request, 'fixture');
  await reserve(page, fixture.publicId);
  await pay(page);
  await expect(page.getByText('Pendente', { exact: true })).toBeVisible();
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(fixture.email);
  await page
    .getByLabel('Senha', { exact: true })
    .fill('Senha-exclusiva-do-teste');
  await page.getByRole('button', { name: /Entrar no painel/ }).click();
  await expect(page).toHaveURL(/\/painel$/);
  await page.goto('/painel/financeiro');
  await page
    .getByLabel('Evento', { exact: true })
    .fill('Jornada de teste no navegador');
  await page
    .getByLabel('Forma de pagamento', { exact: true })
    .selectOption('pix');
  await page
    .getByLabel('Estado do pagamento', { exact: true })
    .selectOption('pending');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(
    page.getByRole('cell', { name: 'Jornada de teste no navegador' }),
  ).toBeVisible();
  await page
    .getByLabel('Estado do pagamento', { exact: true })
    .selectOption('refunded');
  await page.getByRole('button', { name: 'Aplicar filtros' }).click();
  await expect(
    page.getByRole('heading', { name: 'Nenhum pagamento encontrado' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await expect(
    page.getByRole('cell', { name: 'Jornada de teste no navegador' }),
  ).toBeVisible();
  for (const query of [
    'page=1&page=2',
    'status=confirmed',
    'method=boleto',
    'from=2026-02-30T03:00:00Z',
    'ownerId=alheio',
  ]) {
    const response = await page.request.get(`/api/payments?${query}`, {
      headers: { 'x-browser-client': '1' },
    });
    expect(response.status()).toBe(400);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('filtros-financeiros.png'),
    fullPage: true,
  });
  expect(
    (await request.get('http://127.0.0.1:3100/admin/operations')).status(),
  ).toBe(401);
  await page.goto('/painel/operacao');
  await expect(
    page.getByRole('heading', { name: 'Operação e rotinas' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Links de acesso e gestão' }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Aceito pelo provedor não significa entregue na caixa de entrada do participante.',
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('operacao.png'),
    fullPage: true,
  });
});

test.afterEach(async ({ request }) => {
  await control(request, 'cleanup');
});

test('reserva, acesso por e-mail, Pix, confirmação, cancelamento e reembolso', async ({
  page,
  request,
  context,
}, info) => {
  const fixture = await control(request, 'fixture');
  const id = await reserve(page, fixture.publicId);
  const messages = await control(request, 'messages', 'GET');
  const accessLink = messages[0].text.match(
    /http:\/\/localhost:3101\/inscricao\/\S+/,
  )![0];
  await context.clearCookies();
  await page.goto('about:blank');
  await page.goto(accessLink);
  await expect(page).toHaveURL(new RegExp(`/inscricao/${id}$`));
  await expect(
    page.getByRole('heading', { name: 'Como você prefere pagar?' }),
  ).toBeVisible();
  const cookies = await context.cookies();
  expect(
    cookies.find((c) => c.name === `lh_registration_${id}`)?.httpOnly,
  ).toBe(true);
  await page.goto('about:blank');
  await page.goto(accessLink);
  await expect(
    page.getByText(/O link expirou ou já foi utilizado/),
  ).toBeVisible();
  await page.goto(`/inscricao/${id}`);
  await pay(page);
  await expect(page.getByText('Pendente', { exact: true })).toBeVisible();
  await control(request, `payments/${id}/approved`);
  await page.getByRole('button', { name: 'Atualizar situação' }).click();
  await expect(page.getByText('Confirmada', { exact: true })).toBeVisible();
  await page
    .getByRole('button', { name: 'Solicitar cancelamento', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmar', exact: true })
    .click();
  await expect(
    page.getByText(/Solicitação de cancelamento registrada/),
  ).toBeVisible();
  await control(request, `payments/${id}/refunded`);
  await page.getByRole('button', { name: 'Atualizar situação' }).click();
  await expect(page.getByText('Cancelada', { exact: true })).toBeVisible();
  await expect(page.getByText('Reembolsado', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Solicitar cancelamento', exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('inscricao-reembolsada.png'),
    fullPage: true,
  });
});

test('repete resposta incerta com a mesma tentativa sem duplicar cobrança', async ({
  page,
  request,
}) => {
  const fixture = await control(request, 'fixture');
  await reserve(page, fixture.publicId);
  await control(request, 'lose-response');
  const keys: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/payments'))
      keys.push(req.headers()['idempotency-key']);
  });
  await pay(page);
  await page.getByRole('button', { name: 'Repetir mesma tentativa' }).click();
  await expect(page.getByText('Pendente', { exact: true })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect((await control(request, 'charges', 'GET')).createdCharges).toBe(1);
});

test('renova a reserva após recuperar tentativa interrompida antes do envio', async ({
  page,
  request,
}) => {
  const fixture = await control(request, 'fixture');
  const id = await reserve(page, fixture.publicId);
  await control(request, `interrupted/${id}`);
  await page.reload();
  await expect(page.getByText('Expirada', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Tentar renovar reserva' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmar', exact: true })
    .click();
  await expect(page.getByText('Reservada', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Como você prefere pagar?' }),
  ).toBeVisible();
  expect((await control(request, 'charges', 'GET')).createdCharges).toBe(0);
});

test('administrador acompanha e retoma uma falha de e-mail com confirmação', async ({
  page,
  request,
}, info) => {
  const fixture = await control(request, 'fixture');
  await control(request, 'failed-email');
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(fixture.email);
  await page
    .getByLabel('Senha', { exact: true })
    .fill('Senha-exclusiva-do-teste');
  await page.getByRole('button', { name: /Entrar no painel/ }).click();
  await expect(page).toHaveURL(/\/painel$/);
  await page.goto('/painel/emails');
  await expect(
    page.getByRole('heading', { name: 'Fila de e-mails' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Retomar e-mail' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmar', exact: true })
    .click();
  await expect(page.getByText(/Mensagem aceita pelo provedor/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Retomar e-mail' }),
  ).toHaveCount(0);
  await page.getByLabel('Status', { exact: true }).selectOption('sent');
  await expect(
    page
      .getByRole('heading', { name: 'Aceito pelo provedor', exact: true })
      .first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('fila-emails.png'),
    fullPage: true,
  });
});

import { test, expect } from '@playwright/test';

test('Financeiro cadastra e aprova chave Pix e distingue repasse creditado', async ({
  page,
  request,
}) => {
  const control = async (path: string) => {
    const response = await request.post(
      `http://127.0.0.1:3100/__browser/${path}`,
      { headers: { 'x-browser-test': 'controle-local-de-testes' } },
    );
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const fixture = await control('fixture');
  const ownerId = '33e3d006-63a0-424e-8019-5bd261bcfbb0';
  let destination: null | {
    id: string;
    ownerId: string;
    keyType: string;
    key: string;
    approved: boolean;
  } = null;
  // Esta verificação de interface usa dados fictícios; nenhuma chamada financeira sai do navegador.
  await page.route('**/api/users', (route) =>
    route.fulfill({
      json: [
        {
          id: ownerId,
          name: 'Organizador de teste',
          role: 'organizer',
          active: true,
        },
      ],
    }),
  );
  await page.route('**/api/payments/accounts**', (route) =>
    route.fulfill({ json: { connected: true, platformPix: true } }),
  );
  await page.route('**/api/payments/pix-destination**', async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') {
      const input = req.postDataJSON();
      destination = {
        id: '0f4b755b-309a-4a8c-a564-aa310bd43c68',
        ownerId,
        keyType: input.keyType,
        key: input.key,
        approved: false,
      };
      return route.fulfill({ json: { saved: true, approved: false } });
    }
    if (req.method() === 'POST') {
      expect(req.postDataJSON()).toEqual({
        ownerId,
        destinationId: destination?.id,
      });
      destination!.approved = true;
      return route.fulfill({ json: { approved: true } });
    }
    return route.fulfill({
      json: {
        platformPix: true,
        automaticPayoutsEnabled: true,
        destination:
          new URL(req.url()).searchParams.get('ownerId') === ownerId
            ? destination
            : null,
      },
    });
  });
  await page.route('**/api/payments/payouts?*', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: 'payout-ficticio',
            registrationId: 'inscricao-ficticia',
            ownerId,
            amountInCents: 2500,
            createdAt: '2026-11-15T12:00:00Z',
            status: 'paid',
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
      },
    }),
  );
  try {
    await page.goto('/login');
    await page.getByLabel('E-mail', { exact: true }).fill(fixture.email);
    await page
      .getByLabel('Senha', { exact: true })
      .fill('Senha-exclusiva-do-teste');
    await page.getByRole('button', { name: /Entrar no painel/ }).click();
    await expect(page).toHaveURL(/\/painel$/);
    await page.goto('/painel/financeiro');
    await page.getByLabel('Organizador do recebimento').selectOption(ownerId);
    await page.getByLabel('Tipo de chave Pix').selectOption('EMAIL');
    await page
      .getByLabel('Chave Pix', { exact: true })
      .fill('organizacao@example.test');
    await page.getByRole('button', { name: 'Salvar chave Pix' }).click();
    await expect(
      page.getByText('Chave Pix aguardando aprovação da plataforma.'),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Aprovar chave Pix conferida' })
      .click();
    await expect(
      page.getByText('Chave Pix aprovada para receber repasses.'),
    ).toBeVisible();
    await expect(page.getByText('Creditado ao organizador')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Conectar Mercado Pago', exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await control('cleanup');
  }
});

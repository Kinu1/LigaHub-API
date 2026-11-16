import { test, expect } from '@playwright/test';

test('participante vê inscrição, taxa LigaHub, tarifa Mercado Pago e total antes de confirmar o Pix', async ({
  page,
  request,
}, testInfo) => {
  const control = async (path: string) => {
    const response = await request.post(
      `http://127.0.0.1:3100/__browser/${path}`,
      { headers: { 'x-browser-test': 'controle-local-de-testes' } },
    );
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const fixture = await control('fixture');
  let submissions = 0;
  await page.route('**/api/public/events/*', async (route) => {
    const response = await route.fetch();
    const event = await response.json();
    return route.fulfill({
      json: { ...event, pixFeePolicy: { platformFeeInCents: 100 } },
    });
  });
  await page.route('**/api/public/registrations/*/checkout', (route) =>
    route.fulfill({
      json: {
        publicKey: 'TEST-somente-interface',
        amountInCents: 2500,
        maxInstallments: 1,
        allowedMethods: ['pix'],
        pixPricing: {
          registrationAmountInCents: 2500,
          platformFeeInCents: 100,
          processingFeeInCents: 26,
          totalInCents: 2626,
          pricingToken: 'a'.repeat(64),
        },
      },
    }),
  );
  await page.route('**/api/public/registrations/*/payments', (route) => {
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON().pixPricingToken).toBe('a'.repeat(64));
    submissions++;
    return route.fulfill({ json: { status: 'pending' } });
  });
  try {
    await page.goto(`/eventos/${fixture.publicId}`);
    await expect(page.getByText(/No Pix: acréscimo/)).toBeVisible();
    await page
      .getByLabel('Nome completo', { exact: true })
      .fill('Pessoa de Teste');
    await page.getByLabel(/E-mail/).fill('taxas@example.test');
    await page
      .getByLabel('CPF do participante', { exact: true })
      .fill('12345678909');
    await page.getByRole('button', { name: /Revisar minha/ }).click();
    await expect(page.getByText(/O valor acima é da inscrição/)).toBeVisible();
    await page.getByRole('button', { name: /Reservar e escolher/ }).click();
    await expect(
      page.getByText('Taxa de serviço LigaHub', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Tarifa de processamento Mercado Pago', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/26,26/, { exact: false })).toBeVisible();
    expect(submissions).toBe(0);
    await page.getByRole('button', { name: 'Revisar pagamento Pix' }).click();
    await expect(
      page.getByRole('heading', { name: 'Revise o pagamento' }),
    ).toBeVisible();
    expect(submissions).toBe(0);
    await page.getByRole('heading', { name: 'Revise o pagamento' }).click();
    await page.screenshot({
      path: `.test-temp/pix-taxas-${testInfo.project.name}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole('button', { name: 'Confirmar pagamento' }).click();
    await expect.poll(() => submissions).toBe(1);
  } finally {
    await control('cleanup');
  }
});

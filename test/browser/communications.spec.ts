import { test, expect } from '@playwright/test';

test('compõe comunicado, repete confirmação com a mesma chave e acompanha entrega', async ({
  page,
  request,
}, info) => {
  const control = async (path: string) => {
    const response = await request.post(
      `http://127.0.0.1:3100/__browser/${path}`,
      { headers: { 'x-browser-test': 'controle-local-de-testes' } },
    );
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const fixture = await control('fixture');
  const campaignId = 'e3da5268-0ed7-48f5-89a1-43cce820c330';
  let campaign: Record<string, any> | undefined;
  let sendAttempts = 0;
  const keys: string[] = [];
  let testDestination = '';
  await page.route('**/api/events/*/communications**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const body = req.postDataJSON();
    const reply = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(data),
      });
    const suffix = url.pathname.split('/communications')[1];
    if (!suffix) {
      if (req.method() === 'POST') {
        campaign = {
          ...body,
          id: campaignId,
          status: 'draft',
          attachments: [],
          recipientCount: 0,
          counts: {},
        };
        return reply(campaign, 201);
      }
      return reply({
        data: campaign ? [campaign] : [],
        total: campaign ? 1 : 0,
        limit: 50,
        offset: 0,
      });
    }
    if (suffix.endsWith('/preview'))
      return reply({
        total: 1,
        byCategory: [{ categoryId: 'geral', count: 1 }],
      });
    if (suffix.endsWith('/test')) {
      testDestination = body.email;
      return reply({ providerId: 'teste-local', message: 'Teste simulado.' });
    }
    if (suffix.endsWith('/send')) {
      keys.push(body.idempotencyKey);
      sendAttempts++;
      campaign = {
        ...campaign,
        status: 'sending',
        recipientCount: 1,
        counts: { accepted: 1 },
      };
      if (sendAttempts === 1) return route.abort('failed');
      return reply(
        { campaignId, status: 'queued', recipientCount: 1, alreadySent: true },
        202,
      );
    }
    if (suffix.endsWith('/attachments/initiate')) {
      campaign!.attachments = [
        {
          id: 'anexo',
          filename: body.filename,
          sizeBytes: body.sizeBytes,
          status: 'uploading',
        },
      ];
      return reply({ attachmentId: 'anexo' }, 201);
    }
    if (suffix.endsWith('/chunks'))
      return reply({ receivedChunks: 1, totalChunks: 1 });
    if (suffix.endsWith('/attachments/finalize')) {
      campaign!.attachments[0].status = 'ready';
      return reply({ status: 'ready' });
    }
    if (suffix.endsWith('/recipients'))
      return reply({
        data: [
          {
            id: 'destinatario',
            name: 'Ana Participante',
            email: 'ana@example.com',
            status: campaign!.counts.delivered ? 'delivered' : 'accepted',
          },
        ],
        total: 1,
      });
    if (req.method() === 'PUT') campaign = { ...campaign, ...body };
    return reply(campaign);
  });
  try {
    await page.goto('/login');
    await page.getByLabel('E-mail', { exact: true }).fill(fixture.email);
    await page
      .getByLabel('Senha', { exact: true })
      .fill('Senha-exclusiva-do-teste');
    await page.getByRole('button', { name: /Entrar no painel/ }).click();
    await expect(page).toHaveURL(/\/painel$/);
    await page.goto(`/painel/eventos/${fixture.eventId}`);
    await page.getByRole('button', { name: 'Notificar participantes' }).click();
    await page
      .getByLabel('Assunto', { exact: true })
      .fill('Orientações para o evento');
    const editor = page.getByRole('textbox', { name: 'Mensagem', exact: true });
    await editor.fill('Leve seu documento e confira o local do encontro.');
    await editor.press('Control+a');
    await page.getByRole('button', { name: 'Negrito', exact: true }).click();
    await page.getByLabel('Apenas inscrições confirmadas').check();
    await page
      .getByRole('button', { name: 'Salvar rascunho', exact: true })
      .click();
    await expect(
      page.getByText('Rascunho salvo.', { exact: true }),
    ).toBeVisible();
    expect(campaign!.confirmedOnly).toBe(true);
    expect(campaign!.htmlContent).toContain('<strong>');
    await page.getByLabel(/Anexos \(até 5/).setInputFiles({
      name: 'orientacoes.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nTeste local'),
    });
    await expect(
      page.getByText('orientacoes.pdf (ready)', { exact: false }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Enviar teste para minha conta' })
      .click();
    await expect(
      page.getByText(`Teste solicitado para ${fixture.email}.`, {
        exact: true,
      }),
    ).toBeVisible();
    expect(testDestination).toBe(fixture.email);
    await page.getByRole('button', { name: 'Revisar envio' }).click();
    await expect(
      page.getByRole('heading', { name: 'Confirme o envio' }),
    ).toBeVisible();
    await page
      .getByRole('heading', { name: 'Confirme o envio' })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: info.outputPath('comunicado-revisao.png'),
    });
    await page
      .getByRole('button', { name: 'Confirmar envio', exact: true })
      .click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page
      .getByRole('button', { name: 'Confirmar envio', exact: true })
      .click();
    await expect(
      page.getByText('Aceito pelo provedor: 1', { exact: true }),
    ).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    await expect(
      page.getByText('Todos entregues', { exact: true }),
    ).toHaveCount(0);
    campaign!.counts = { delivered: 1 };
    campaign!.status = 'sent';
    await page.getByLabel('Buscar destinatário', { exact: true }).fill('Ana');
    await expect(
      page.getByText('Todos entregues', { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath('comunicado-entregue.png'),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await control('cleanup');
  }
});

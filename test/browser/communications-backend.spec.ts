import { test, expect } from '@playwright/test';
import { Webhook } from 'svix';

test('envia pela API real local e confirma entrega por webhook assinado simulado', async ({
  page,
  request,
}, info) => {
  const origin = `http://127.0.0.1:${process.env.LIGAHUB_BROWSER_API_PORT ?? '3100'}`;
  const control = async (path: string) => {
    const response = await request.post(`${origin}/__browser/${path}`, {
      headers: { 'x-browser-test': 'controle-local-de-testes' },
    });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const fixture = await control('fixture');
  try {
    await control('communications-prepare');
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
      .fill('Comunicado pelo backend local');
    await page
      .getByRole('textbox', { name: 'Mensagem', exact: true })
      .fill('Confira as orientações do evento.');
    await page
      .getByRole('button', { name: 'Salvar rascunho', exact: true })
      .click();
    await expect(
      page.getByText('Rascunho salvo.', { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel(/Anexos \(até 5/)
      .setInputFiles({
        name: 'orientacoes.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Orientações locais, sem envio externo.'),
      });
    await expect(
      page.getByText('orientacoes.txt (ready)', { exact: false }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Enviar teste para minha conta' })
      .click();
    await expect(
      page.getByText(`Teste solicitado para ${fixture.email}.`, {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Revisar envio' }).click();
    await expect(
      page.getByText('Todos ativos: 1 destinatários', { exact: true }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Confirmar envio', exact: true })
      .click();
    await expect(page.getByText('Na fila: 1', { exact: true })).toBeVisible();
    const accepted = await control('communications-process');
    expect(accepted.recipients).toHaveLength(1);
    expect(accepted.recipients[0].status).toBe('accepted');
    expect(accepted.messages).toBe(2); // Organizer test + one individual recipient.
    await page.getByLabel('Buscar destinatário', { exact: true }).fill('Ana');
    await expect(
      page.getByText('Aceito pelo provedor: 1', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Todos entregues', { exact: true }),
    ).toHaveCount(0);
    const id = `browser-delivered-${info.project.name}`;
    const now = new Date();
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: now.toISOString(),
      data: { email_id: accepted.recipients[0].providerId },
    });
    const signature = new Webhook(
      `whsec_${Buffer.alloc(32, 7).toString('base64')}`,
    ).sign(id, now, body);
    const delivery = await request.post(
      `${origin}/notifications/resend/webhook`,
      {
        data: body,
        headers: {
          'content-type': 'application/json',
          'svix-id': id,
          'svix-timestamp': String(Math.floor(now.getTime() / 1000)),
          'svix-signature': signature,
        },
      },
    );
    expect(delivery.status()).toBe(200);
    await page
      .getByLabel('Buscar destinatário', { exact: true })
      .fill('Ana Comunicado');
    await expect(
      page.getByText('Todos entregues', { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath('comunicado-backend-entregue.png'),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await control('cleanup');
  }
});

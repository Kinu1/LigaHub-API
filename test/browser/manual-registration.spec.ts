import { test, expect, type APIRequestContext } from '@playwright/test';
import ExcelJS from 'exceljs';

async function control(
  request: APIRequestContext,
  path: string,
  method = 'POST',
) {
  const response = await request.fetch(
    `http://127.0.0.1:${process.env.LIGAHUB_BROWSER_API_PORT ?? '3100'}/__browser/${path}`,
    {
      method,
      headers: { 'x-browser-test': 'controle-local-de-testes' },
    },
  );
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test('adiciona cortesia com perguntas, identifica duplicata, exporta sem cobrar e mantém layout acessível', async ({
  page,
  request,
}, info) => {
  const fixture = await control(request, 'fixture');
  try {
    await control(request, 'manual-form');
    await page.goto('/login');
    await page.getByLabel('E-mail', { exact: true }).fill(fixture.email);
    await page
      .getByLabel('Senha', { exact: true })
      .fill('Senha-exclusiva-do-teste');
    await page.getByRole('button', { name: /Entrar no painel/ }).click();
    await expect(page).toHaveURL(/\/painel$/);
    await page.goto(`/painel/eventos/${fixture.eventId}`);
    const trigger = page.getByRole('button', {
      name: 'Adicionar participante',
    });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Adicionar participante' });
    const fill = async () => {
      await dialog
        .getByLabel('Nome completo', { exact: true })
        .fill('Ana Cortesia');
      await dialog
        .getByLabel('E-mail', { exact: true })
        .fill('CORTESIA@example.com');
      await dialog
        .getByLabel('CPF do participante', { exact: true })
        .fill('529.982.247-25');
      await dialog
        .getByLabel('Categoria', { exact: true })
        .selectOption('profissional');
      await dialog.getByLabel('Curso (obrigatório)').fill('Medicina');
      await dialog.getByLabel('Turno (obrigatório)').selectOption('Noite');
      await dialog.getByLabel('Aceita as regras (obrigatório)').check();
    };
    await fill();
    await dialog
      .getByLabel('CPF do participante', { exact: true })
      .fill('11111111111');
    await dialog.getByRole('button', { name: 'Confirmar cortesia' }).click();
    await expect(dialog.getByRole('alert')).toContainText('CPF válido');
    await dialog
      .getByLabel('CPF do participante', { exact: true })
      .fill('529.982.247-25');
    expect(
      await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await expect(
      dialog.getByRole('heading', { name: 'Adicionar participante' }),
    ).toBeInViewport();
    await expect(
      dialog.getByRole('button', { name: 'Confirmar cortesia' }),
    ).toBeInViewport();
    await expect(
      dialog.getByRole('button', { name: 'Cancelar' }),
    ).toBeInViewport();
    await page.screenshot({ path: info.outputPath('formulario-cortesia.png') });
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/registrations/manual') &&
        response.status() === 201,
    );
    await dialog.getByRole('button', { name: 'Confirmar cortesia' }).click();
    const result = await (await created).json();
    expect(result).toEqual({
      id: expect.any(String),
      status: 'confirmed',
      origin: 'manual',
      emailDeliveryStatus: 'pending',
    });
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    const row = page.getByRole('row').filter({ hasText: 'Ana Cortesia' });
    await expect(row).toContainText('Cortesia');
    await expect(row).toContainText('Profissional');
    await expect(row).toContainText('Confirmada');
    await expect(row).toContainText('e-mail pendente');
    expect((await control(request, 'charges', 'GET')).createdCharges).toBe(0);
    expect(await control(request, 'messages', 'GET')).toEqual([]);
    await trigger.click();
    await fill();
    await dialog.getByRole('button', { name: 'Confirmar cortesia' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Já existe');
    await dialog
      .getByRole('button', { name: 'Localizar inscrição existente' })
      .click();
    await expect(page.getByLabel('Buscar inscrição')).toHaveValue(
      'cortesia@example.com',
    );
    await expect(
      page.getByRole('row').filter({ hasText: 'Ana Cortesia' }),
    ).toHaveCount(1);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar Excel' }).click();
    const download = await downloadPromise;
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile((await download.path())!);
    expect(book.getWorksheet(1)!.getCell('K2').text).toBe('Cortesia');
    expect(book.getWorksheet(1)!.getCell('B2').text).toBe('Profissional');
    expect(book.getWorksheet(1)!.getCell('H2').value).toBe(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath('lista-cortesia.png'),
      fullPage: true,
    });
  } finally {
    await control(request, 'cleanup');
  }
});

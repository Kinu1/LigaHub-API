import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { Blob as NodeBlob } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { Communications, safeHtml } from './communications';
import type { Event } from '../types';

vi.mock('../auth', () => ({
  useAuth: () => ({
    user: { email: 'organizador@example.com', name: 'Organizador' },
  }),
}));
vi.mock('../api', () => ({ api: vi.fn(), send: vi.fn() }));
import { api, send } from '../api';

const event = {
  id: 'evento',
  title: 'Evento',
  registrationTypes: [{ id: 'cat', name: 'Profissional' }],
} as Event;
describe('comunicados', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
    localStorage.clear();
  });
  it('remove conteúdo ativo e links com protocolos inseguros', () => {
    const result = safeHtml(
      '<p onclick="alert(1)">Olá<script>alert(1)</script><a href="javascript:alert(1)">link</a><strong>forte</strong></p>',
    );
    expect(result).toContain('<strong>forte</strong>');
    expect(result).not.toMatch(/script|onclick|javascript/);
    expect(safeHtml('<div><b>Forte</b><i>Itálico</i></div>')).toBe(
      '<p><strong>Forte</strong><em>Itálico</em></p>',
    );
  });
  it('salva o filtro de categoria composto com apenas confirmados', async () => {
    const draft = {
      id: 'camp',
      subject: 'Aviso',
      htmlContent: '<p>Olá</p>',
      textContent: 'Olá',
      audienceType: 'categories',
      audienceCategoryIds: ['cat'],
      confirmedOnly: true,
      status: 'draft',
      attachments: [],
    };
    vi.mocked(api).mockImplementation(async (path) =>
      path.endsWith('/camp')
        ? (draft as never)
        : ({ data: [], total: 0 } as never),
    );
    vi.mocked(send).mockResolvedValue(draft);
    render(<Communications event={event} />);
    fireEvent.click(
      screen.getByRole('button', { name: 'Notificar participantes' }),
    );
    await screen.findByRole('textbox', { name: 'Assunto' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Assunto' }), {
      target: { value: 'Aviso' },
    });
    const editor = screen.getByRole('textbox', { name: 'Mensagem' });
    editor.innerHTML = '<p>Olá</p>';
    fireEvent.input(editor);
    fireEvent.click(screen.getByLabelText('Categorias selecionadas'));
    fireEvent.click(screen.getByLabelText('Profissional'));
    fireEvent.click(screen.getByLabelText('Apenas inscrições confirmadas'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        '/events/evento/communications',
        expect.objectContaining({
          audienceType: 'categories',
          audienceCategoryIds: ['cat'],
          confirmedOnly: true,
        }),
      ),
    );
  });

  it('não declara entrega total para mensagens apenas aceitas ou ignoradas', async () => {
    const campaign = {
      id: 'camp',
      subject: 'Aviso',
      status: 'sending',
      attachments: [],
      recipientCount: 2,
      counts: { accepted: 1, skipped: 1 },
    };
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.includes('/recipients'))
        return {
          data: [
            {
              id: 'r',
              name: 'Ana',
              email: 'ana@example.com',
              status: 'accepted',
            },
          ],
          total: 2,
        } as never;
      return (
        path.endsWith('/camp') ? campaign : { data: [campaign], total: 1 }
      ) as never;
    });
    const user = userEvent.setup();
    render(<Communications event={event} />);
    await user.click(
      screen.getByRole('button', { name: 'Notificar participantes' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Aviso — Acompanhar' }),
    );
    await screen.findByText('ana@example.com', { exact: false });
    expect(screen.queryByText('Todos entregues')).toBeNull();
    expect(screen.getByText('Aceito pelo provedor: 1')).toBeTruthy();
    expect(screen.getByText('Não enviado (inelegível): 1')).toBeTruthy();
  });

  it('mostra todos entregues somente com confirmação para todo o snapshot', async () => {
    const campaign = {
      id: 'camp',
      subject: 'Aviso',
      status: 'sent',
      attachments: [],
      recipientCount: 2,
      counts: { delivered: 2 },
    };
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.includes('/recipients'))
        return {
          data: [
            {
              id: 'r',
              name: 'Ana',
              email: 'ana@example.com',
              status: 'delivered',
              webhookEvents: [
                {
                  id: 'ocorrencia',
                  eventType: 'email.complained',
                  receivedAt: '2026-11-18T12:00:00Z',
                },
              ],
            },
          ],
          total: 2,
        } as never;
      return (
        path.endsWith('/camp') ? campaign : { data: [campaign], total: 1 }
      ) as never;
    });
    const user = userEvent.setup();
    render(<Communications event={event} />);
    await user.click(
      screen.getByRole('button', { name: 'Notificar participantes' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Aviso — Acompanhar' }),
    );
    expect(await screen.findByText('Todos entregues')).toBeTruthy();
    expect(screen.getByText(/Ocorrência: Reclamação de spam/)).toBeTruthy();
  });

  it('reutiliza a chave ao repetir uma confirmação cujo resultado de rede é incerto', async () => {
    const draft = {
      id: 'camp',
      subject: 'Aviso',
      htmlContent: '<p>Olá</p>',
      textContent: 'Olá',
      audienceType: 'all_active',
      audienceCategoryIds: [],
      status: 'draft',
      attachments: [],
    };
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.endsWith('/preview'))
        return {
          total: 1,
          byCategory: [{ categoryId: 'cat', count: 1 }],
        } as never;
      return (
        path.endsWith('/camp') ? draft : { data: [draft], total: 1 }
      ) as never;
    });
    vi.mocked(send).mockImplementation(async (path) => {
      if (path.endsWith('/send')) throw new Error('Resposta indisponível');
      return draft as never;
    });
    const user = userEvent.setup();
    render(<Communications event={event} />);
    await user.click(
      screen.getByRole('button', { name: 'Notificar participantes' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Aviso — Rascunho' }),
    );
    await user.click(screen.getByRole('button', { name: 'Revisar envio' }));
    await user.click(
      await screen.findByRole('button', { name: 'Confirmar envio' }),
    );
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Confirmar envio' }));
    await waitFor(() =>
      expect(
        vi.mocked(send).mock.calls.filter(([p]) => p.endsWith('/send')),
      ).toHaveLength(2),
    );
    const calls = vi
      .mocked(send)
      .mock.calls.filter(([p]) => p.endsWith('/send'));
    expect(calls[0][1]).toEqual(calls[1][1]);
    expect(calls[0][1]).toEqual({ idempotencyKey: expect.any(String) });
    expect(screen.queryByText('Todos entregues')).toBeNull();
  });

  it('envia teste exclusivamente para a conta autenticada', async () => {
    const draft = {
      id: 'camp',
      subject: 'Aviso',
      htmlContent: '<p>Olá</p>',
      textContent: 'Olá',
      audienceType: 'all_active',
      audienceCategoryIds: [],
      status: 'draft',
      attachments: [],
    };
    vi.mocked(api).mockImplementation(
      async (path) =>
        (path.endsWith('/camp') ? draft : { data: [draft], total: 1 }) as never,
    );
    vi.mocked(send).mockResolvedValue(draft);
    const user = userEvent.setup();
    render(<Communications event={event} />);
    await user.click(
      screen.getByRole('button', { name: 'Notificar participantes' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Aviso — Rascunho' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Enviar teste para minha conta' }),
    );
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        '/events/evento/communications/camp/test',
        { email: 'organizador@example.com' },
      ),
    );
  });

  it('anexa arquivos sem MIME do navegador em partes que cabem no limite de requisição', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const draft = {
      id: 'camp',
      subject: 'Aviso',
      htmlContent: '<p>Olá</p>',
      textContent: 'Olá',
      audienceType: 'all_active',
      audienceCategoryIds: [],
      status: 'draft',
      attachments: [],
    };
    vi.mocked(api).mockImplementation(
      async (path) =>
        (path.endsWith('/camp') ? draft : { data: [draft], total: 1 }) as never,
    );
    vi.mocked(send).mockImplementation(
      async (path) =>
        (path.endsWith('/initiate')
          ? { attachmentId: 'anexo' }
          : draft) as never,
    );
    const user = userEvent.setup();
    render(<Communications event={event} />);
    await user.click(
      screen.getByRole('button', { name: 'Notificar participantes' }),
    );
    await user.click(
      await screen.findByRole('button', { name: 'Aviso — Rascunho' }),
    );
    const bytes = new Uint8Array(512 * 1024 + 17).fill(65);
    const blob = new NodeBlob([bytes]);
    const file = new File([bytes], 'lista.csv', { type: '' });
    Object.defineProperties(file, {
      arrayBuffer: { value: () => blob.arrayBuffer() },
      slice: { value: (start: number, end: number) => blob.slice(start, end) },
    });
    await user.upload(screen.getByLabelText(/Anexos \(até 5/), file);
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        '/events/evento/communications/camp/attachments/finalize',
        { attachmentId: 'anexo' },
      ),
    );
    expect(send).toHaveBeenCalledWith(
      expect.stringContaining('/initiate'),
      expect.objectContaining({
        mimeType: 'text/csv',
        sizeBytes: bytes.length,
        totalChunks: 2,
      }),
    );
    const chunks = vi
      .mocked(send)
      .mock.calls.filter(([p]) => p.endsWith('/chunks'));
    expect(chunks).toHaveLength(2);
    expect(
      chunks.map(
        ([, body]) => atob((body as { dataBase64: string }).dataBase64).length,
      ),
    ).toEqual([512 * 1024, 17]);
    expect(
      chunks.every(([, body]) => JSON.stringify(body).length < 1024 * 1024),
    ).toBe(true);
  });
});

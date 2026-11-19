import { useEffect, useRef, useState } from 'react';
import { api, send } from '../api';
import { useAuth } from '../auth';
import { useDebounced } from '../ui';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog';
import type { Event } from '../types';

type Attachment = {
  id: string;
  filename: string;
  sizeBytes: number;
  status: string;
};
type Campaign = {
  id: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  audienceType: string;
  audienceCategoryIds: string[];
  confirmedOnly?: boolean;
  status: string;
  attachments: Attachment[];
  recipientCount?: number;
  counts?: Record<string, number>;
};
type Recipient = {
  id: string;
  name: string;
  email: string;
  status: string;
  attempts?: number;
  errorDetail?: string;
  webhookEvents?: { id: string; eventType: string; receivedAt: string }[];
};
type List<T> = { data: T[]; total: number };
type Preview = {
  total: number;
  byCategory: { categoryId: string; count: number }[];
};
const states: Record<string, string> = {
  pending: 'Pendente',
  queued: 'Na fila',
  processing: 'Processando',
  accepted: 'Aceito pelo provedor',
  delivered: 'Entregue',
  delayed: 'Atrasado',
  failed: 'Falhou',
  unconfirmed_after24h: 'Sem confirmação após 24 horas',
  skipped: 'Não enviado (inelegível)',
};
const chunkSize = 512 * 1024;
const formats = '.pdf,.png,.jpg,.jpeg,.txt,.csv,.docx,.xlsx,.pptx';

// Rebuild an allowlisted tree instead of inserting editor or server HTML into the app.
export function safeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const allowed = new Set(['P', 'BR', 'STRONG', 'EM', 'UL', 'OL', 'LI', 'A']);
  const clean = (node: Node): Node => {
    if (node.nodeType === Node.TEXT_NODE)
      return document.createTextNode(node.textContent || '');
    const fragment = document.createDocumentFragment();
    if (!(node instanceof Element)) return fragment;
    if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(node.tagName))
      return fragment;
    const tag =
      ({ B: 'STRONG', I: 'EM', DIV: 'P' } as Record<string, string>)[
        node.tagName
      ] || node.tagName;
    const target = allowed.has(tag)
      ? document.createElement(tag.toLowerCase())
      : fragment;
    if (node.tagName === 'A' && target instanceof HTMLAnchorElement) {
      try {
        const url = new URL(node.getAttribute('href') || '');
        if (['http:', 'https:'].includes(url.protocol)) {
          target.href = url.href;
          target.rel = 'noopener noreferrer';
        }
      } catch {
        /* omit invalid link */
      }
    }
    node.childNodes.forEach((child) => target.appendChild(clean(child)));
    return target;
  };
  const wrapper = document.createElement('div');
  doc.body.childNodes.forEach((node) => wrapper.appendChild(clean(node)));
  return wrapper.innerHTML;
}
async function hash(blob: Blob) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
async function base64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}

export function Communications({ event }: { event: Event }) {
  const { user } = useAuth();
  const registrationTypes = event.registrationTypes?.length
    ? event.registrationTypes
    : [{ id: 'geral', name: 'Inscrição geral' }];
  const [open, setOpen] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaign, setCampaign] = useState<Campaign>();
  const [subject, setSubject] = useState('');
  const [html, setHtml] = useState('');
  const [audience, setAudience] = useState('all_active');
  const [categories, setCategories] = useState<string[]>([]);
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [search, setSearch] = useState('');
  const querySearch = useDebounced(search);
  const [filter, setFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [recipients, setRecipients] = useState<List<Recipient>>();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [snapshotTotal, setSnapshotTotal] = useState(0);
  const editor = useRef<HTMLDivElement>(null);
  const root = `/events/${event.id}/communications`;
  const path = campaign ? `${root}/${campaign.id}` : '';
  useEffect(() => {
    if (editor.current)
      editor.current.innerHTML = safeHtml(campaign?.htmlContent || '');
  }, [campaign?.id]);
  const loadList = async () =>
    setCampaigns((await api<List<Campaign>>(`${root}?limit=50&offset=0`)).data);
  const loadCampaign = async (id: string) => {
    const c = await api<Campaign>(`${root}/${id}`);
    setRecipients(undefined);
    setCounts({});
    setSnapshotTotal(0);
    setOffset(0);
    setSearch('');
    setFilter('');
    setCampaign(c);
    setSubject(c.subject);
    setHtml(c.htmlContent);
    setAudience(c.audienceType === 'categories' ? 'categories' : 'all_active');
    setCategories(c.audienceCategoryIds || []);
    setConfirmedOnly(
      Boolean(c.confirmedOnly || c.audienceType === 'confirmed_only'),
    );
    setPreview(undefined);
    setReview(false);
    if (editor.current) editor.current.innerHTML = safeHtml(c.htmlContent);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Não foi possível concluir a operação.',
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (open) void run(loadList);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !campaign || campaign.status === 'draft') return;
    let active = true;
    const refresh = async () => {
      try {
        const [page, summary] = await Promise.all([
          api<List<Recipient>>(
            `${path}/recipients?limit=20&offset=${offset}&search=${encodeURIComponent(querySearch)}${filter ? `&status=${filter}` : ''}`,
          ),
          api<Campaign>(path),
        ]);
        if (active) {
          setRecipients(page);
          setSnapshotTotal(summary.recipientCount ?? 0);
          setCounts(summary.counts ?? {});
        }
      } catch (e) {
        if (active)
          setError(
            e instanceof Error ? e.message : 'Erro ao atualizar destinatários.',
          );
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [open, campaign, path, querySearch, filter, offset]);
  const save = async () => {
    const clean = safeHtml(editor.current?.innerHTML ?? html);
    const textContent =
      new DOMParser()
        .parseFromString(clean, 'text/html')
        .body.textContent?.trim() || '';
    if (!subject.trim() || !textContent)
      throw new Error('Informe assunto e mensagem.');
    if (audience === 'categories' && !categories.length)
      throw new Error('Selecione ao menos uma categoria.');
    const body = {
      subject: subject.trim(),
      htmlContent: clean,
      textContent,
      audienceType: audience,
      audienceCategoryIds: audience === 'categories' ? categories : [],
      confirmedOnly,
    };
    const saved = campaign
      ? await send<Campaign>(path, body, 'PUT')
      : await send<Campaign>(root, body);
    await loadCampaign(saved.id);
    await loadList();
    return saved.id;
  };
  const upload = async (file: File) => {
    if (!campaign)
      throw new Error('Salve o rascunho antes de anexar arquivos.');
    if (
      campaign.attachments.length >= 5 ||
      campaign.attachments.reduce((n, a) => n + a.sizeBytes, 0) + file.size >
        10 * 1024 * 1024 ||
      !file.size
    )
      throw new Error('Limite de 5 anexos e 10 MiB no total.');
    const totalChunks = Math.ceil(file.size / chunkSize);
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      txt: 'text/plain',
      csv: 'text/csv',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
    const mimeType = mimeTypes[file.name.split('.').pop()?.toLowerCase() || ''];
    if (!mimeType) throw new Error('Formato de arquivo não permitido.');
    await save();
    try {
      const init = await send<{ attachmentId: string }>(
        `${path}/attachments/initiate`,
        {
          filename: file.name,
          mimeType,
          sizeBytes: file.size,
          checksum: await hash(file),
          totalChunks,
        },
      );
      for (let i = 0; i < totalChunks; i++) {
        const part = file.slice(i * chunkSize, (i + 1) * chunkSize);
        await send(`${path}/attachments/${init.attachmentId}/chunks`, {
          chunkIndex: i,
          checksum: await hash(part),
          dataBase64: await base64(part),
        });
        setProgress(
          `${file.name}: ${Math.round(((i + 1) / totalChunks) * 100)}%`,
        );
      }
      await send(`${path}/attachments/finalize`, {
        attachmentId: init.attachmentId,
      });
    } finally {
      setProgress('');
      await loadCampaign(campaign.id);
    }
  };
  const total = snapshotTotal;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="mb-4">Notificar participantes</Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="shrink-0 px-6 pt-6 pr-14">
          <DialogTitle>Notificar participantes</DialogTitle>
          <DialogDescription>
            Crie comunicados e acompanhe a entrega aos participantes.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 overflow-y-auto px-6 pb-6">
          {error && <p role="alert">{error}</p>}
          {message && <p role="status">{message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setCampaign(undefined);
                setSubject('');
                setHtml('');
                if (editor.current) editor.current.innerHTML = '';
                setAudience('all_active');
                setCategories([]);
                setConfirmedOnly(false);
                setReview(false);
                setPreview(undefined);
                setError('');
                setMessage('');
              }}
            >
              Novo comunicado
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(loadList)}
            >
              Atualizar lista
            </Button>
          </div>
          <ul aria-label="Comunicados">
            {campaigns.map((c) => (
              <li key={c.id}>
                <button
                  className="underline"
                  onClick={() => void run(() => loadCampaign(c.id))}
                >
                  {c.subject} —{' '}
                  {c.status === 'draft' ? 'Rascunho' : 'Acompanhar'}
                </button>
              </li>
            ))}
          </ul>
          {!campaign || campaign.status === 'draft' ? (
            <div
              className="grid gap-3"
              onInputCapture={() => setReview(false)}
              onChangeCapture={() => setReview(false)}
            >
              <label>
                Assunto
                <input
                  className="w-full rounded border p-2"
                  maxLength={255}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </label>
              <div>
                <span id="message-label">Mensagem</span>
                <div className="flex flex-wrap gap-1" aria-label="Formatação">
                  {[
                    ['Negrito', 'bold'],
                    ['Itálico', 'italic'],
                    ['Lista', 'insertUnorderedList'],
                    ['Lista numerada', 'insertOrderedList'],
                  ].map(([label, command]) => (
                    <Button
                      type="button"
                      variant="outline"
                      key={command}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        editor.current?.focus();
                        document.execCommand(command);
                      }}
                    >
                      {label}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const selection = window.getSelection();
                      if (
                        !selection ||
                        selection.isCollapsed ||
                        !editor.current?.contains(selection.anchorNode)
                      ) {
                        setError('Selecione o texto do link.');
                        return;
                      }
                      const range = selection.getRangeAt(0).cloneRange();
                      const value = window.prompt(
                        'Endereço do link (https:// ou http://)',
                      );
                      if (!value) return;
                      try {
                        const url = new URL(value);
                        if (!['http:', 'https:'].includes(url.protocol))
                          throw new Error();
                        selection.removeAllRanges();
                        selection.addRange(range);
                        document.execCommand('createLink', false, url.href);
                      } catch {
                        setError('Informe um link HTTP ou HTTPS válido.');
                      }
                    }}
                  >
                    Link
                  </Button>
                </div>
                <div
                  key={campaign?.id || 'new'}
                  ref={editor}
                  role="textbox"
                  aria-labelledby="message-label"
                  aria-multiline="true"
                  contentEditable
                  suppressContentEditableWarning
                  className="min-h-32 rounded border p-3"
                  onInput={(e) => setHtml(e.currentTarget.innerHTML)}
                />
              </div>
              <fieldset className="grid gap-2">
                <legend>Destinatários</legend>
                <label>
                  <input
                    type="radio"
                    checked={audience === 'all_active'}
                    onChange={() => setAudience('all_active')}
                  />{' '}
                  Todos ativos
                </label>
                <label>
                  <input
                    type="radio"
                    checked={audience === 'categories'}
                    onChange={() => setAudience('categories')}
                  />{' '}
                  Categorias selecionadas
                </label>
                {audience === 'categories' &&
                  registrationTypes.map((c) => (
                    <label key={c.id}>
                      <input
                        type="checkbox"
                        checked={categories.includes(c.id)}
                        onChange={(e) =>
                          setCategories(
                            e.target.checked
                              ? [...categories, c.id]
                              : categories.filter((id) => id !== c.id),
                          )
                        }
                      />{' '}
                      {c.name}
                    </label>
                  ))}
                <label>
                  <input
                    type="checkbox"
                    checked={confirmedOnly}
                    onChange={(e) => setConfirmedOnly(e.target.checked)}
                  />{' '}
                  Apenas inscrições confirmadas
                </label>
              </fieldset>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await save();
                      setMessage('Rascunho salvo.');
                    })
                  }
                >
                  Salvar rascunho
                </Button>
                {campaign && (
                  <>
                    <Button
                      variant="outline"
                      disabled={busy || !user?.email}
                      onClick={() =>
                        void run(async () => {
                          await save();
                          await send(`${path}/test`, { email: user!.email });
                          setMessage(`Teste solicitado para ${user!.email}.`);
                        })
                      }
                    >
                      Enviar teste para minha conta
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const id = await save();
                          setPreview(
                            await api<Preview>(`${root}/${id}/preview`),
                          );
                          setReview(true);
                        })
                      }
                    >
                      Revisar envio
                    </Button>
                  </>
                )}
              </div>
              {campaign && (
                <>
                  <label>
                    Anexos (até 5, total de 10 MiB)
                    <input
                      type="file"
                      accept={formats}
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void run(() => upload(file));
                      }}
                    />
                  </label>
                  <p role="status">{progress}</p>
                  <ul>
                    {campaign.attachments?.map((a) => (
                      <li key={a.id}>
                        {a.filename} ({a.status}){' '}
                        <button
                          className="underline"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await api(`${path}/attachments/${a.id}`, {
                                method: 'DELETE',
                              });
                              await loadCampaign(campaign.id);
                            })
                          }
                        >
                          Remover
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {campaign && (
                <section>
                  <h3>Prévia da mensagem salva</h3>
                  <div className="rounded border p-4">
                    <img
                      src="/logo-lauen.png"
                      alt="LAUEN / FABA"
                      className="max-h-16 max-w-full object-contain"
                    />
                    <p>{event.title}</p>
                    <iframe
                      title="Prévia segura do comunicado"
                      sandbox=""
                      className="w-full border-0"
                      srcDoc={`<!doctype html><meta charset="utf-8"><body>${safeHtml(campaign.htmlContent)}</body>`}
                    />
                    <p>
                      Enviado por {user?.name} ({user?.email}) via LigaHub
                    </p>
                  </div>
                </section>
              )}
              {review && preview && campaign && (
                <section className="grid gap-2 rounded border p-4">
                  <h3>Confirme o envio</h3>
                  <p>Assunto: {campaign.subject}</p>
                  <p>
                    {audience === 'categories'
                      ? 'Categorias selecionadas'
                      : 'Todos ativos'}
                    {confirmedOnly ? ', apenas confirmados' : ''}:{' '}
                    {preview.total} destinatários
                  </p>
                  <ul>
                    {preview.byCategory.map((c) => (
                      <li key={c.categoryId}>
                        {registrationTypes.find((t) => t.id === c.categoryId)
                          ?.name || 'Inscrição geral'}
                        : {c.count}
                      </li>
                    ))}
                  </ul>
                  <p>
                    Anexos:{' '}
                    {campaign.attachments?.map((a) => a.filename).join(', ') ||
                      'Nenhum'}
                  </p>
                  <p>
                    Ao confirmar, a lista de destinatários será fixada. A
                    aceitação na fila não comprova entrega.
                  </p>
                  <Button
                    disabled={
                      busy ||
                      preview.total === 0 ||
                      campaign.attachments?.some((a) => a.status !== 'ready')
                    }
                    onClick={() =>
                      void run(async () => {
                        const keyName = `ligahub:communication:${campaign.id}:idempotency`;
                        let key = localStorage.getItem(keyName);
                        if (!key) {
                          key = crypto.randomUUID();
                          localStorage.setItem(keyName, key);
                        }
                        await send(`${path}/send`, { idempotencyKey: key });
                        setMessage('Comunicado colocado na fila.');
                        await loadCampaign(campaign.id);
                        await loadList();
                      })
                    }
                  >
                    Confirmar envio
                  </Button>
                </section>
              )}
            </div>
          ) : (
            <section className="grid gap-3">
              <h3>Acompanhamento: {campaign.subject}</h3>
              <p>
                Entrega significa aceitação pelo servidor do destinatário; não
                confirma leitura ou chegada à caixa principal.
              </p>
              <p>
                {total > 0 && counts.delivered === total
                  ? 'Todos entregues'
                  : 'Acompanhamento de entrega'}
              </p>
              <ul className="grid gap-x-4 text-sm sm:grid-cols-2">
                {Object.entries(states).map(([key, label]) => (
                  <li key={key}>
                    {label}: {counts[key] ?? 0}
                  </li>
                ))}
              </ul>
              <label>
                Buscar destinatário
                <input
                  className="w-full rounded border p-2"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setOffset(0);
                  }}
                />
              </label>
              <label>
                Estado
                <select
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setOffset(0);
                  }}
                >
                  <option value="">Todos</option>
                  {Object.entries(states).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {!recipients ? (
                <p role="status">Carregando destinatários…</p>
              ) : (
                <>
                  <ul>
                    {recipients.data.map((r) => (
                      <li className="border-b py-2" key={r.id}>
                        <strong>{r.name}</strong> — {r.email}
                        <br />
                        {states[r.status] || r.status}
                        {r.errorDetail && ` — ${r.errorDetail}`}
                        {r.webhookEvents?.map((o) => (
                          <p key={o.id}>
                            Ocorrência:{' '}
                            {o.eventType === 'email.complained'
                              ? 'Reclamação de spam'
                              : 'Rejeição permanente'}{' '}
                            — {new Date(o.receivedAt).toLocaleString('pt-BR')}
                          </p>
                        ))}
                      </li>
                    ))}
                  </ul>
                  <p>{recipients.total} destinatários encontrados</p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={!offset}
                      onClick={() => setOffset(Math.max(0, offset - 20))}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      disabled={offset + 20 >= recipients.total}
                      onClick={() => setOffset(offset + 20)}
                    >
                      Próxima
                    </Button>
                  </div>
                </>
              )}
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

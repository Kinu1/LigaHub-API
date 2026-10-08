import { describe, expect, it, vi } from 'vitest';
describe('Links de acesso carregados antes das rotas', () => {
  it('captura o token antes da rota assíncrona e preserva o estado de navegação', async () => {
    vi.resetModules();
    history.replaceState(
      { idx: 3, key: 'router-key' },
      '',
      '/inscricao/teste#access=credencial-de-teste',
    );
    const access = await import('./access-fragment');
    expect(location.hash).toBe('');
    expect(history.state).toEqual({ idx: 3, key: 'router-key' });
    expect(access.accessFragment('access')).toBe('credencial-de-teste');
    expect(access.accessFragment('access')).toBe('credencial-de-teste');
    access.forgetAccessFragment('access');
    expect(access.accessFragment('access')).toBeUndefined();
    history.replaceState(null, '', '/');
  });
});

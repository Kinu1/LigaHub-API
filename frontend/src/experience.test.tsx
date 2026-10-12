import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExperienceProvider, MotionSection, SoundToggle } from './experience';

const originalAnimate = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'animate',
);
beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (originalAnimate)
    Object.defineProperty(Element.prototype, 'animate', originalAnimate);
  else Reflect.deleteProperty(Element.prototype, 'animate');
});

describe('Preferência de som', () => {
  it('começa silencioso, ativa somente por escolha e mantém o silêncio após desativar', async () => {
    const start = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const Audio = vi.fn(function () {
      return {
        state: 'running',
        currentTime: 0,
        destination: {},
        close,
        createOscillator: () => ({
          frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
          connect() {},
          disconnect() {},
          start,
          stop() {},
        }),
        createGain: () => ({
          gain: {
            setValueAtTime() {},
            linearRampToValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect() {},
          disconnect() {},
        }),
      };
    });
    vi.stubGlobal('AudioContext', Audio);
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 200));
    const user = userEvent.setup();
    const view = render(
      <ExperienceProvider>
        <SoundToggle />
        <button>Histórico</button>
      </ExperienceProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Histórico' }));
    expect(Audio).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Sons da interface' }));
    expect(
      screen
        .getByRole('button', { name: 'Sons da interface' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(start).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Histórico' }));
    expect(start).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('button', { name: 'Sons da interface' }));
    await user.click(screen.getByRole('button', { name: 'Histórico' }));
    expect(start).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem('ligahub:ui-sound')).toBe('off');
    view.unmount();
    expect(close).toHaveBeenCalledOnce();
  });

  it('continua operável quando áudio ou armazenamento não estão disponíveis', async () => {
    vi.stubGlobal('AudioContext', undefined);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Indisponível');
    });
    const action = vi.fn();
    render(
      <ExperienceProvider>
        <SoundToggle />
        <button onClick={action}>Abrir aba</button>
      </ExperienceProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sons da interface' }));
    await user.click(screen.getByRole('button', { name: 'Abrir aba' }));
    expect(action).toHaveBeenCalledOnce();
  });
});

describe('Transições', () => {
  it('preserva dados e foco do formulário quando a etapa muda', async () => {
    const animate = vi.fn(() => ({ cancel: vi.fn() }));
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: animate,
    });
    const view = render(
      <MotionSection change={0}>
        <input aria-label="Nome do evento" />
      </MotionSection>,
    );
    await userEvent
      .setup()
      .type(screen.getByRole('textbox', { name: 'Nome do evento' }), 'Jornada');
    view.rerender(
      <MotionSection change={1}>
        <input aria-label="Nome do evento" />
      </MotionSection>,
    );
    expect(
      (
        screen.getByRole('textbox', {
          name: 'Nome do evento',
        }) as HTMLInputElement
      ).value,
    ).toBe('Jornada');
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Nome do evento' }),
    );
  });

  it('não inicia animação quando o sistema pede movimento reduzido', () => {
    const animate = vi.fn();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    Object.defineProperty(Element.prototype, 'animate', {
      configurable: true,
      value: animate,
    });
    render(<MotionSection change="histórico">Histórico</MotionSection>);
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByText('Histórico')).toBeTruthy();
  });
});

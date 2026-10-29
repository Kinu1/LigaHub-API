import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import {
  EventArtwork,
  EventImageInput,
  prepareEventImage,
} from './event-images';

const image =
  'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
describe('Identidade visual dos eventos', () => {
  it('mostra logo e banner para o visitante e não cria espaços quando ausentes', () => {
    const { rerender, container } = render(
      <EventArtwork
        event={{ title: 'Jornada', logoImage: image, bannerImage: image }}
      />,
    );
    expect(
      screen.getByAltText('Logo do evento Jornada').getAttribute('src'),
    ).toBe(image);
    expect(
      screen.getByAltText('Banner do evento Jornada').getAttribute('src'),
    ).toBe(image);
    rerender(<EventArtwork event={{ title: 'Jornada' }} />);
    expect(container.childElementCount).toBe(0);
  });
  it('permite remover a logo e anuncia arquivo inválido sem substituir a imagem existente', async () => {
    function Input() {
      const [value, setValue] = useState(image);
      return (
        <main>
          <h1>Imagens</h1>
          <EventImageInput
            kind="logo"
            value={value}
            onChange={setValue}
            onBusyChange={vi.fn()}
          />
        </main>
      );
    }
    const { container } = render(<Input />);
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(
      screen.getByLabelText('Logo do evento'),
      new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' }),
    );
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Escolha uma imagem PNG, JPG ou WebP.',
    );
    expect(screen.getByAltText('Prévia: logo do evento')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remover logo' }));
    expect(screen.queryByAltText('Prévia: logo do evento')).toBeNull();
    expect(
      (
        await axe.run(container, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
  });
  it('rejeita imagens acima de 5 MB antes de processar o arquivo', async () => {
    await expect(
      prepareEventImage(
        new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', {
          type: 'image/png',
        }),
        'banner',
      ),
    ).rejects.toThrow('máximo 5 MB');
  });
});

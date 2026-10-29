import { describe, expect, it } from 'vitest';
import { validateEventImage } from './event-images.js';

const image =
  'data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
describe('Imagens dos eventos', () => {
  it('aceita WebP e a remoção de uma imagem opcional', () => {
    expect(() => validateEventImage(image, 'logo')).not.toThrow();
    expect(() => validateEventImage(null, 'logo')).not.toThrow();
    expect(() => validateEventImage(undefined, 'banner')).not.toThrow();
  });
  it.each([
    'https://example.test/image.webp',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/webp;base64,PHNjcmlwdD4=',
    image + 'A',
    'data:image/webp;base64,' + 'A'.repeat(400000),
  ])(
    'rejeita conteúdo externo, ativo, falsificado, malformado ou grande demais',
    (value) => {
      expect(() => validateEventImage(value, 'banner')).toThrow(
        'imagem de banner é inválida',
      );
    },
  );
});

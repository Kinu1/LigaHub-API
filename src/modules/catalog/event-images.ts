import { BadRequestException } from '@nestjs/common';

// O navegador reencoda os arquivos em WebP, sem SVG, URLs externas ou metadados originais.
export function validateEventImage(value: unknown, field: string): void {
  if (value === undefined || value === null) return;
  const invalid = () =>
    new BadRequestException(
      `A imagem de ${field} é inválida. Selecione novamente um arquivo PNG, JPG ou WebP.`,
    );
  if (
    typeof value !== 'string' ||
    value.length > 400_000 ||
    !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    throw invalid();
  const encoded = value.slice('data:image/webp;base64,'.length);
  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.length < 20 ||
    bytes.toString('base64') !== encoded ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP' ||
    bytes.readUInt32LE(4) + 8 !== bytes.length ||
    !['VP8 ', 'VP8L', 'VP8X'].includes(bytes.toString('ascii', 12, 16))
  )
    throw invalid();
}

import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  NotEquals,
  ValidateIf,
} from 'class-validator';

export class AuthorizeAccountDto {
  @IsOptional()
  @IsUUID('4', { message: 'O responsável informado é inválido.' })
  ownerId?: string;
}
export class CreatePaymentDto {
  @IsIn(['pix', 'card'], { message: 'Escolha Pix ou cartão.' }) method!:
    'pix' | 'card';
  @ValidateIf((input: CreatePaymentDto) => input.method === 'card')
  @IsString({ message: 'Informe o token de cartão gerado pelo Mercado Pago.' })
  @Matches(/^[a-zA-Z0-9_-]{1,256}$/, {
    message: 'O token do cartão é inválido.',
  })
  cardToken?: string;
  @ValidateIf((input: CreatePaymentDto) => input.method === 'card')
  @NotEquals('pix', {
    message: 'Escolha uma bandeira de cartão para pagamento com cartão.',
  })
  @IsString({ message: 'Informe a bandeira do cartão.' })
  @Matches(/^[a-zA-Z0-9_-]{1,64}$/, {
    message: 'O meio de pagamento é inválido.',
  })
  paymentMethodId?: string;
  @ValidateIf((_input: CreatePaymentDto, value: unknown) => value !== undefined)
  @IsString({ message: 'O emissor do cartão é inválido.' })
  @MaxLength(64, { message: 'O emissor do cartão é inválido.' })
  issuerId?: string;
  @ValidateIf((_input: CreatePaymentDto, value: unknown) => value !== undefined)
  @IsInt({ message: 'As parcelas devem ser um número inteiro.' })
  @Min(1, { message: 'Escolha no mínimo uma parcela.' })
  @Max(12, { message: 'Escolha no máximo 12 parcelas.' })
  installments = 1;
  @Matches(/^\d{11}$/, {
    message: 'Informe o CPF com 11 dígitos para o provedor de pagamento.',
  })
  cpf!: string;
}

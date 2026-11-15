import ExcelJS from 'exceljs';
import { Writable } from 'node:stream';

export const participantStatusLabels: Record<string, string> = {
  reserved: 'Reservada',
  expired: 'Expirada',
  confirmed: 'Confirmada',
  canceled: 'Cancelada',
  payment_review: 'Revisão necessária',
};
export const participantPaymentLabels: Record<string, string> = {
  free: 'Gratuita',
  unpaid: 'Sem pagamento',
  approved: 'Aprovado',
  pending: 'Pendente',
  created: 'Criado',
  in_process: 'Em análise',
  authorized: 'Autorizado',
  rejected: 'Recusado',
  canceled: 'Cancelado',
  cancelled: 'Cancelado',
  refunded: 'Reembolsado',
  charged_back: 'Contestado',
  in_mediation: 'Em mediação',
};
type ParticipantExportRow = {
  name: string;
  cpf: string | null;
  email: string;
  registrationTypeName: string | null;
  status: string;
  paymentStatus: string;
  financialStatus?: string;
  latestPaymentStatus?: string;
  financialWarnings?: string[];
  priceInCents: number;
};

export async function createParticipantsWorkbook(
  event: string,
  rows: Iterable<ParticipantExportRow> | AsyncIterable<ParticipantExportRow>,
) {
  // Only compressed XLSX bytes stay in memory; committed rows are released.
  // The controller sends the completed buffer, so failures cannot leak a partial file.
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream,
    useStyles: true,
    useSharedStrings: false,
  });
  workbook.creator = 'LigaHub';
  const sheet = workbook.addWorksheet('Participantes', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  sheet.columns = [
    { header: 'Evento', key: 'event', width: 40 },
    { header: 'Tipo de inscrição', key: 'type', width: 28 },
    { header: 'Nome completo', key: 'name', width: 36 },
    {
      header: 'CPF do participante',
      key: 'cpf',
      width: 23,
      style: { numFmt: '@' },
    },
    { header: 'E-mail', key: 'email', width: 38 },
    { header: 'Situação da inscrição', key: 'status', width: 25 },
    { header: 'Situação financeira', key: 'payment', width: 25 },
    {
      header: 'Valor da inscrição (R$)',
      key: 'price',
      width: 24,
      style: { numFmt: '"R$" #,##0.00' },
    },
    { header: 'Última tentativa', key: 'latestPayment', width: 25 },
    { header: 'Alertas financeiros', key: 'warnings', width: 48 },
  ];
  sheet.autoFilter = 'A1:J1';
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF9F1239' },
  };
  sheet.getRow(1).height = 24;
  try {
    for await (const row of rows)
      sheet
        .addRow({
          event,
          type: row.registrationTypeName ?? 'Inscrição geral',
          name: row.name,
          cpf: row.cpf ?? 'Não informado',
          email: row.email,
          status: participantStatusLabels[row.status] ?? row.status,
          payment:
            participantPaymentLabels[
              row.financialStatus ?? row.paymentStatus
            ] ??
            row.financialStatus ??
            row.paymentStatus,
          latestPayment:
            participantPaymentLabels[
              row.latestPaymentStatus ?? row.paymentStatus
            ] ??
            row.latestPaymentStatus ??
            row.paymentStatus,
          warnings: (row.financialWarnings ?? [])
            .map((warning) =>
              warning === 'multiple_approvals'
                ? 'Mais de um pagamento aprovado'
                : 'Histórico de contestação',
            )
            .join('; '),
          price: row.priceInCents / 100,
        })
        .commit();
    sheet.commit();
    await workbook.commit();
    return Buffer.concat(chunks);
  } finally {
    stream.destroy();
  }
}

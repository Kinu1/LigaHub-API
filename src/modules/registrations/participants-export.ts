import ExcelJS from 'exceljs';

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
  priceInCents: number;
};

export async function createParticipantsWorkbook(
  event: string,
  rows: ParticipantExportRow[],
) {
  const workbook = new ExcelJS.Workbook();
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
    { header: 'Status do pagamento', key: 'payment', width: 25 },
    {
      header: 'Valor da inscrição (R$)',
      key: 'price',
      width: 24,
      style: { numFmt: '"R$" #,##0.00' },
    },
  ];
  for (const row of rows)
    sheet.addRow({
      event,
      type: row.registrationTypeName ?? 'Inscrição geral',
      name: row.name,
      cpf: row.cpf ?? 'Não informado',
      email: row.email,
      status: participantStatusLabels[row.status] ?? row.status,
      payment: participantPaymentLabels[row.paymentStatus] ?? row.paymentStatus,
      price: row.priceInCents / 100,
    });
  sheet.autoFilter = 'A1:H1';
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF9F1239' },
  };
  sheet.getRow(1).height = 24;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

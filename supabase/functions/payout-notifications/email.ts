export interface PayoutEmailAttachment {
  filename: string;
  content: string;
}

export interface PayoutEmailInput {
  recipientName: string;
  amountCents: number;
  periodMonth: string;
  paymentReference: string;
  payoutsUrl: string;
  attachments?: PayoutEmailAttachment[];
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

export function formatPayoutAmount(amountCents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(amountCents / 100);
}

export function formatPayoutMonth(periodMonth: string) {
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(periodMonth);
  if (!match) throw new Error("Invalid payout month");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  return new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

export function formatPayoutEmail(input: PayoutEmailInput) {
  const name = input.recipientName.trim() || "franquiciado";
  const amount = formatPayoutAmount(input.amountCents);
  const month = formatPayoutMonth(input.periodMonth);
  const htmlName = escapeHtml(name);
  const htmlAmount = escapeHtml(amount);
  const htmlMonth = escapeHtml(month);
  const htmlReference = escapeHtml(input.paymentReference);
  const htmlUrl = escapeHtml(input.payoutsUrl);

  return {
    subject: `Pago realizado: ${month}`,
    html: `<!doctype html>
<html lang="es">
  <body style="margin:0;background:#f5f5f2;color:#1f2933;font-family:Arial,sans-serif">
    <main style="max-width:620px;margin:0 auto;padding:40px 24px">
      <p>Hola ${htmlName},</p>
      <h1 style="font-size:24px;line-height:1.25">Tu pago ha sido realizado</h1>
      <p>Hemos realizado el pago de <strong>${htmlAmount}</strong> correspondiente a <strong>${htmlMonth}</strong>.</p>
      <p>Referencia del pago: <strong>${htmlReference}</strong></p>
      <p style="margin:28px 0"><a href="${htmlUrl}" style="background:#172554;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">Ver pagos</a></p>
      <p>Gracias,<br>Equipo SoftLife</p>
    </main>
  </body>
</html>`,
    text: `Hola ${name},

Hemos realizado el pago de ${amount} correspondiente a ${month}.

Referencia del pago: ${input.paymentReference}

Consulta tus pagos: ${input.payoutsUrl}

Gracias,
Equipo SoftLife`,
    attachments: input.attachments ?? [],
  };
}

export interface ContractReminderEmailInput {
  recipientName: string;
  contractVersion: string;
  deadline: string;
  accountUrl: string;
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

export function formatContractReminderEmail(input: ContractReminderEmailInput) {
  const name = input.recipientName.trim() || "franquiciado";
  const htmlName = escapeHtml(name);
  const htmlVersion = escapeHtml(input.contractVersion);
  const htmlDeadline = escapeHtml(input.deadline);
  const htmlUrl = escapeHtml(input.accountUrl);

  return {
    subject: `Recordatorio: acepta las condiciones ${input.contractVersion} a más tardar el ${input.deadline}`,
    html: `<!doctype html>
<html lang="es">
  <body style="margin:0;background:#f5f5f2;color:#1f2933;font-family:Arial,sans-serif">
    <main style="max-width:620px;margin:0 auto;padding:40px 24px">
      <p>Hola ${htmlName},</p>
      <h1 style="font-size:24px;line-height:1.25">Actualización de las condiciones de gestión</h1>
      <p>Te recordamos que está pendiente la revisión y aceptación de la versión vigente <strong>${htmlVersion}</strong>.</p>
       <p>Por favor, completa la aceptación a más tardar el <strong>${htmlDeadline}</strong>.</p>
       <p>La falta de aceptación no bloqueará automáticamente tu acceso a la plataforma ni a tus documentos, pero el pago podrá quedar pendiente de revisión manual hasta que aceptes.</p>
      <p style="margin:28px 0"><a href="${htmlUrl}" style="background:#172554;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">Revisar y aceptar en mi cuenta</a></p>
      <p>También puedes abrir directamente <a href="${htmlUrl}">${htmlUrl}</a>.</p>
      <p>Si ya has aceptado esta versión, no tienes que hacer nada.</p>
      <p>Gracias,<br>Equipo SoftLife</p>
    </main>
  </body>
</html>`,
    text: `Hola ${name},

Te recordamos que está pendiente la revisión y aceptación de la versión vigente ${input.contractVersion}.

Por favor, completa la aceptación a más tardar el ${input.deadline}.

La falta de aceptación no bloqueará automáticamente tu acceso a la plataforma ni a tus documentos, pero el pago podrá quedar pendiente de revisión manual hasta que aceptes.

Revisar y aceptar en tu cuenta: ${input.accountUrl}

Si ya has aceptado esta versión, no tienes que hacer nada.

Gracias,
Equipo SoftLife`,
  };
}

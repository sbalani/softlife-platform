import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { contractPlainText, renderFranchiseeContract } from "./franchisee-onboarding-contract.ts";
import { canonicalJson, sha256Hex, type OnboardingCanonicalPayload } from "./franchisee-onboarding-evidence.ts";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;

function safeText(text: string, font: PDFFont): string {
  return [...text].map((character) => {
    try { font.encodeText(character); return character; } catch { return character === "•" ? "-" : "?"; }
  }).join("");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraphLine of text.split("\n")) {
    const words = safeText(paragraphLine, font).split(/\s+/).flatMap((word) => {
      if (font.widthOfTextAtSize(word, size) <= width) return [word];
      const chunks: string[] = [];
      let chunk = "";
      for (const character of word) {
        if (chunk && font.widthOfTextAtSize(`${chunk}${character}`, size) > width) { chunks.push(chunk); chunk = character; }
        else chunk += character;
      }
      if (chunk) chunks.push(chunk);
      return chunks;
    });
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else { if (line) lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [""];
}

export async function createOnboardingContractPdf(payload: OnboardingCanonicalPayload, sourceHash: string): Promise<{ bytes: Uint8Array; hash: string }> {
  const document = await PDFDocument.create();
  document.setTitle(`Contrato SoftLife ${payload.acceptanceId}`);
  document.setSubject(`Aceptación electrónica ${payload.contract.version}`);
  document.setAuthor("CONTROL ALT TECH 2026, S.L.");
  document.setCreator("SoftLife customer onboarding");
  document.setProducer("SoftLife / pdf-lib");
  document.setKeywords(["SoftLife", payload.contract.version, payload.acceptanceId, sourceHash]);
  document.setCreationDate(new Date(payload.acceptedAt));
  document.setModificationDate(new Date(payload.acceptedAt));
  const regular = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage;
  let y = 0;
  let pageNumber = 0;

  const addPage = () => {
    page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pageNumber += 1;
    y = PAGE_HEIGHT - MARGIN;
    page.drawText(`SoftLife | ${payload.contract.version} | ${payload.acceptanceId}`, { x: MARGIN, y: 24, size: 7, font: regular, color: rgb(0.38, 0.34, 0.31) });
    page.drawText(`Página ${pageNumber}`, { x: PAGE_WIDTH - 82, y: 24, size: 7, font: regular, color: rgb(0.38, 0.34, 0.31) });
  };
  const drawBlock = (text: string, options: { font?: PDFFont; size?: number; gap?: number; color?: ReturnType<typeof rgb> } = {}) => {
    const font = options.font ?? regular;
    const size = options.size ?? 9;
    const lineHeight = size * 1.35;
    for (const line of wrap(text, font, size, PAGE_WIDTH - MARGIN * 2)) {
      if (y < MARGIN + lineHeight) addPage();
      page!.drawText(line, { x: MARGIN, y, size, font, color: options.color ?? rgb(0.14, 0.12, 0.11) });
      y -= lineHeight;
    }
    y -= options.gap ?? 7;
  };

  addPage();
  const contract = renderFranchiseeContract(payload.manager, payload.acceptedAt);
  drawBlock(contract.title, { font: bold, size: 15, gap: 14, color: rgb(0.28, 0.16, 0.11) });
  for (const paragraph of contract.preamble) drawBlock(paragraph);
  for (const section of contract.sections) {
    drawBlock(section.title, { font: bold, size: 10.5, gap: 5, color: rgb(0.72, 0.32, 0.18) });
    for (const paragraph of section.paragraphs) drawBlock(paragraph);
  }

  if (y < 360) addPage();
  drawBlock("CERTIFICADO DE ACEPTACIÓN Y RESUMEN DE AUDITORÍA", { font: bold, size: 13, gap: 12, color: rgb(0.28, 0.16, 0.11) });
  const auditLines = [
    `ID de aceptación: ${payload.acceptanceId}`,
    `Fecha y hora UTC: ${payload.acceptedAt}`,
    `Versión del contrato: ${payload.contract.version}`,
    `Hash SHA-256 de plantilla: ${payload.contract.templateHash}`,
    `Firmante: ${payload.signer.name}`,
    `Capacidad: ${payload.signer.title}`,
    `Entidad: ${payload.manager.legalEntityName} (${payload.manager.taxId})`,
    `Email y teléfono: ${payload.signer.email} | ${payload.signer.phone}`,
    `Modalidad y participación: ${payload.manager.modality} | ${payload.manager.sharePercent}% de ventas netas`,
    `Hash SHA-256 de carga fuente: ${sourceHash}`,
    `Huella HMAC de IP (no es la IP en claro): ${payload.audit.ipAuditHash}`,
    `Agente de usuario: ${payload.audit.userAgent}`,
  ];
  auditLines.forEach((line) => drawBlock(line, { size: 8.5, gap: 3 }));
  drawBlock("Declaraciones registradas", { font: bold, size: 10, gap: 6 });
  drawBlock(`1. Aceptada: ${payload.declarations.terms.wording}`, { size: 8.5, gap: 3 });
  drawBlock(`2. Aceptada: ${payload.declarations.authority.wording}`, { size: 8.5, gap: 3 });
  drawBlock(`3. Aceptada: ${payload.declarations.evidence.wording}`, { size: 8.5, gap: 3 });
  drawBlock(`Acción inequívoca: botón \"${payload.declarations.buttonLabel}\". Firma escrita: ${payload.signer.typedSignature}`, { size: 8.5 });
  drawBlock("Este certificado documenta aceptación electrónica y evidencias de apoyo. No afirma que exista firma electrónica cualificada o PAdES ni garantiza por sí solo la ejecutabilidad jurídica.", { font: bold, size: 8.5 });
  drawBlock(`Carga fuente canónica exacta: ${canonicalJson(payload)}`, { size: 6.5 });
  document.setSubject(`${document.getSubject()} | Texto ${sha256Hex(contractPlainText(contract))}`);
  const bytes = await document.save({ useObjectStreams: false, addDefaultPage: false });
  return { bytes, hash: sha256Hex(bytes) };
}

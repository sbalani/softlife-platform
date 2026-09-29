export const FRANCHISEE_CONTRACT_VERSION = "SL-GESTOR-2026-09-29-v2";
export const FRANCHISEE_CONTRACT_TEMPLATE_HASH = "50fc46c68c4a281256431a08ca5381c9b366f5d958d1943ed1af36b4f342bdef";

export const ACCEPTANCE_DECLARATION = "He revisado y acepto íntegramente todas las condiciones del contrato vinculante en español.";
export const AUTHORITY_DECLARATION = "Declaro que tengo facultades suficientes para obligar a la entidad gestora indicada.";
export const EVIDENCE_DECLARATION = "Reconozco que la aceptación electrónica generará evidencias técnicas y un PDF exacto del contrato aceptado.";
export const ACCEPT_BUTTON_LABEL = "Aceptar y firmar contrato";

export type ContractPartyValues = {
  representativeName: string;
  representativeEmail: string;
  representativePhone: string;
  representativeTitle: string;
  legalEntityName: string;
  taxId: string;
  registeredAddress: string;
  tradeName: string | null;
  installationAddress: string;
  accountHolderName: string | null;
  iban: string | null;
  bicSwift: string | null;
  bankDetailsDeferred: boolean;
};

export type ContractSection = { title: string; paragraphs: string[] };

export type RenderedContract = {
  title: string;
  preamble: string[];
  sections: ContractSection[];
};

const value = (input: string | null | undefined, fallback: string) => input?.trim() || fallback;

export function renderFranchiseeContract(input: Partial<ContractPartyValues>, acceptedAt?: string): RenderedContract {
  const representativeName = value(input.representativeName, "[nombre del representante]");
  const representativeEmail = value(input.representativeEmail, "[email]");
  const representativePhone = value(input.representativePhone, "[teléfono]");
  const representativeTitle = value(input.representativeTitle, "[cargo/capacidad]");
  const legalEntityName = value(input.legalEntityName, "[empresa/autónomo]");
  const taxId = value(input.taxId, "[NIF]");
  const registeredAddress = value(input.registeredAddress, "[domicilio registrado]");
  const tradeName = value(input.tradeName, "[sin nombre comercial distinto]");
  const installationAddress = value(input.installationAddress, "[dirección exacta propuesta]");
  const accountHolderName = value(input.accountHolderName, "[titular de la cuenta]");
  const iban = value(input.iban, "[IBAN]");
  const bic = value(input.bicSwift, "[sin BIC indicado]");
  const bankDetailsDeferred = input.bankDetailsDeferred === true;
  const acceptanceDate = acceptedAt
    ? new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "long", timeZone: "Europe/Madrid" }).format(new Date(acceptedAt))
    : "[fecha y hora UTC generadas por el servidor al aceptar]";

  return {
    title: "CONTRATO DE CESIÓN DE MAQUINARIA EN DEPÓSITO Y EXPLOTACIÓN COMERCIAL",
    preamble: [
      `En Málaga, en la fecha de aceptación electrónica ${acceptanceDate}.`,
      "DE UNA PARTE: La mercantil CONTROL ALT TECH 2026, S.L. (en adelante, SOFTLIFE), con NIF B88827340, domicilio social en C/Compositor Lembergh Ruiz 30, Local 2, Málaga 29007, representada por Sharan Raju Balani Balani, en su calidad de Director, con facultades suficientes para este otorgamiento.",
      `DE OTRA PARTE: La entidad ${legalEntityName}, con NIF ${taxId}, domicilio social en ${registeredAddress}, nombre comercial ${tradeName}, representada por ${representativeName}, en su calidad de ${representativeTitle}, email ${representativeEmail} y teléfono ${representativePhone} (en adelante, el GESTOR).`,
      "Ambas partes se reconocen mutuamente capacidad legal suficiente para obligarse y celebrar el presente contrato y, a tal efecto, EXPONEN:",
      "I. Que SOFTLIFE es propietaria en exclusiva de máquinas expendedoras automatizadas de helado soft hecho al momento a partir de bases UHT y adición de toppings, las cuales disponen de sistemas avanzados de pasteurización, desinfección UV y telemetría de control (en adelante, la MÁQUINA).",
      "II. Que el GESTOR está interesado en la instalación y explotación de la MÁQUINA en el establecimiento o local de su titularidad, o en la ubicación designada de mutuo acuerdo, con el fin de comercializar helado soft de la marca controlada por SOFTLIFE.",
      "III. Que ambas partes han acordado regular dicha cesión, explotación y suministro conforme a las siguientes cláusulas.",
    ],
    sections: [
      {
        title: "PRIMERA. OBJETO DEL CONTRATO Y PROPIEDAD",
        paragraphs: [
          "SOFTLIFE cede en régimen de depósito gratuito al GESTOR, quien acepta, la MÁQUINA que será identificada conforme al Anexo I. Queda expresamente pactado que la MÁQUINA es propiedad exclusiva y permanente de SOFTLIFE. El GESTOR ostenta la condición de mero depositario y no podrá vender, ceder, arrendar, pignorar, gravar ni trasladar la maquinaria sin el consentimiento previo y por escrito de SOFTLIFE.",
        ],
      },
      {
        title: "SEGUNDA. SUMINISTRO DE MATERIA PRIMA Y CONSUMIBLES",
        paragraphs: [
          "1. SOFTLIFE se compromete a garantizar de forma constante la disponibilidad y el adelanto de la materia prima (base UHT, toppings y salsas) y los consumibles necesarios (tarrinas y cucharas) para la producción del helado.",
          "2. El GESTOR tiene la obligación estricta y exclusiva de utilizar únicamente la materia prima y los consumibles facilitados por SOFTLIFE, quedando terminantemente prohibido introducir productos ajenos a la marca en la MÁQUINA.",
        ],
      },
      {
        title: "TERCERA. UBICACIÓN, ACCESIBILIDAD Y VISIBILIDAD",
        paragraphs: [
          `El GESTOR es el único responsable de garantizar que la MÁQUINA esté situada en una buena ubicación dentro de su establecimiento, con máxima visibilidad para el público y total accesibilidad, cumpliendo los requisitos de conexión eléctrica y espacio que determine SOFTLIFE. La dirección autorizada inicialmente es ${installationAddress}. Cualquier cambio de ubicación dentro o fuera del establecimiento requerirá la aprobación previa y por escrito de SOFTLIFE.`,
        ],
      },
      {
        title: "CUARTA. MODALIDAD DE OPERACIÓN, HIGIENE Y RETRIBUCIÓN",
        paragraphs: [
          "Las partes acuerdan que la operativa diaria, la limpieza, el mantenimiento higiénico y la retribución económica se regirán obligatoriamente por una de las dos modalidades siguientes:",
          "MODALIDAD A - GESTIÓN TOTAL POR EL GESTOR (26 %). Operativa: el GESTOR se encarga por completo de la reposición diaria de la materia prima y consumibles y de la limpieza regular de las boquillas y elementos desmontables de la MÁQUINA. Formación: el personal asignado por el GESTOR deberá recibir obligatoriamente la formación técnica e higiénico-sanitaria impartida por SOFTLIFE y contar con el carnet de manipulador de alimentos vigente. Estándares: el GESTOR se compromete a seguir rigurosamente el protocolo de higiene del Anexo II y a cumplimentar el checklist digital obligatorio. Retribución: el GESTOR recibirá el 26 % de la facturación neta (ventas totales sin IVA) generada por la MÁQUINA.",
          "MODALIDAD B - GESTIÓN DE REPOSICIÓN POR SOFTLIFE (18 %). Operativa: SOFTLIFE, o el personal técnico que designe, se encargará directamente de la reposición de insumos y consumibles y de la limpieza y desinfección integral de la MÁQUINA. Obligación del GESTOR: custodiar la MÁQUINA, facilitar el acceso inmediato al personal de SOFTLIFE y reportar incidencias. Retribución: el GESTOR recibirá el 18 % de la facturación neta (ventas totales sin IVA) generada por la MÁQUINA.",
          "La asignación de la Modalidad A o B corresponde exclusivamente a SOFTLIFE. El GESTOR no elige modalidad mediante esta aceptación. SOFTLIFE la asignará antes de la instalación y del inicio de la operación, la comunicará al GESTOR y la hará constar, junto con el porcentaje aplicable, en el acta de instalación/entrega posterior firmada por ambas partes.",
          "Facturación de la retribución del GESTOR por el destinatario. El GESTOR, como empresario o profesional que presta a SOFTLIFE los servicios de ubicación, custodia y, según la modalidad asignada por SOFTLIFE, operación de la MÁQUINA, autoriza expresamente a SOFTLIFE, con carácter previo a dichas prestaciones, a expedir materialmente en nombre y por cuenta del GESTOR las facturas correspondientes exclusivamente a la retribución prevista en esta cláusula. Esta autorización se aplica a las prestaciones realizadas desde la aceptación del contrato y durante su vigencia; no comprende las ventas de helados a consumidores, que corresponden a SOFTLIFE. El GESTOR conserva la responsabilidad legal de sus obligaciones de facturación y fiscales.",
          "Por cada periodo mensual, SOFTLIFE calculará la base de la retribución conforme a la modalidad pactada y emitirá la factura con el GESTOR como prestador/emisor y SOFTLIFE como destinataria, identificando el periodo y la MÁQUINA o ubicación, con una serie específica, numeración correlativa y la mención «facturación por el destinatario». A la base se añadirá el IVA que legalmente corresponda a la prestación del GESTOR, si procede; el porcentaje de reparto se calcula sobre las ventas sin IVA de los helados y no incluye el IVA de esta factura. SOFTLIFE remitirá al GESTOR una copia de cada factura y el detalle de cálculo al correo electrónico designado, dejando constancia de su envío.",
          "El GESTOR dispondrá de diez (10) días hábiles desde la recepción para aceptar cada factura por escrito o comunicar por el mismo medio una objeción motivada. Acreditada la entrega y transcurrido ese plazo sin objeción, la factura se entenderá aceptada. En caso de discrepancia, las partes contrastarán los datos de venta y, cuando corresponda, SOFTLIFE emitirá la factura rectificativa o sustitutiva procedente, remitiendo también copia para su aceptación. El GESTOR facilitará y mantendrá actualizados sus datos fiscales y comunicará cualquier cambio de régimen tributario que afecte a estas facturas.",
          bankDetailsDeferred
            ? "Los datos bancarios quedan pendientes de aportación. La incorporación y aceptación del GESTOR pueden continuar, pero SOFTLIFE no podrá realizar ningún pago de participación en ingresos hasta que el GESTOR facilite datos bancarios completos y válidos por un canal aceptado por SOFTLIFE. Toda remuneración por participación en ingresos se pagará exclusivamente mediante transferencia bancaria o ingreso bancario y nunca en efectivo."
            : `Toda remuneración por participación en ingresos que SOFTLIFE abone al GESTOR se pagará exclusivamente mediante transferencia bancaria o ingreso bancario en la cuenta designada por el GESTOR, cuyo titular es ${accountHolderName}, IBAN ${iban}, BIC/SWIFT ${bic}. No se realizarán pagos en efectivo. El GESTOR es responsable de mantener los datos bancarios vigentes, completos y correctos y de comunicar cualquier cambio por un canal aceptado por SOFTLIFE.`,
        ],
      },
      {
        title: "QUINTA. MANTENIMIENTO TÉCNICO Y CONTROL TELEMÁTICO",
        paragraphs: [
          "1. SOFTLIFE será la única responsable del mantenimiento técnico correctivo y preventivo de la MÁQUINA, así como de la calibración de sus sistemas internos.",
          "2. La MÁQUINA incorpora un sistema de control telemático en tiempo real (Nayax u homólogo) propiedad de SOFTLIFE que monitoriza de forma constante las ventas, el stock y la temperatura de la cuba.",
          "3. El GESTOR acepta expresamente que el software está programado para bloquear automáticamente la venta si los sensores detectan cualquier anomalía de temperatura que ponga en riesgo la seguridad alimentaria, sin derecho a indemnización por los periodos de parada técnica derivados de esta protección de salud pública.",
        ],
      },
      {
        title: "SEXTA. PROMOCIÓN COMERCIAL",
        paragraphs: [
          "SOFTLIFE asumirá la responsabilidad y los costes de la promoción y el marketing de la MÁQUINA, incluido el diseño de la interfaz de la pantalla de 32 pulgadas, la cartelería corporativa y las promociones de red, con el objetivo de maximizar las ventas en beneficio mutuo.",
        ],
      },
      {
        title: "SÉPTIMA. RENDIMIENTO COMERCIAL Y DERECHO DE RETIRADA",
        paragraphs: [
          "1. Las partes acuerdan que no existe una cifra mínima mensual fija incorporada al contrato. La viabilidad comercial de la ubicación se evaluará mediante los requisitos de rendimiento aplicables a esa ubicación y reflejados o comunicados a través del dashboard de SOFTLIFE.",
          "2. SOFTLIFE podrá resolver anticipadamente el contrato y retirar la MÁQUINA cuando los indicadores objetivos del emplazamiento, incluidos volumen de ventas, facturación, días de operación, regularidad y otros parámetros objetivos relevantes para la ubicación, no cumplan los requisitos comerciales definidos para ella. La retirada no generará derecho a indemnización o reclamación por parte del GESTOR.",
          "3. SOFTLIFE podrá retirar la MÁQUINA de forma inmediata si, mediante auditorías de vídeo, logs del sistema o inspecciones físicas, comprueba que el GESTOR, en Modalidad A, incumple gravemente los estándares de higiene, reposición o calidad del Anexo II.",
        ],
      },
      {
        title: "OCTAVA. DURACIÓN Y RESCISIÓN",
        paragraphs: [
          "El contrato tendrá una duración de un (1) año desde su aceptación y se prorrogará automáticamente por periodos iguales si ninguna parte manifiesta lo contrario con un preaviso mínimo de treinta (30) días naturales. Esta duración no limita el derecho de SOFTLIFE a la terminación anticipada y retirada previsto en la cláusula séptima ni otros derechos de resolución por incumplimiento.",
        ],
      },
      {
        title: "NOVENA. LEGISLACIÓN APLICABLE Y JURISDICCIÓN",
        paragraphs: [
          "El contrato se regirá por la legislación española. Para cualquier discrepancia derivada de su interpretación o ejecución, las partes se someten expresamente a los juzgados y tribunales de Málaga, renunciando a cualquier otro fuero que pudiera corresponderles, salvo que una norma imperativa disponga lo contrario.",
        ],
      },
      {
        title: "DÉCIMA. OFERTA Y ACEPTACIÓN ELECTRÓNICA",
        paragraphs: [
          "SOFTLIFE emite el presente contrato como oferta contractual en español. El GESTOR lo acepta electrónicamente tras visualizar su texto completo, confirmar por separado la aceptación íntegra y sus facultades de representación, reconocer la generación de evidencias técnicas y escribir un nombre de firma coincidente con el del representante. Esta aceptación no selecciona una modalidad.",
          "La plataforma generará una fecha y hora de servidor, un identificador único, una carga fuente canónica y un PDF exacto, con hashes SHA-256 y huella técnica de auditoría. Se facilitará acceso inmediato al PDF confirmado. Estos elementos documentan una aceptación electrónica ordinaria y no constituyen una afirmación de firma electrónica cualificada o PAdES ni una garantía absoluta de ejecutabilidad jurídica.",
          "En prueba de conformidad, SOFTLIFE emite esta oferta y el GESTOR manifiesta su aceptación electrónica a un solo efecto, en el lugar y fecha indicados al comienzo.",
        ],
      },
      {
        title: "ANEXO I. RELACIÓN DE MAQUINARIA CEDIDA",
        paragraphs: [
          "Modelo de la MÁQUINA: pendiente de asignación.",
          "Número de serie / IMEI del sistema IoT: pendiente de asignación.",
          `Dirección exacta de la ubicación autorizada: ${installationAddress}.`,
          "El modelo, número de serie/IMEI, fecha y estado de entrega, así como la modalidad y el porcentaje asignados exclusivamente por SOFTLIFE, se harán constar posteriormente en un acta de instalación/entrega firmada por ambas partes. Esa acta se incorporará al contrato y formará parte integrante de él sin sustituir esta aceptación.",
        ],
      },
      {
        title: "ANEXO II. ESTÁNDARES OPERATIVOS Y DE CALIDAD PARA MODALIDAD A",
        paragraphs: [
          "1. Limpieza manual: es obligatorio desinfectar físicamente las boquillas externas de salida con la solución higienizante homologada cada día de operación y siempre que sea necesario para mantener condiciones higiénicas adecuadas.",
          "2. Uso de guantes y grabación: toda manipulación para abrir el compartimento estanco de la base UHT o recargar los contenedores independientes de toppings y salsas se realizará obligatoriamente con guantes desechables y mascarilla. El proceso se realiza bajo la zona de grabación de seguridad instalada en la MÁQUINA.",
          "3. Registro digital: el operario del GESTOR deberá validar el checklist electrónico en el software de la MÁQUINA antes de habilitar el modo «En Venta». El incumplimiento de tres checklists semanales facultará a SOFTLIFE para el cambio forzoso a la Modalidad B o la retirada del equipo.",
        ],
      },
    ],
  };
}

export function contractPlainText(contract: RenderedContract): string {
  return [contract.title, ...contract.preamble, ...contract.sections.flatMap((section) => [section.title, ...section.paragraphs])].join("\n\n");
}

const TEMPLATE_VALUES = {
  representativeName: "{{representative_name}}",
  representativeEmail: "{{representative_email}}",
  representativePhone: "{{representative_phone}}",
  representativeTitle: "{{representative_title}}",
  legalEntityName: "{{legal_entity_name}}",
  taxId: "{{tax_id}}",
  registeredAddress: "{{registered_address}}",
  tradeName: "{{trade_name}}",
  installationAddress: "{{installation_address}}",
  accountHolderName: "{{account_holder_name}}",
  iban: "{{iban}}",
  bicSwift: "{{bic_swift}}",
  bankDetailsDeferred: false,
} as const;

export const FRANCHISEE_CONTRACT_TEMPLATE_SOURCE = [
  contractPlainText(renderFranchiseeContract(TEMPLATE_VALUES)),
  "--- VARIANTE DATOS BANCARIOS DIFERIDOS ---",
  contractPlainText(renderFranchiseeContract({ ...TEMPLATE_VALUES, accountHolderName: null, iban: null, bicSwift: null, bankDetailsDeferred: true })),
].join("\n\n");

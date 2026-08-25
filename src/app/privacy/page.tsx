import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Política de privacidad | SoftLife",
  description: "Información sobre el tratamiento de datos personales en la plataforma SoftLife.",
};

const section = "rounded-2xl border border-line bg-white p-5 sm:p-7";
const heading = "font-display text-xl font-bold text-cocoa";
const copy = "mt-3 space-y-3 text-sm leading-7 text-taupe";

export default function PrivacyPage() {
  return (
    <main lang="es" className="min-h-screen bg-cream px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8">
          <Link href="/login" className="inline-flex items-center gap-3" aria-label="Ir al acceso de SoftLife">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-terracotta font-display text-xl font-bold text-white">S</span>
            <span>
              <span className="block font-display text-lg font-bold leading-tight text-cocoa">SoftLife</span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.2em] text-taupe">Platform</span>
            </span>
          </Link>
          <p className="mt-10 text-xs font-bold uppercase tracking-[0.22em] text-terracotta">Información legal</p>
          <h1 className="mt-2 font-display text-4xl font-bold text-cocoa sm:text-5xl">Política de privacidad</h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-taupe">Esta política explica cómo se tratan los datos personales al utilizar la plataforma, las aplicaciones y los servicios operativos de SoftLife.</p>
          <p className="mt-2 text-xs font-semibold text-taupe">Última actualización: 25 de agosto de 2026</p>
        </header>

        <div className="space-y-4">
          <section className={section}>
            <h2 className={heading}>1. Responsable del tratamiento</h2>
            <div className={copy}>
              <p>El responsable es SoftLife, la entidad identificada como tal en el contrato o relación comercial correspondiente.</p>
              <p>Contacto para cuestiones de privacidad y para ejercer derechos: <a href="mailto:hola@softlife.es" className="font-bold text-terracotta hover:underline">hola@softlife.es</a>.</p>
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>2. Datos que tratamos</h2>
            <div className={copy}>
              <p>Podemos tratar datos identificativos y profesionales, como nombre, correo electrónico, empresa, función, franquicia o relación con SoftLife.</p>
              <p>También tratamos datos de cuenta y seguridad, registros de acceso, identificadores técnicos, información del dispositivo y datos necesarios para prestar soporte y proteger la plataforma.</p>
              <p>Cuando se utilizan funciones operativas, podemos tratar informes de servicio, limpieza y reposición, notas, fotografías, grabaciones de voz, transcripciones, incidencias, asignaciones y actividad relacionada con máquinas. La telemetría de máquinas normalmente no identifica por sí sola a una persona, pero puede asociarse a una cuenta o actuación profesional.</p>
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>3. Finalidades y bases jurídicas</h2>
            <div className={copy}>
              <p>Tratamos los datos para crear y administrar cuentas; autenticar usuarios; prestar la plataforma y sus funciones; gestionar máquinas, inventario, incidencias y operaciones; atender consultas; mantener la seguridad; prevenir usos indebidos; y conservar evidencias y trazabilidad.</p>
              <p>Las bases jurídicas aplicables son la ejecución de un contrato o la aplicación de medidas precontractuales; el cumplimiento de obligaciones legales; y el interés legítimo de SoftLife y sus colaboradores en operar, proteger y mejorar el servicio. Cuando la normativa lo exija, solicitaremos consentimiento, que podrá retirarse sin afectar a la licitud del tratamiento anterior.</p>
              <p>No se adoptan decisiones con efectos jurídicos basadas únicamente en tratamientos automatizados. Algunas funciones pueden usar herramientas automáticas o de inteligencia artificial para transcribir, clasificar o proponer información, sujeta a revisión humana cuando corresponda.</p>
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>4. Conservación</h2>
            <div className={copy}>
              <p>Conservamos los datos mientras la cuenta o relación contractual esté activa y durante el tiempo necesario para prestar el servicio. Después podrán mantenerse bloqueados durante los plazos exigidos para atender obligaciones legales y posibles responsabilidades.</p>
              <p>Los registros de seguridad, archivos temporales y evidencias operativas se conservan solo durante el periodo razonablemente necesario para su finalidad, salvo que deban preservarse por una incidencia, reclamación u obligación legal.</p>
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>5. Destinatarios y transferencias internacionales</h2>
            <div className={copy}>
              <p>Los datos podrán comunicarse a franquicias, clientes, empleadores o colaboradores cuando sea necesario para gestionar las máquinas y servicios que tengan asignados, siempre conforme a su función y permisos.</p>
              <p>También utilizamos proveedores tecnológicos que actúan como encargados del tratamiento para alojamiento, base de datos, autenticación, almacenamiento, notificaciones, soporte, comunicaciones y funciones de inteligencia artificial. Algunos proveedores pueden tratar datos fuera del Espacio Económico Europeo. En esos casos se aplicarán mecanismos reconocidos por el RGPD, como decisiones de adecuación o cláusulas contractuales tipo, cuando sean necesarios.</p>
              <p>Podremos comunicar información a autoridades y organismos públicos cuando exista una obligación legal.</p>
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>6. Derechos</h2>
            <div className={copy}>
              <p>Puedes solicitar el acceso, rectificación, supresión, oposición, limitación y portabilidad de tus datos, así como retirar el consentimiento cuando el tratamiento se base en él.</p>
              <p>Para ejercer estos derechos, escribe a <a href="mailto:hola@softlife.es" className="font-bold text-terracotta hover:underline">hola@softlife.es</a>, indicando el derecho que deseas ejercer y la información necesaria para verificar tu identidad. Podremos solicitar documentación adicional si existen dudas razonables sobre la identidad del solicitante.</p>
              <p>También puedes presentar una reclamación ante la <a href="https://www.aepd.es" target="_blank" rel="noreferrer" className="font-bold text-terracotta hover:underline">Agencia Española de Protección de Datos (AEPD)</a>.</p>
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>7. Seguridad y obligaciones del usuario</h2>
            <div className={copy}>
              <p>Aplicamos medidas técnicas y organizativas razonables para proteger los datos frente a pérdida, alteración, acceso o divulgación no autorizados. Ningún sistema puede garantizar una seguridad absoluta.</p>
              <p>Los usuarios deben mantener sus credenciales confidenciales, utilizar la plataforma únicamente para fines autorizados y evitar incluir datos personales innecesarios o especialmente sensibles en notas, fotografías, audio u otros campos libres.</p>
            </div>
          </section>

          <section className={section}>
            <h2 className={heading}>8. Menores, cookies y cambios</h2>
            <div className={copy}>
              <p>La plataforma está dirigida a usuarios profesionales y no a menores de 14 años. No recopilamos conscientemente datos de menores a través de este servicio.</p>
              <p>Podemos utilizar cookies o tecnologías estrictamente necesarias para iniciar sesión, mantener la sesión y proteger la plataforma. Si se incorporan tecnologías no necesarias, se facilitará la información y las opciones de consentimiento exigidas por la normativa.</p>
              <p>Podremos actualizar esta política para reflejar cambios legales, técnicos o del servicio. La versión vigente estará siempre disponible en esta página y mostrará su fecha de actualización.</p>
            </div>
          </section>
        </div>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-xs text-taupe">
          <span>© 2026 SoftLife</span>
          <Link href="/login" className="font-bold text-terracotta hover:underline">Volver al acceso</Link>
        </footer>
      </div>
    </main>
  );
}

import Image from "next/image";
import QRCode from "qrcode";
import { machineServiceUrl } from "@/lib/data/service-url";

export async function MachineServiceQr({ machineId, machineName }: { machineId: string; machineName: string }) {
  const url = machineServiceUrl(machineId);
  const qr = await QRCode.toDataURL(url, { width: 240, margin: 1, color: { dark: "#442C24", light: "#FFFFFF" } });
  return (
    <section className="mb-6 rounded-2xl border border-line bg-white p-5">
      <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <h2 className="font-display text-lg font-bold text-cocoa">Cleaning &amp; refill QR</h2>
          <p className="mt-1 max-w-xl text-sm text-taupe">Scan at the machine to record a refill, a full clean, or both. The permanent HTTPS link also provides an “Open in app” option.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href={url} target="_blank" rel="noreferrer" className="rounded-lg bg-cocoa px-4 py-2 text-sm font-bold text-white">Open service page</a>
            <a href={qr} download={`${machineName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-service-qr.png`} className="rounded-lg border border-line px-4 py-2 text-sm font-bold text-cocoa">Download QR</a>
          </div>
          <p className="mt-3 break-all font-mono text-[10px] text-taupe">{url}</p>
        </div>
        <Image src={qr} alt={`Service QR for ${machineName}`} width={180} height={180} unoptimized className="rounded-xl border border-line" />
      </div>
    </section>
  );
}

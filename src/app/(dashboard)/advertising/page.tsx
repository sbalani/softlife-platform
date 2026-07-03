import { getMediaItems } from "@/lib/data/media";
import { getMachines } from "@/lib/data/machines";
import { MediaUploader } from "./MediaUploader";
import { MediaLibraryCard } from "./MediaLibraryCard";

export const dynamic = "force-dynamic";

export default async function AdvertisingPage() {
  const [items, { machines }] = await Promise.all([getMediaItems(), getMachines()]);

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Advertising</h1>
        <p className="mt-1 text-sm text-taupe">
          {items.length} media item{items.length === 1 ? "" : "s"} in the library — upload once, assign to multiple machines
        </p>
      </header>

      <section className="mb-6 rounded-2xl border border-line bg-white p-5">
        <h2 className="mb-4 font-display text-lg font-bold text-cocoa">Upload media</h2>
        <MediaUploader />
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <MediaLibraryCard key={item.id} item={item} machines={machines} />
        ))}
      </div>

      {items.length === 0 && (
        <p className="rounded-2xl border border-line bg-white p-10 text-center text-taupe">
          No media yet. Upload advertising images or videos above.
        </p>
      )}
    </div>
  );
}

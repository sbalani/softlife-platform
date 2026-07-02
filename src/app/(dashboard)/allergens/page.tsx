import { getAllergens } from "@/lib/data/allergens";
import { setAllergenLogo } from "./actions";

export const dynamic = "force-dynamic";

export default async function AllergensPage() {
  const allergens = await getAllergens();

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold text-cocoa">Allergens</h1>
        <p className="mt-1 text-sm text-taupe">
          Standard registry. Upload a logo for each — used across ingredients and the machine screen.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {allergens.map((a) => (
          <div key={a.id} className="rounded-2xl border border-line bg-white p-4">
            <div className="flex items-center gap-3">
              {a.logo_url ? (
                <img src={a.logo_url} alt={a.name} className="h-12 w-12 rounded-lg bg-cream object-contain p-1" />
              ) : (
                <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-cream text-lg font-bold text-taupe">{a.name[0]}</span>
              )}
              <div>
                <div className="font-display font-bold text-cocoa">{a.name}</div>
                <div className="text-xs text-taupe">{a.slug}</div>
              </div>
            </div>
            <form action={setAllergenLogo} className="mt-3 flex items-center gap-2">
              <input type="hidden" name="id" value={a.id} />
              <input
                type="file"
                name="logo"
                accept="image/*"
                className="flex-1 text-xs text-cocoa file:mr-2 file:rounded file:border-0 file:bg-cream file:px-2 file:py-1 file:text-xs"
              />
              <button type="submit" className="rounded-lg bg-cocoa px-3 py-1 text-xs font-bold text-white hover:opacity-90">
                Upload
              </button>
            </form>
          </div>
        ))}
      </div>
    </div>
  );
}

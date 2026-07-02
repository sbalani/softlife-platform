import sharp from "sharp";

type AllergenLogo = { logo_url: string; dim?: boolean };

/** Composites allergen logos into a single image for the machine screen (Huaxin allergyPath).
 *  "Contains" logos at full opacity, "may contain" dimmed. Returns null if none have logos. */
export async function generateAllergenComposite(allergens: AllergenLogo[]): Promise<Buffer | null> {
  const withLogos = allergens.filter((a) => a.logo_url);
  if (withLogos.length === 0) return null;

  const SIZE = 64;
  const GAP = 10;
  const COLS = Math.min(withLogos.length, 6);
  const ROWS = Math.ceil(withLogos.length / COLS);
  const W = COLS * (SIZE + GAP) + GAP;
  const H = ROWS * (SIZE + GAP) + GAP;

  const composites = await Promise.all(
    withLogos.map(async (a, i) => {
      const res = await fetch(a.logo_url);
      const buf = Buffer.from(await res.arrayBuffer());
      let img = sharp(buf).resize(SIZE, SIZE, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      });
      if (a.dim) {
        img = img.modulate({ brightness: 0.5 });
      }
      const png = await img.png().toBuffer();
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      return { input: png, left: GAP + col * (SIZE + GAP), top: GAP + row * (SIZE + GAP) };
    }),
  );

  return sharp({
    create: { width: W, height: H, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

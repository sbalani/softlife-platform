import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "More Ice Theme Builder | SoftLife",
  description: "Build a USB-ready More Ice theme package locally in your browser.",
};

export default function MoreIceThemeBuilderPage() {
  return (
    <main className="h-dvh w-full overflow-hidden bg-[#16213a]">
      <iframe
        className="h-full w-full border-0"
        src="/more-ice-theme-builder/index.html"
        title="More Ice Theme Builder"
        sandbox="allow-downloads allow-forms allow-modals allow-scripts"
      />
    </main>
  );
}

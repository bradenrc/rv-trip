import { ImageResponse } from "next/og";

/**
 * The one raster in the tree — and it is generated, not committed.
 *
 * iOS Add-to-Home-Screen ignores the manifest's icons and reads
 * `<link rel="apple-touch-icon">`, which will not take an SVG. Next's
 * `apple-icon.tsx` file convention runs this at build and emits both the PNG
 * and that link tag, so `app/icon.svg` stays the single source of the mark's
 * geometry and no binary asset lands in git.
 *
 * The mark is the masthead's (Nav.tsx:24-27): lucide's Compass at
 * `fill="currentColor" strokeWidth={1.5}` in rv-green-on-dark (#34d399) on
 * rv-navy (#020617), drawn at the same 19/32 of the square. No border radius —
 * iOS applies its own mask. Hexes, not tokens: a rasteriser has no CSS.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// 19/32 of the 180px square, the proportion Nav.tsx's size-[19px] glyph has
// inside its size-8 tile.
const GLYPH = Math.round((size.width * 19) / 32);

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#020617",
        }}
      >
        <svg
          width={GLYPH}
          height={GLYPH}
          viewBox="0 0 24 24"
          fill="#34d399"
          stroke="#34d399"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z" />
        </svg>
      </div>
    ),
    { ...size },
  );
}

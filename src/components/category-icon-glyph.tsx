import { createElement } from "react";

import { getCategoryIcon } from "@/lib/site";

type CategoryIconGlyphProps = {
  slug: string;
  size?: number;
  stroke?: number;
};

export function CategoryIconGlyph({
  slug,
  size = 18,
  stroke = 1.75,
}: CategoryIconGlyphProps) {
  return createElement(getCategoryIcon(slug), { size, stroke });
}

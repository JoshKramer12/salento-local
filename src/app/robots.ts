import type { MetadataRoute } from "next";

import { publicUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  // Private pages must remain crawlable so their noindex directives can be read.
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: publicUrl("/sitemap.xml"),
  };
}

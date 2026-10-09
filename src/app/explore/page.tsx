import type { Metadata } from "next";

import DirectoryPage from "@/app/directory/page";
import { discoveryMetadata } from "@/lib/seo";

export async function generateMetadata({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  return {
    title: "Explore | Salento Local",
    description: "Browse the full Salento directory without leaving the explore route.",
    ...discoveryMetadata("/directory", await searchParams),
  };
}

export default DirectoryPage;

"use client";

import { useState } from "react";

type BusinessImageGalleryImage = {
  alt: string;
  id: string;
  src: string;
};

type BusinessImageGalleryProps = {
  images: BusinessImageGalleryImage[];
};

export function BusinessImageGallery({ images }: BusinessImageGalleryProps) {
  const [selectedImageId, setSelectedImageId] = useState(images[0]?.id ?? "");
  const selectedImage =
    images.find((image) => image.id === selectedImageId) ?? images[0] ?? null;

  if (!selectedImage) {
    return (
      <div className="h-[20rem] bg-[var(--secondary)] sm:h-[26rem] lg:h-[28rem]" />
    );
  }

  return (
    <>
      <img
        src={selectedImage.src}
        alt={selectedImage.alt}
        className="h-[15.5rem] w-full object-cover min-[390px]:h-[18rem] sm:h-[24rem] lg:h-[31rem]"
        loading="eager"
        decoding="async"
        fetchPriority="high"
      />

      {images.length > 1 ? (
        <div className="border-t border-[var(--border)] bg-[var(--background)] p-2.5 sm:p-4">
          <div className="flex gap-2 overflow-x-auto sm:gap-3">
            {images.map((image) => {
              const isSelected = image.id === selectedImage.id;

              return (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => setSelectedImageId(image.id)}
                  className={`shrink-0 overflow-hidden rounded-2xl border transition ${
                    isSelected
                      ? "border-[var(--primary)] shadow-[0_0_0_2px_rgba(42,98,87,0.12)]"
                      : "border-[var(--border)] hover:border-[rgba(42,98,87,0.28)]"
                  }`}
                  aria-label={`Show image ${image.alt}`}
                  aria-pressed={isSelected}
                >
                  <img
                    src={image.src}
                    alt={image.alt}
                    className="h-14 w-14 object-cover sm:h-20 sm:w-20"
                    loading="lazy"
                    decoding="async"
                  />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </>
  );
}

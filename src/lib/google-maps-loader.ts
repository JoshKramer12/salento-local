const GOOGLE_MAPS_SCRIPT_SELECTOR = 'script[data-google-maps-loader="salento-local"]';
const GOOGLE_MAPS_CALLBACK_NAME = "__salentoGoogleMapsInit";
const GOOGLE_MAPS_MISSING_KEY_MESSAGE =
  "Google Maps is not configured. Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to your environment.";
const GOOGLE_MAPS_LOAD_FAILURE_MESSAGE =
  "The Google Maps JavaScript API could not be loaded.";

type GoogleMapsWindow = Window &
  typeof globalThis & {
    [GOOGLE_MAPS_CALLBACK_NAME]?: () => void;
    __salentoGoogleMapsPlacesLibraryPromise?: Promise<unknown>;
    google?: {
      maps?: {
        importLibrary?: (libraryName: string) => Promise<unknown>;
      };
    };
  };

function getGoogleMapsBrowserApiKey() {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ?? "";
}

function getGoogleMapsWindow() {
  return window as GoogleMapsWindow;
}

export function getGoogleMapsLoaderError() {
  const apiKey = getGoogleMapsBrowserApiKey();

  if (!apiKey) {
    return GOOGLE_MAPS_MISSING_KEY_MESSAGE;
  }

  return null;
}

export async function loadGoogleMapsPlacesLibrary() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Google Maps can only be loaded in the browser.");
  }

  const missingKeyError = getGoogleMapsLoaderError();

  if (missingKeyError) {
    throw new Error(missingKeyError);
  }

  const win = getGoogleMapsWindow();

  if (typeof win.google?.maps?.importLibrary === "function") {
    return win.google.maps.importLibrary("places");
  }

  if (!win.__salentoGoogleMapsPlacesLibraryPromise) {
    win.__salentoGoogleMapsPlacesLibraryPromise = new Promise((resolve, reject) => {
      const complete = () => {
        const importLibrary = win.google?.maps?.importLibrary;

        if (typeof importLibrary !== "function") {
          reject(new Error(GOOGLE_MAPS_LOAD_FAILURE_MESSAGE));
          return;
        }

        importLibrary("places").then(resolve).catch(reject);
      };

      if (typeof win.google?.maps?.importLibrary === "function") {
        complete();
        return;
      }

      const existingScript = document.querySelector<HTMLScriptElement>(
        GOOGLE_MAPS_SCRIPT_SELECTOR,
      );
      const callbackName = GOOGLE_MAPS_CALLBACK_NAME;
      const cleanupCallback = () => {
        try {
          delete win[callbackName];
        } catch {
          win[callbackName] = undefined;
        }
      };

      win[callbackName] = () => {
        cleanupCallback();
        complete();
      };

      const handleError = () => {
        cleanupCallback();
        reject(new Error(GOOGLE_MAPS_LOAD_FAILURE_MESSAGE));
      };

      if (existingScript) {
        existingScript.addEventListener("error", handleError, { once: true });
        return;
      }

      const script = document.createElement("script");
      script.async = true;
      script.defer = true;
      script.dataset.googleMapsLoader = "salento-local";
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        getGoogleMapsBrowserApiKey(),
      )}&loading=async&libraries=places&v=weekly&callback=${callbackName}`;
      script.onerror = handleError;
      document.head.appendChild(script);
    });
  }

  return win.__salentoGoogleMapsPlacesLibraryPromise;
}

export function __resetGoogleMapsLoaderForTests() {
  if (typeof window === "undefined") {
    return;
  }

  const win = getGoogleMapsWindow();
  win.__salentoGoogleMapsPlacesLibraryPromise = undefined;
  win.google = undefined;

  try {
    delete win[GOOGLE_MAPS_CALLBACK_NAME];
  } catch {
    win[GOOGLE_MAPS_CALLBACK_NAME] = undefined;
  }
}

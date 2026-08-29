"use client";

import {
  startTransition,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type SignaturePoint = {
  x: number;
  y: number;
};

type SignatureDrawing = {
  strokes: SignaturePoint[][];
  version: 1;
};

type SignaturePadProps = {
  clearLabel: string;
  drawHint: string;
  typedHelp: string;
  typedLabel: string;
  hasError?: boolean;
  legacyValueNotice: string;
  value: string;
  onChange: (value: string) => void;
};

const canvasWidth = 640;
const canvasHeight = 220;
const strokeColor = "#24323a";
const strokeWidth = 3;

function parseSignatureDrawing(value: string): SignatureDrawing | null {
  if (!value.trim().startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as SignatureDrawing;

    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.strokes) ||
      parsed.strokes.some(
        (stroke) =>
          !Array.isArray(stroke) ||
          stroke.some(
            (point) =>
              typeof point?.x !== "number" || typeof point?.y !== "number",
          ),
      )
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function buildPath(points: SignaturePoint[]) {
  if (!points.length) {
    return "";
  }

  if (points.length === 1) {
    const point = points[0];
    return `M ${point.x} ${point.y} L ${point.x + 0.01} ${point.y + 0.01}`;
  }

  return points
    .map((point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`,
    )
    .join(" ");
}

function serializeSignature(strokes: SignaturePoint[][]) {
  if (!strokes.some((stroke) => stroke.length)) {
    return "";
  }

  return JSON.stringify({
    strokes,
    version: 1,
  } satisfies SignatureDrawing);
}

function appendPointsToLastStroke(
  strokes: SignaturePoint[][],
  points: SignaturePoint[],
) {
  if (!strokes.length || !points.length) {
    return strokes;
  }

  return strokes.map((stroke, index, allStrokes) => {
    if (index !== allStrokes.length - 1) {
      return stroke;
    }

    const nextStroke = [...stroke];

    for (const point of points) {
      const lastPoint = nextStroke[nextStroke.length - 1];

      if (lastPoint && lastPoint.x === point.x && lastPoint.y === point.y) {
        continue;
      }

      nextStroke.push(point);
    }

    return nextStroke;
  });
}

export function SignaturePad({
  clearLabel,
  drawHint,
  typedHelp,
  typedLabel,
  hasError = false,
  legacyValueNotice,
  value,
  onChange,
}: SignaturePadProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const strokesRef = useRef<SignaturePoint[][]>([]);
  const [strokes, setStrokes] = useState<SignaturePoint[][]>(() => {
    const drawing = parseSignatureDrawing(value);
    return drawing?.strokes ?? [];
  });
  const [backgroundImage, setBackgroundImage] = useState(() =>
    value.trim().startsWith("data:image/") ? value : "",
  );
  const [hasDrawnSignature, setHasDrawnSignature] = useState(Boolean(value.trim()));
  const hasDataUrlValue = value.trim().startsWith("data:image/");
  const hasLegacyValue =
    Boolean(value.trim()) &&
    !parseSignatureDrawing(value) &&
    !hasDataUrlValue;

  const svgPaths = useMemo(() => strokes.map((stroke) => buildPath(stroke)), [strokes]);

  function getPoint(clientX: number, clientY: number) {
    const surface = surfaceRef.current;

    if (!surface) {
      return null;
    }

    const rect = surface.getBoundingClientRect();

    if (!rect.width || !rect.height) {
      return null;
    }

    return {
      x: ((clientX - rect.left) / rect.width) * canvasWidth,
      y: ((clientY - rect.top) / rect.height) * canvasHeight,
    };
  }

  function getPointsFromEvent(event: ReactPointerEvent<HTMLDivElement>) {
    const coalescedEvents = event.nativeEvent.getCoalescedEvents?.() ?? [];
    const pointerSamples = coalescedEvents.length ? coalescedEvents : [event.nativeEvent];

    return pointerSamples
      .map((pointerEvent) => getPoint(pointerEvent.clientX, pointerEvent.clientY))
      .filter((point): point is SignaturePoint => Boolean(point));
  }

  function applyNextValue(nextStrokes: SignaturePoint[][], nextBackgroundImage = "") {
    const nextValue = nextBackgroundImage || serializeSignature(nextStrokes);

    strokesRef.current = nextStrokes;
    setStrokes(nextStrokes);
    setBackgroundImage(nextBackgroundImage);
    setHasDrawnSignature(Boolean(nextValue.trim()));

    if (nextValue !== value) {
      onChange(nextValue);
    }
  }

  function clearSignature() {
    activePointerIdRef.current = null;
    applyNextValue([], "");
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== null) {
      return;
    }

    const [point] = getPointsFromEvent(event);

    if (!point) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerIdRef.current = event.pointerId;

    const nextStrokes =
      backgroundImage || hasLegacyValue ? [[point]] : [...strokesRef.current, [point]];

    strokesRef.current = nextStrokes;
    setBackgroundImage("");
    setStrokes(nextStrokes);
    setHasDrawnSignature(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }

    const nextPoints = getPointsFromEvent(event);

    if (!nextPoints.length) {
      return;
    }

    event.preventDefault();
    const nextStrokes = appendPointsToLastStroke(strokesRef.current, nextPoints);

    strokesRef.current = nextStrokes;
    setStrokes(nextStrokes);
  }

  function finishPointer(event: ReactPointerEvent<HTMLDivElement>) {
    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }

    const nextStrokes = appendPointsToLastStroke(
      strokesRef.current,
      getPointsFromEvent(event),
    );

    strokesRef.current = nextStrokes;
    setStrokes(nextStrokes);
    activePointerIdRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    applyNextValue(nextStrokes, "");
  }

  useEffect(() => {
    if (value.trim().startsWith("data:image/")) {
      strokesRef.current = [];
      startTransition(() => {
        setStrokes([]);
        setBackgroundImage(value);
        setHasDrawnSignature(true);
      });
      return;
    }

    const drawing = parseSignatureDrawing(value);

    if (drawing) {
      strokesRef.current = drawing.strokes;
      startTransition(() => {
        setStrokes(drawing.strokes);
        setBackgroundImage("");
        setHasDrawnSignature(true);
      });
      return;
    }

    strokesRef.current = [];
    startTransition(() => {
      setStrokes([]);
      setBackgroundImage("");
      setHasDrawnSignature(Boolean(value.trim()));
    });
  }, [onChange, value]);

  return (
    <div className="grid gap-3">
      <div
        className={`overflow-hidden rounded-[1.4rem] border bg-white ${
          hasError
            ? "border-[rgba(191,91,42,0.48)] ring-2 ring-[rgba(191,91,42,0.16)]"
            : "border-[var(--border)]"
        }`}
      >
        <div
          ref={surfaceRef}
          className="relative block h-44 w-full touch-none bg-white sm:h-52"
          role="img"
          aria-label={drawHint}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={finishPointer}
        >
          {backgroundImage ? (
            <img
              src={backgroundImage}
              alt=""
              className="pointer-events-none absolute inset-0 h-full w-full object-fill"
              draggable={false}
            />
          ) : null}
          <svg
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {strokes.map((stroke, index) => (
              <path
                key={`stroke-path-${index}`}
                d={svgPaths[index]}
                fill="none"
                stroke={strokeColor}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={strokeWidth}
              />
            ))}
          </svg>
        </div>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-[var(--muted)]">
          {hasLegacyValue ? legacyValueNotice : drawHint}
        </p>
        <button
          type="button"
          onClick={clearSignature}
          className="btn-secondary w-full sm:w-auto"
          disabled={!hasDrawnSignature}
        >
          {clearLabel}
        </button>
      </div>
      <label className="field-label">
        <span className="font-medium text-[var(--foreground)]">{typedLabel}</span>
        <span className="text-sm text-[var(--muted)]">{typedHelp}</span>
        <input
          className="input-field"
          type="text"
          value={value.startsWith("typed:") ? value.slice(6) : ""}
          onChange={(event) => onChange(`typed:${event.target.value}`)}
        />
      </label>
    </div>
  );
}

"use client";

import {
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

function prepareContext(context: CanvasRenderingContext2D) {
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = strokeWidth;
  context.strokeStyle = strokeColor;
  context.fillStyle = strokeColor;
}

function clearCanvas(context: CanvasRenderingContext2D) {
  context.clearRect(0, 0, canvasWidth, canvasHeight);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvasWidth, canvasHeight);
  prepareContext(context);
}

function drawStrokes(
  context: CanvasRenderingContext2D,
  strokes: SignaturePoint[][],
) {
  clearCanvas(context);

  for (const stroke of strokes) {
    if (!stroke.length) {
      continue;
    }

    if (stroke.length === 1) {
      context.beginPath();
      context.arc(stroke[0].x, stroke[0].y, strokeWidth / 2, 0, Math.PI * 2);
      context.fill();
      continue;
    }

    context.beginPath();
    context.moveTo(stroke[0].x, stroke[0].y);

    for (const point of stroke.slice(1)) {
      context.lineTo(point.x, point.y);
    }

    context.stroke();
  }
}

function loadSignatureImage(value: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("signature_image_load_failed"));
    image.src = value;
  });
}

export function SignaturePad({
  clearLabel,
  drawHint,
  hasError = false,
  legacyValueNotice,
  value,
  onChange,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<SignaturePoint | null>(null);
  const activeInputModeRef = useRef<"pointer" | "mouse" | "touch" | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const hasSeenPointerMoveRef = useRef(false);
  const activeTouchIdRef = useRef<number | null>(null);
  const committedValueRef = useRef(value);
  const latestValueRef = useRef(value);
  const hasDrawnSignatureRef = useRef(Boolean(value.trim()));
  const redrawTokenRef = useRef(0);
  const [hasDrawnSignature, setHasDrawnSignature] = useState(Boolean(value.trim()));
  const drawing = useMemo(() => parseSignatureDrawing(value), [value]);
  const hasDataUrlValue = value.trim().startsWith("data:image/");
  const hasLegacyValue = Boolean(value.trim()) && !drawing && !hasDataUrlValue;

  function getContext() {
    const context = canvasRef.current?.getContext("2d");

    if (!context) {
      return null;
    }

    prepareContext(context);
    return context;
  }

  function emitCurrentCanvasValue() {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const nextValue = hasDrawnSignatureRef.current ? canvas.toDataURL("image/png") : "";

    if (nextValue === latestValueRef.current) {
      return;
    }

    committedValueRef.current = nextValue;
    latestValueRef.current = nextValue;
    onChange(nextValue);
  }

  function getPoint(clientX: number, clientY: number) {
    const canvas = canvasRef.current;

    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function drawPoint(point: SignaturePoint) {
    const context = getContext();

    if (!context) {
      return;
    }

    context.beginPath();
    context.arc(point.x, point.y, strokeWidth / 2, 0, Math.PI * 2);
    context.fill();
  }

  function beginStroke(point: SignaturePoint) {
    drawPoint(point);
  }

  function drawSegment(from: SignaturePoint, to: SignaturePoint) {
    const context = getContext();

    if (!context) {
      return;
    }

    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
  }

  function markSignatureDrawn() {
    if (hasDrawnSignatureRef.current) {
      return;
    }

    hasDrawnSignatureRef.current = true;
    setHasDrawnSignature(true);
  }

  function startDrawing(clientX: number, clientY: number) {
    const point = getPoint(clientX, clientY);
    const context = getContext();

    if (!point || !canvasRef.current || !context) {
      return;
    }

    isDrawingRef.current = true;
    lastPointRef.current = point;

    if (!hasDrawnSignatureRef.current) {
      clearCanvas(context);
    }

    beginStroke(point);
    markSignatureDrawn();
  }

  function continueDrawing(clientX: number, clientY: number) {
    const lastPoint = lastPointRef.current;

    if (!isDrawingRef.current || !lastPoint) {
      return;
    }

    const point = getPoint(clientX, clientY);

    if (!point) {
      return;
    }

    drawSegment(lastPoint, point);
    lastPointRef.current = point;
    markSignatureDrawn();
  }

  function finishDrawing() {
    if (!isDrawingRef.current) {
      return;
    }

    isDrawingRef.current = false;
    lastPointRef.current = null;
    activeInputModeRef.current = null;
    activePointerIdRef.current = null;
    hasSeenPointerMoveRef.current = false;
    activeTouchIdRef.current = null;
    emitCurrentCanvasValue();
  }

  function clearSignature() {
    isDrawingRef.current = false;
    lastPointRef.current = null;
    activeInputModeRef.current = null;
    activePointerIdRef.current = null;
    hasSeenPointerMoveRef.current = false;
    activeTouchIdRef.current = null;
    latestValueRef.current = "";
    committedValueRef.current = "";
    hasDrawnSignatureRef.current = false;
    setHasDrawnSignature(false);

    const context = getContext();

    if (context) {
      clearCanvas(context);
    }

    onChange("");
  }

  useEffect(() => {
    const context = getContext();

    if (context) {
      clearCanvas(context);
    }
  }, []);

  useEffect(() => {
    const incomingValue = value.trim();
    const committedValue = committedValueRef.current.trim();
    const shouldIgnoreStaleClear =
      !incomingValue &&
      committedValue.startsWith("data:image/") &&
      hasDrawnSignatureRef.current;

    if (shouldIgnoreStaleClear) {
      if (latestValueRef.current !== committedValueRef.current) {
        latestValueRef.current = committedValueRef.current;
        onChange(committedValueRef.current);
      }

      return;
    }

    latestValueRef.current = value;
    committedValueRef.current = value;
    hasDrawnSignatureRef.current = Boolean(incomingValue);
    setHasDrawnSignature(Boolean(incomingValue));
    const renderContext = getContext();

    if (!renderContext) {
      return;
    }
    const stableRenderContext: CanvasRenderingContext2D = renderContext;

    const token = redrawTokenRef.current + 1;
    redrawTokenRef.current = token;

    async function redrawFromValue() {
      clearCanvas(stableRenderContext);

      if (value.trim().startsWith("data:image/")) {
        try {
          const image = await loadSignatureImage(value);

          if (redrawTokenRef.current !== token) {
            return;
          }

          stableRenderContext.drawImage(image, 0, 0, canvasWidth, canvasHeight);
        } catch {
          clearCanvas(stableRenderContext);
        }

        return;
      }

      if (drawing?.strokes.length) {
        drawStrokes(stableRenderContext, drawing.strokes);
      }
    }

    void redrawFromValue();
  }, [drawing, value]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    function handleCanvasPointerDown(event: PointerEvent) {
      if (activeInputModeRef.current !== null) {
        return;
      }

      event.preventDefault();
      activeInputModeRef.current = "pointer";
      activePointerIdRef.current = event.pointerId;
      hasSeenPointerMoveRef.current = false;
      const target = event.currentTarget;

      if (target instanceof HTMLCanvasElement) {
        target.setPointerCapture?.(event.pointerId);
      }

      startDrawing(event.clientX, event.clientY);
    }

    function handleWindowPointerMove(event: PointerEvent) {
      if (
        !isDrawingRef.current ||
        activeInputModeRef.current !== "pointer" ||
        event.pointerId !== activePointerIdRef.current
      ) {
        return;
      }

      event.preventDefault();
      hasSeenPointerMoveRef.current = true;
      continueDrawing(event.clientX, event.clientY);
    }

    function handleWindowPointerUp(event: PointerEvent) {
      if (
        !isDrawingRef.current ||
        activeInputModeRef.current !== "pointer" ||
        event.pointerId !== activePointerIdRef.current
      ) {
        return;
      }

      event.preventDefault();
      canvasRef.current?.releasePointerCapture?.(event.pointerId);
      finishDrawing();
    }

    function handleWindowPointerCancel(event: PointerEvent) {
      if (
        !isDrawingRef.current ||
        activeInputModeRef.current !== "pointer" ||
        event.pointerId !== activePointerIdRef.current
      ) {
        return;
      }

      canvasRef.current?.releasePointerCapture?.(event.pointerId);
      finishDrawing();
    }

    function findActiveTouch(touches: TouchList) {
      if (activeTouchIdRef.current === null) {
        return null;
      }

      for (const touch of Array.from(touches)) {
        if (touch.identifier === activeTouchIdRef.current) {
          return touch;
        }
      }

      return null;
    }

    function handleCanvasTouchStart(event: TouchEvent) {
      if (activeInputModeRef.current !== null && activeInputModeRef.current !== "touch") {
        return;
      }

      const touch = event.changedTouches[0];

      if (!touch) {
        return;
      }

      event.preventDefault();
      activeInputModeRef.current = "touch";
      activeTouchIdRef.current = touch.identifier;
      startDrawing(touch.clientX, touch.clientY);
    }

    function handleWindowTouchMove(event: TouchEvent) {
      if (activeInputModeRef.current !== "touch") {
        return;
      }

      const touch = findActiveTouch(event.touches);

      if (!touch || !isDrawingRef.current) {
        return;
      }

      event.preventDefault();
      continueDrawing(touch.clientX, touch.clientY);
    }

    function handleWindowTouchEnd(event: TouchEvent) {
      if (activeInputModeRef.current !== "touch") {
        return;
      }

      const touch = findActiveTouch(event.changedTouches);

      if (!touch || !isDrawingRef.current) {
        return;
      }

      event.preventDefault();
      finishDrawing();
    }

    function handleWindowTouchCancel(event: TouchEvent) {
      if (activeInputModeRef.current !== "touch") {
        return;
      }

      const touch = findActiveTouch(event.changedTouches);

      if (!touch || !isDrawingRef.current) {
        return;
      }

      event.preventDefault();
      finishDrawing();
    }

    function handleCanvasMouseDown(event: MouseEvent) {
      if (activeInputModeRef.current !== null) {
        return;
      }

      event.preventDefault();
      activeInputModeRef.current = "mouse";
      startDrawing(event.clientX, event.clientY);
    }

    function handleWindowMouseMove(event: MouseEvent) {
      if (!isDrawingRef.current) {
        return;
      }

      if (
        activeInputModeRef.current === "touch" ||
        (activeInputModeRef.current === "pointer" && hasSeenPointerMoveRef.current)
      ) {
        return;
      }

      event.preventDefault();
      continueDrawing(event.clientX, event.clientY);
    }

    function handleWindowMouseUp(event: MouseEvent) {
      if (
        !isDrawingRef.current ||
        activeInputModeRef.current === "touch"
      ) {
        return;
      }

      event.preventDefault();
      finishDrawing();
    }

    canvas.addEventListener("pointerdown", handleCanvasPointerDown, { passive: false });
    canvas.addEventListener("mousedown", handleCanvasMouseDown);
    canvas.addEventListener("touchstart", handleCanvasTouchStart, { passive: false });
    window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", handleWindowPointerUp, { passive: false });
    window.addEventListener("pointercancel", handleWindowPointerCancel);
    window.addEventListener("mousemove", handleWindowMouseMove, { passive: false });
    window.addEventListener("mouseup", handleWindowMouseUp);
    window.addEventListener("touchmove", handleWindowTouchMove, { passive: false });
    window.addEventListener("touchend", handleWindowTouchEnd);
    window.addEventListener("touchcancel", handleWindowTouchCancel);

    return () => {
      canvas.removeEventListener("pointerdown", handleCanvasPointerDown);
      canvas.removeEventListener("mousedown", handleCanvasMouseDown);
      canvas.removeEventListener("touchstart", handleCanvasTouchStart);
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
      window.removeEventListener("mousemove", handleWindowMouseMove);
      window.removeEventListener("mouseup", handleWindowMouseUp);
      window.removeEventListener("touchmove", handleWindowTouchMove);
      window.removeEventListener("touchend", handleWindowTouchEnd);
      window.removeEventListener("touchcancel", handleWindowTouchCancel);
    };
  }, []);

  return (
    <div className="grid gap-3">
      <div
        className={`overflow-hidden rounded-[1.4rem] border bg-white ${
          hasError
            ? "border-[rgba(191,91,42,0.48)] ring-2 ring-[rgba(191,91,42,0.16)]"
            : "border-[var(--border)]"
        }`}
      >
        <canvas
          ref={canvasRef}
          width={canvasWidth}
          height={canvasHeight}
          className="block h-44 w-full touch-none bg-white sm:h-52"
        />
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
    </div>
  );
}

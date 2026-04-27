import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Dithering, GrainGradient } from "@paper-design/shaders-react";

const QR_SOURCE = "/assets/design-snaps-qr.png?v=2";
const MAX_CARD_TILT = 20;
const COLORS = {
  up: [0, 179, 255],
  right: [0, 255, 179],
  down: [255, 38, 0],
  left: [149, 0, 255],
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, amount) => from + (to - from) * amount;
const toRgb = (color) => `rgb(${color[0]} ${color[1]} ${color[2]})`;

function mixRgb(a, b, amount) {
  return [
    Math.round(lerp(a[0], b[0], amount)),
    Math.round(lerp(a[1], b[1], amount)),
    Math.round(lerp(a[2], b[2], amount)),
  ];
}

function angleDelta(value, base) {
  return ((((value - base) % 360) + 540) % 360) - 180;
}

function normalizedTilt(value, deadZone, max) {
  const magnitude = Math.max(Math.abs(value) - deadZone, 0);
  return Math.sign(value) * clamp(magnitude / (max - deadZone), 0, 1);
}

function screenAngle() {
  const angle = screen.orientation?.angle ?? window.orientation ?? 0;
  return (Math.round((((angle % 360) + 360) % 360) / 90) * 90) % 360;
}

function directionalColor(pointer) {
  const dx = pointer.x - 0.5;
  const dy = pointer.y - 0.5;
  const intensity = clamp(Math.hypot(dx, dy) * 2.35, 0, 1);
  const weights = [
    { color: COLORS.up, value: Math.max(-dy, 0) },
    { color: COLORS.right, value: Math.max(dx, 0) },
    { color: COLORS.down, value: Math.max(dy, 0) },
    { color: COLORS.left, value: Math.max(-dx, 0) },
  ];
  const total = weights.reduce((sum, item) => sum + item.value, 0);

  if (total < 0.001) return "#00b3ff";

  const directional = weights.reduce(
    (rgb, item) => [
      rgb[0] + item.color[0] * (item.value / total),
      rgb[1] + item.color[1] * (item.value / total),
      rgb[2] + item.color[2] * (item.value / total),
    ],
    [0, 0, 0],
  );

  return toRgb(mixRgb(COLORS.up, directional, intensity));
}

function createQrMask() {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      const size = 1024;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(image, 0, 0, size, size);

      const data = ctx.getImageData(0, 0, size, size);
      for (let index = 0; index < data.data.length; index += 4) {
        const luma =
          data.data[index] * 0.299 +
          data.data[index + 1] * 0.587 +
          data.data[index + 2] * 0.114;
        const alpha = luma < 150 ? 255 : 0;
        data.data[index] = 255;
        data.data[index + 1] = 255;
        data.data[index + 2] = 255;
        data.data[index + 3] = alpha;
      }

      ctx.putImageData(data, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = reject;
    image.src = QR_SOURCE;
  });
}

function App() {
  const cardRef = useRef(null);
  const frameRef = useRef(0);
  const orientationBaseRef = useRef(null);
  const targetRef = useRef({ x: 0.5, y: 0.5 });
  const pointerRef = useRef({ x: 0.5, y: 0.5 });
  const gyroRef = useRef(false);
  const [maskUrl, setMaskUrl] = useState("");
  const [pointer, setPointer] = useState({ x: 0.5, y: 0.5 });
  const [isActive, setIsActive] = useState(false);
  const [usingGyro, setUsingGyro] = useState(false);
  const [needsMotionTap, setNeedsMotionTap] = useState(false);

  const colorFront = useMemo(() => directionalColor(pointer), [pointer]);

  const applyTilt = useCallback((nextPointer) => {
    pointerRef.current = nextPointer;
    setPointer(nextPointer);

    const card = cardRef.current;
    if (!card) return;

    const tiltX = clamp((nextPointer.x - 0.5) / 0.42, -1, 1);
    const tiltY = clamp((nextPointer.y - 0.5) / 0.42, -1, 1);
    const rotateY = tiltX * MAX_CARD_TILT;
    const rotateX = -tiltY * MAX_CARD_TILT;

    card.style.setProperty("--mx", `${Math.round(nextPointer.x * 100)}%`);
    card.style.setProperty("--my", `${Math.round(nextPointer.y * 100)}%`);
    card.style.setProperty("--rx", `${rotateX.toFixed(2)}deg`);
    card.style.setProperty("--ry", `${rotateY.toFixed(2)}deg`);
    card.style.setProperty("--move-x", `${(tiltX * 14).toFixed(1)}px`);
    card.style.setProperty("--move-y", `${(tiltY * 14).toFixed(1)}px`);
    card.style.setProperty("--shadow-x", `${((0.5 - nextPointer.x) * 28).toFixed(1)}px`);
  }, []);

  const setTarget = useCallback((x, y, active = true) => {
    targetRef.current = { x: clamp(x, 0.08, 0.92), y: clamp(y, 0.08, 0.92) };
    setIsActive(active || gyroRef.current);
  }, []);

  const handleOrientation = useCallback((event) => {
    if (!gyroRef.current) return;
    const gamma = event.gamma || 0;
    const beta = event.beta || 0;

    if (!orientationBaseRef.current) {
      orientationBaseRef.current = { gamma, beta };
    }

    const deltaGamma = clamp(angleDelta(gamma, orientationBaseRef.current.gamma), -32, 32);
    const deltaBeta = clamp(angleDelta(beta, orientationBaseRef.current.beta), -28, 28);
    let tiltX = deltaGamma;
    let tiltY = deltaBeta;

    if (screenAngle() === 90) {
      tiltX = deltaBeta;
      tiltY = -deltaGamma;
    } else if (screenAngle() === 270) {
      tiltX = -deltaBeta;
      tiltY = deltaGamma;
    } else if (screenAngle() === 180) {
      tiltX = -deltaGamma;
      tiltY = -deltaBeta;
    }

    setTarget(
      0.5 + normalizedTilt(tiltX, 1.2, 18) * 0.42,
      0.5 + normalizedTilt(tiltY, 1.4, 16) * 0.42,
      true,
    );
  }, [setTarget]);

  useEffect(() => {
    createQrMask().then(setMaskUrl).catch(() => setMaskUrl(""));
  }, []);

  useEffect(() => {
    const tick = () => {
      const ease = gyroRef.current ? 0.22 : 0.22;
      const current = pointerRef.current;
      const target = targetRef.current;
      const next = {
        x: lerp(current.x, target.x, ease),
        y: lerp(current.y, target.y, ease),
      };
      applyTilt(next);
      frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [applyTilt]);

  useEffect(() => {
    window.removeEventListener("deviceorientation", handleOrientation);
    window.removeEventListener("deviceorientationabsolute", handleOrientation);

    if (usingGyro) {
      window.addEventListener("deviceorientation", handleOrientation);
      window.addEventListener("deviceorientationabsolute", handleOrientation);
    }

    return () => {
      window.removeEventListener("deviceorientation", handleOrientation);
      window.removeEventListener("deviceorientationabsolute", handleOrientation);
    };
  }, [handleOrientation, usingGyro]);

  const enableGyro = useCallback(async (showAlerts = false) => {
    if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      if (showAlerts) {
        window.alert("Gyro needs HTTPS on phones. Open the HTTPS tunnel URL, then tap the page again.");
      }
      return false;
    }

    if (typeof DeviceOrientationEvent === "undefined") {
      if (showAlerts) window.alert("This browser is not exposing device orientation events.");
      return false;
    }

    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      try {
        const response = await DeviceOrientationEvent.requestPermission();
        if (response !== "granted") {
          setNeedsMotionTap(true);
          return false;
        }
      } catch {
        setNeedsMotionTap(true);
        return false;
      }
    }

    gyroRef.current = true;
    orientationBaseRef.current = null;
    targetRef.current = { x: 0.5, y: 0.5 };
    setUsingGyro(true);
    setIsActive(true);
    setNeedsMotionTap(false);
    return true;
  }, []);

  useEffect(() => {
    if (typeof DeviceOrientationEvent === "undefined") return;
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      setNeedsMotionTap(true);
      return;
    }

    enableGyro();
  }, [enableGyro]);

  function handlePointerMove(event) {
    if (gyroRef.current || !cardRef.current) return;
    const bounds = cardRef.current.getBoundingClientRect();
    setTarget(
      (event.clientX - bounds.left) / bounds.width,
      (event.clientY - bounds.top) / bounds.height,
      true,
    );
  }

  function resetPointer() {
    if (gyroRef.current) return;
    targetRef.current = { x: 0.5, y: 0.5 };
    setIsActive(false);
  }

  function handleStagePointerDown() {
    if (!gyroRef.current) enableGyro(true);
  }

  const maskStyle = maskUrl
    ? {
        WebkitMaskImage: `url(${maskUrl})`,
        maskImage: `url(${maskUrl})`,
      }
    : undefined;

  return (
    <>
      <div className="grain-gradient-bg" aria-hidden="true">
        <GrainGradient
          width="100%"
          height="100%"
          colors={["#7300ff", "#eba8ff", "#00bfff", "#2b00ff", "#ffe77a", "#ff9a1f", "#ff4d00"]}
          colorBack="#000000"
          softness={0.5}
          intensity={0.5}
          noise={0.25}
          shape="corners"
          speed={1}
          scale={1}
          minPixelRatio={1.5}
          maxPixelCount={5000000}
        />
      </div>
      <main className="stage" aria-label="Interactive dither QR card experiment" onPointerDown={handleStagePointerDown}>
        {needsMotionTap && !usingGyro ? <p className="motion-hint">tap once for motion</p> : null}
        <div className="scene" id="scene">
          <article
            ref={cardRef}
            className={`qr-card ${isActive ? "is-active" : ""}`}
            aria-label="Shader styled QR code card"
            onPointerEnter={() => setIsActive(true)}
            onPointerMove={handlePointerMove}
            onPointerLeave={resetPointer}
          >
            <header className="card-head">
              <div>
                <p className="serial">visual designer</p>
                <p className="signal">Atulya</p>
              </div>
            </header>

            <div className="qr-shell">
              <div className="qr-shader-mask" style={maskStyle} aria-label="QR code">
                <Dithering
                  width="100%"
                  height="100%"
                  colorBack="#000000"
                  colorFront={colorFront}
                  shape="warp"
                  type="4x4"
                  size={2}
                  speed={0.44}
                  scale={1.04}
                  maxPixelCount={1200000}
                />
              </div>
            </div>

            <footer className="card-foot">
              <span>design snaps</span>
            </footer>
          </article>
        </div>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);

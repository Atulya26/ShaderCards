import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Dithering, GrainGradient } from "@paper-design/shaders-react";
import qrSourceUrl from "../assets/design-snaps-qr.png";

const QR_SOURCE = qrSourceUrl;
const MAX_CARD_TILT = 20;
const SHADER_LAYERS = [
  { key: "base", color: "#00b3ff", variable: "--shader-base" },
  { key: "right", color: "#ff2600", variable: "--shader-right" },
  { key: "down", color: "#9500ff", variable: "--shader-down" },
  { key: "left", color: "#00ffb3", variable: "--shader-left" },
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, amount) => from + (to - from) * amount;

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

function canUseTouchMotion() {
  return window.matchMedia?.("(pointer: coarse)")?.matches || navigator.maxTouchPoints > 0;
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
  const [isActive, setIsActive] = useState(false);
  const [usingGyro, setUsingGyro] = useState(false);
  const [needsMotionTap, setNeedsMotionTap] = useState(false);

  const applyTilt = useCallback((nextPointer) => {
    pointerRef.current = nextPointer;

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
    const motionStrength = clamp(Math.hypot(tiltX, tiltY), 0, 1);
    const bluePresence = (1 - motionStrength * 0.84) + clamp(-tiltY, 0, 1) * 0.9;
    card.style.setProperty("--shader-base", `${clamp(bluePresence, 0.16, 1).toFixed(3)}`);
    card.style.setProperty("--shader-right", `${clamp(tiltX, 0, 1).toFixed(3)}`);
    card.style.setProperty("--shader-left", `${clamp(-tiltX, 0, 1).toFixed(3)}`);
    card.style.setProperty("--shader-down", `${clamp(tiltY, 0, 1).toFixed(3)}`);
    card.style.setProperty("--shader-pan-x", `${(tiltX * 7).toFixed(1)}%`);
    card.style.setProperty("--shader-pan-y", `${(tiltY * 7).toFixed(1)}%`);
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

    const deltaGamma = clamp(angleDelta(gamma, orientationBaseRef.current.gamma), -42, 42);
    const deltaBeta = clamp(angleDelta(beta, orientationBaseRef.current.beta), -38, 38);
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
      0.5 + normalizedTilt(tiltX, 0.45, 12) * 0.44,
      0.5 + normalizedTilt(tiltY, 0.65, 11) * 0.44,
      true,
    );
  }, [setTarget]);

  useEffect(() => {
    createQrMask().then(setMaskUrl).catch(() => setMaskUrl(""));
  }, []);

  useEffect(() => {
    const tick = () => {
      const ease = gyroRef.current ? 0.18 : 0.22;
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

    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
      try {
        await DeviceMotionEvent.requestPermission();
      } catch {
        setNeedsMotionTap(true);
        return false;
      }
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
    if (!canUseTouchMotion()) return;
    if (typeof DeviceOrientationEvent === "undefined") return;
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      setNeedsMotionTap(true);
      return;
    }

    enableGyro();
  }, [enableGyro]);

  const handleMouseMove = useCallback((event) => {
    if (canUseTouchMotion()) return;
    setTarget(
      event.clientX / window.innerWidth,
      event.clientY / window.innerHeight,
      true,
    );
  }, [setTarget]);

  useEffect(() => {
    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [handleMouseMove]);

  function handleStagePointerMove(event) {
    if (event.pointerType !== "mouse" || canUseTouchMotion()) return;
    const bounds = event.currentTarget.getBoundingClientRect();
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

  function handleStagePointerDown(event) {
    if (event.pointerType === "mouse" || !canUseTouchMotion()) return;
    if (!gyroRef.current) enableGyro(true);
  }

  useEffect(() => {
    if (!needsMotionTap || usingGyro) return undefined;

    const enableFromGesture = () => {
      enableGyro(true);
    };

    window.addEventListener("click", enableFromGesture, { once: true });
    window.addEventListener("pointerdown", enableFromGesture, { once: true });
    window.addEventListener("touchstart", enableFromGesture, { once: true });
    window.addEventListener("touchend", enableFromGesture, { once: true });

    return () => {
      window.removeEventListener("click", enableFromGesture);
      window.removeEventListener("pointerdown", enableFromGesture);
      window.removeEventListener("touchstart", enableFromGesture);
      window.removeEventListener("touchend", enableFromGesture);
    };
  }, [enableGyro, needsMotionTap, usingGyro]);

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
          colors={["#7300ff", "#eba8ff", "#00bfff"]}
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
      <main
        className="stage"
        aria-label="Interactive dither QR card experiment"
        onPointerDown={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerLeave={resetPointer}
      >
        {needsMotionTap && !usingGyro ? <p className="motion-hint">tap anywhere for motion</p> : null}
        <div className="scene" id="scene">
          <article
            ref={cardRef}
            className={`qr-card ${isActive ? "is-active" : ""}`}
            aria-label="Shader styled QR code card"
          >
            <header className="card-head">
              <div>
                <p className="serial">Visual Experience Designer</p>
                <p className="signal">Atulya</p>
              </div>
            </header>

            <div className="qr-shell">
              <div className={`qr-shader-mask ${maskUrl ? "is-ready" : ""}`} style={maskStyle} aria-label="QR code">
                {SHADER_LAYERS.map((layer) => (
                  <div
                    className="qr-shader-layer"
                    key={layer.key}
                    style={{ "--layer-opacity": `var(${layer.variable})` }}
                    aria-hidden="true"
                  >
                    <Dithering
                      width="100%"
                      height="100%"
                      colorBack="#000000"
                      colorFront={layer.color}
                      shape="warp"
                      type="4x4"
                      size={2.2}
                      speed={0.86}
                      scale={0.88}
                      maxPixelCount={1200000}
                    />
                  </div>
                ))}
              </div>
            </div>

            <footer className="card-foot">
              <span>Design Snaps</span>
              <span>01/01</span>
            </footer>
          </article>
        </div>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")).render(<App />);

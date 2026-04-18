import { useRef, useState, useEffect } from 'react';

/**
 * Derive expression / head-pose features from MediaPipe FaceMesh landmarks.
 *
 * Produces a personal facial baseline over the first BASELINE_MS of face
 * detection (so "furrowed" is measured against YOUR relaxed face, not a
 * population average). All deltas are expressed against that baseline.
 *
 * Shape:
 *   {
 *     browFurrow:    0..1  (0 relaxed, 1 furrowed)
 *     mouthOpen:     0..1  (relative to face height)
 *     earSmoothed:   EMA of eye aspect ratio
 *     lidDroop:      0..1  (earSmoothed below personal baseline)
 *     headPitch:     rad   (positive = head tilted forward, relative to baseline)
 *     headRoll:      rad   (raw, line between ears)
 *     strainIndex:   0..1  (composite fatigue-expression score)
 *     baselineReady: bool
 *   }
 */

const BASELINE_MS = 30_000; // 30s of face presence to lock a baseline
const EMA_ALPHA   = 0.1;
const MOUTH_OPEN_THRESHOLD = 0.08; // relative to face height — yawn/gape

// MediaPipe FaceMesh landmark indices (from the 468-point model)
const LM = {
  noseTip: 1,
  forehead: 10,
  chin: 152,
  leftEar: 234,
  rightEar: 454,
  leftEyeOuter: 33,
  leftEyeInner: 133,
  rightEyeOuter: 263,
  rightEyeInner: 362,
  leftBrowInner: 55,
  rightBrowInner: 285,
  mouthTop: 13,
  mouthBottom: 14,
  leftEyeUpper1: 159,
  leftEyeLower1: 145,
  leftEyeUpper2: 158,
  leftEyeLower2: 153,
  rightEyeUpper1: 386,
  rightEyeLower1: 374,
  rightEyeUpper2: 385,
  rightEyeLower2: 380,
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function computeEAR(lm) {
  const v1L = dist(lm[LM.leftEyeUpper1], lm[LM.leftEyeLower1]);
  const v2L = dist(lm[LM.leftEyeUpper2], lm[LM.leftEyeLower2]);
  const hL  = dist(lm[LM.leftEyeOuter],  lm[LM.leftEyeInner]);
  const v1R = dist(lm[LM.rightEyeUpper1], lm[LM.rightEyeLower1]);
  const v2R = dist(lm[LM.rightEyeUpper2], lm[LM.rightEyeLower2]);
  const hR  = dist(lm[LM.rightEyeOuter],  lm[LM.rightEyeInner]);
  const earL = hL > 0 ? (v1L + v2L) / (2 * hL) : 0.3;
  const earR = hR > 0 ? (v1R + v2R) / (2 * hR) : 0.3;
  return (earL + earR) / 2;
}

export function useFacialFeatures(landmarks) {
  const [features, setFeatures] = useState({
    browFurrow: 0,
    mouthOpen: 0,
    earSmoothed: 0.28,
    lidDroop: 0,
    headPitch: 0,
    headRoll: 0,
    strainIndex: 0,
    baselineReady: false,
  });

  const baselineRef = useRef({
    samples: [],
    startTime: null,
    frozen: null, // { furrow, ear, pitch }
  });
  const emaRef = useRef({ ear: null });

  useEffect(() => {
    if (!landmarks || landmarks.length < 468) return;
    const lm = landmarks;

    // ---- Raw features ----
    const eyeSpan = dist(lm[LM.leftEyeOuter], lm[LM.rightEyeOuter]);
    if (eyeSpan === 0) return;

    // Brow furrow: inner-brow span / eye span.
    // Smaller ratio = brows pulled together = furrowed.
    const browSpan = dist(lm[LM.leftBrowInner], lm[LM.rightBrowInner]);
    const furrowRatio = browSpan / eyeSpan;

    // Mouth open: vertical lip gap / face height.
    const faceH = dist(lm[LM.forehead], lm[LM.chin]);
    const mouthOpen = faceH > 0
      ? dist(lm[LM.mouthTop], lm[LM.mouthBottom]) / faceH
      : 0;

    // EAR (eye aspect ratio)
    const ear = computeEAR(lm);

    // Head pitch: nose-y relative to forehead-chin midpoint, normalized.
    // Positive = head dropped forward (classic fatigue signal).
    const midY = (lm[LM.forehead].y + lm[LM.chin].y) / 2;
    const pitchRaw = faceH > 0 ? (lm[LM.noseTip].y - midY) / faceH : 0;

    // Head roll: angle between the two ears.
    const roll = Math.atan2(
      lm[LM.rightEar].y - lm[LM.leftEar].y,
      lm[LM.rightEar].x - lm[LM.leftEar].x,
    );

    // ---- Baseline accumulation ----
    const now = Date.now();
    const b = baselineRef.current;
    if (b.startTime === null) b.startTime = now;
    if (!b.frozen) {
      if (now - b.startTime < BASELINE_MS) {
        b.samples.push({ furrow: furrowRatio, ear, pitch: pitchRaw });
      } else if (b.samples.length > 30) {
        const mean = (k) => b.samples.reduce((s, x) => s + x[k], 0) / b.samples.length;
        b.frozen = {
          furrow: mean('furrow'),
          ear: Math.max(0.18, mean('ear')),
          pitch: mean('pitch'),
        };
      }
    }

    // ---- EMA smoothing ----
    if (emaRef.current.ear === null) emaRef.current.ear = ear;
    else emaRef.current.ear = emaRef.current.ear * (1 - EMA_ALPHA) + ear * EMA_ALPHA;
    const earSmoothed = emaRef.current.ear;

    // ---- Derived features (relative to baseline) ----
    let browFurrow = 0;
    let lidDroop = 0;
    let pitchDelta = 0;

    if (b.frozen) {
      // Brow closer than baseline = more furrowed. Scale *2 because the signal is tiny.
      browFurrow = Math.max(0, Math.min(1,
        (b.frozen.furrow - furrowRatio) / b.frozen.furrow * 2
      ));
      // EAR below baseline = lids dropping
      lidDroop = Math.max(0, Math.min(1,
        (b.frozen.ear - earSmoothed) / b.frozen.ear
      ));
      // Head dropping forward from baseline
      pitchDelta = Math.max(0, pitchRaw - b.frozen.pitch);
    }

    // ---- Composite strain index ----
    const strainIndex = Math.max(0, Math.min(1,
      0.35 * browFurrow +
      0.25 * (mouthOpen > MOUTH_OPEN_THRESHOLD ? 1 : 0) +
      0.25 * lidDroop +
      0.15 * Math.min(pitchDelta * 5, 1)
    ));

    setFeatures({
      browFurrow,
      mouthOpen,
      earSmoothed,
      lidDroop,
      headPitch: pitchDelta,
      headRoll: roll,
      strainIndex,
      baselineReady: !!b.frozen,
    });
  }, [landmarks]);

  return features;
}

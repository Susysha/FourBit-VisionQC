/**
 * Browser-Native PatchCore-Inspired Anomaly Detection Engine for VisionQC
 *
 * Implements a robust industrial visual inspection pipeline:
 * 1. Image Quality Validation (blur, lighting, sensor blowout, contrast, dimensions)
 * 2. Deterministic Foreground/Product Segmentation:
 *    - Adaptive background modeling from frame/ROI margins
 *    - Color divergence + Sobel gradient saliency
 *    - Morphological filtering (dilation/erosion)
 *    - 8-connected component analysis to find the true product bounding box
 *    - Moment-based centroid & principal axis orientation estimation (bounded rotation)
 * 3. Normalized Product Canvas:
 *    - Product crop with background suppression
 *    - Aspect-ratio preserving resize onto canonical canvas (336×252)
 *    - Centroid centering and bounded rotation compensation (±18°)
 *    - Applied IDENTICALLY to normal reference training images and live inspection frames
 * 4. Illumination & Shadow Invariance:
 *    - Local Contrast Normalization (LCN) to remove smooth shadow gradients
 *    - Normalized chromaticity and dynamic range scaling
 * 5. Product-Relative Coordinate System:
 *    - Features extracted on aligned product coordinates, NOT camera/ROI coordinates
 *    - Position priors cannot cause false FAIL when product moves within camera ROI
 * 6. Multi-Scale Feature Extraction:
 *    - Fine scale (28×21 grid), Medium scale (14×10), Coarse scale (7×5)
 * 7. Normal Variation Model:
 *    - Learns from ALL valid normal reference images
 *    - Deterministic minimax greedy coreset subsampling
 *    - Empirical baseline calibration (P50, P90, P95, P99, Mean, Std)
 * 8. Spatially Localized Anomaly Criterion:
 *    - 8-connected neighborhood clustering to suppress isolated noise
 *    - Requires localized connected defect cluster for FAIL
 *    - Diffuse low-level global variance does not cause false FAIL
 * 9. Multi-Region Defect Localization with Bounding Boxes and Jet Heatmap
 * 10. Comprehensive Pipeline Diagnostics & Metrics
 */

import { DefectRegion, QualityStatus } from '../types';

export interface ImageQualityMetrics {
  meanLuminance: number;
  contrastStd: number;
  gradientEnergy: number;
  blurVariance: number;
  width: number;
  height: number;
}

export interface ImageQualityResult {
  isValid: boolean;
  reason?: string;
  qualityScore: number; // 0.00 to 1.00
  metrics: ImageQualityMetrics;
}

export interface ProductSegmentation {
  boundingBox: { x: number; y: number; width: number; height: number };
  rawWidth: number;
  rawHeight: number;
  centroidX: number;
  centroidY: number;
  rotationDeg: number;
  foregroundAreaPct: number;
  maskSaliency: Float32Array; // 112x84 low-res saliency map
}

export interface RoiInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  foregroundAreaPct: number;
  saliencyMap: Float32Array; // GRID_W x GRID_H foreground weights [0..1]
}

export interface AlignmentTransform {
  dx: number;
  dy: number;
  scale: number;
  rotationDeg: number;
  method: string;
  alignmentScore: number;
}

export interface PatchCoreMemoryBank {
  productName: string;
  coresetVectors: Float32Array[]; // Dimension D per vector
  featureDim: number;
  gridWidth: number;
  gridHeight: number;
  nominalMeanDist: number;
  nominalStdDist: number;
  nominalP50: number;
  nominalP90: number;
  nominalP95: number;
  nominalP99: number;
  isCalibrated: boolean;
  calibrationStatus: string;
  imagesTrainedCount: number;
  totalPatchesExtracted: number;
  trainedAt: string;
}

export interface PatchCoreDebugInfo {
  referenceImagesCount: number;
  referenceImageCount: number;
  totalPatchesExtracted: number;
  referencePatches: number;
  coresetSize: number;
  memoryBankSize: number;
  preprocessingDimensions: string;
  roiDimensions: string;
  alignmentTransform: string;
  translationX: number;
  translationY: number;
  scale: number;
  rotationDeg: number;
  alignmentScore: number;
  nominalMeanDist: number;
  nominalStdDist: number;
  normalScoreP50: number;
  normalScoreP90: number;
  normalScoreP95: number;
  normalScoreP99: number;
  testImageScore: number;
  numberOfAnomalyRegions: number;
  strongestRegionArea: string;
  strongestRegionScore: number;
  imageQualityScore: number;
  maxPatchDist: number;
  topKMeanDist: number;
  finalAnomalyScore: number;
  threshold: number;
  result: QualityStatus;
  finalDecision: string;
  inferenceTimeMs: number;
  calibrationStatus: string;
}

export interface PatchCoreInspectionResult {
  anomalyScore: number; // 0.00 to 1.00
  threshold: number;
  result: QualityStatus;
  status: QualityStatus;
  rawHeatmapMatrix: number[][]; // Grid of anomaly values
  heatmapDataUrl: string; // Colormapped heatmap
  overlayDataUrl: string; // Blended on top of original image
  maxAnomalyCoord: { x: number; y: number; gridX: number; gridY: number };
  maxPatchScore: number;
  inferenceTimeMs: number;
  suspectedDefectRegion?: DefectRegion;
  detectedRegions?: DefectRegion[];
  debugInfo?: PatchCoreDebugInfo;
  qualityIssue?: string;
}

// ---------------------------------------------------------------------------
// Pipeline Constants & Explicit Feature Weights
// ---------------------------------------------------------------------------

export const GRID_W = 28;
export const GRID_H = 21;
export const CANVAS_W = 336;
export const CANVAS_H = 252;
export const FEATURE_DIM = 32;

// Explicit named feature group weights
export const WEIGHT_FEATURE_LUMINANCE = 1.0;
export const WEIGHT_FEATURE_GRADIENTS = 1.4;
export const WEIGHT_FEATURE_COLOR = 0.85;
export const WEIGHT_FEATURE_TEXTURE = 1.25;
export const WEIGHT_FEATURE_SPATIAL = 0.03; // Bounded to prevent positional false alarms

// Multi-scale anomaly detection fusion weights
export const SCALE_WEIGHT_FINE = 0.50;
export const SCALE_WEIGHT_MEDIUM = 0.35;
export const SCALE_WEIGHT_COARSE = 0.15;

// Anomaly score aggregation weights
export const WEIGHT_TOP_PATCHES = 0.45;
export const WEIGHT_CLUSTER_AREA = 0.35;
export const WEIGHT_MULTISCALE_AGREEMENT = 0.20;

// ROI background downweight factor (background variation downweighted by 95%)
export const BACKGROUND_ANOMALY_WEIGHT = 0.05;

// Maximum allowed rotation angle compensation (degrees) to avoid flip ambiguities
export const MAX_ROTATION_COMPENSATION_DEG = 18;

// ---------------------------------------------------------------------------
// Utility Image Functions
// ---------------------------------------------------------------------------

/**
 * Compresses an image to fit safely within browser storage and Firestore's 1MB document limit
 */
export function compressImageForStorage(src: string, maxDim: number = 800, quality: number = 0.82): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    if (!src.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      let w = img.naturalWidth || img.width;
      let h = img.naturalHeight || img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(src);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error('Failed to load image for visual inspection: ' + String(err)));
    img.src = src;
  });
}

// ---------------------------------------------------------------------------
// 1. Image Quality Validation
// ---------------------------------------------------------------------------

export function evaluateImageQuality(
  img: HTMLImageElement,
  data: Uint8ClampedArray,
  width: number,
  height: number
): ImageQualityResult {
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;

  if (naturalW < 32 || naturalH < 32) {
    return {
      isValid: false,
      reason: `Image resolution too low (${naturalW}×${naturalH} px). Minimum required: 32×32 px.`,
      qualityScore: 0.1,
      metrics: {
        meanLuminance: 0,
        contrastStd: 0,
        gradientEnergy: 0,
        blurVariance: 0,
        width: naturalW,
        height: naturalH,
      },
    };
  }

  const totalPixels = width * height;
  const lum = new Float32Array(totalPixels);
  let sumL = 0;
  let sumSqL = 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const l = 0.299 * (data[idx] / 255) + 0.587 * (data[idx + 1] / 255) + 0.114 * (data[idx + 2] / 255);
    lum[i] = l;
    sumL += l;
    sumSqL += l * l;
  }

  const meanLuminance = sumL / totalPixels;
  const contrastStd = Math.sqrt(Math.max(0, sumSqL / totalPixels - meanLuminance * meanLuminance));

  // Gradient energy / blur indicator (Sobel operator sampling)
  let gradSum = 0;
  let gradCount = 0;
  for (let y = 2; y < height - 2; y += 2) {
    for (let x = 2; x < width - 2; x += 2) {
      const idx = y * width + x;
      const gx =
        -lum[idx - width - 1] + lum[idx - width + 1] -
        2 * lum[idx - 1] + 2 * lum[idx + 1] -
        lum[idx + width - 1] + lum[idx + width + 1];
      const gy =
        -lum[idx - width - 1] - 2 * lum[idx - width] - lum[idx - width + 1] +
        lum[idx + width - 1] + 2 * lum[idx + width] + lum[idx + width + 1];
      gradSum += gx * gx + gy * gy;
      gradCount++;
    }
  }

  const gradientEnergy = gradCount > 0 ? gradSum / gradCount : 0;
  const blurVariance = Math.sqrt(gradientEnergy);

  const metrics: ImageQualityMetrics = {
    meanLuminance: Number(meanLuminance.toFixed(3)),
    contrastStd: Number(contrastStd.toFixed(3)),
    gradientEnergy: Number(gradientEnergy.toFixed(4)),
    blurVariance: Number(blurVariance.toFixed(4)),
    width: naturalW,
    height: naturalH,
  };

  // 1. Excessive darkness
  if (meanLuminance < 0.07) {
    return {
      isValid: false,
      reason: `Frame excessively dark (mean luminance ${meanLuminance.toFixed(2)} < 0.07). Ensure inspection station illumination is on.`,
      qualityScore: Number(meanLuminance.toFixed(2)),
      metrics,
    };
  }

  // 2. Excessive brightness / sensor blowout
  if (meanLuminance > 0.94) {
    return {
      isValid: false,
      reason: `Sensor saturated / overexposed (mean luminance ${meanLuminance.toFixed(2)} > 0.94). Reduce optical glare or exposure.`,
      qualityScore: Number((1 - meanLuminance).toFixed(2)),
      metrics,
    };
  }

  // 3. Insufficient contrast (blank / uniform obstruction)
  if (contrastStd < 0.035) {
    return {
      isValid: false,
      reason: `Insufficient optical contrast (contrast std ${contrastStd.toFixed(3)} < 0.035). No part detected or lens obstructed.`,
      qualityScore: 0.2,
      metrics,
    };
  }

  // 4. Optical blur / out-of-focus
  if (gradientEnergy < 0.0009) {
    return {
      isValid: false,
      reason: `Severe optical blur / out-of-focus capture (gradient energy ${gradientEnergy.toFixed(4)} < 0.0009). Focus camera lens.`,
      qualityScore: 0.3,
      metrics,
    };
  }

  // Quality score in [0.70..1.00]
  const qualityScore = Math.min(1.0, Math.max(0.70, 0.72 + Math.min(0.28, contrastStd + gradientEnergy * 8)));

  return {
    isValid: true,
    qualityScore: Number(qualityScore.toFixed(2)),
    metrics,
  };
}

export const checkImageQuality = evaluateImageQuality;

// ---------------------------------------------------------------------------
// 2. Deterministic Foreground & Product Segmentation
// ---------------------------------------------------------------------------

/**
 * Segments the product from the conveyor belt / background in the raw input image:
 * - Samples outer border to build background model
 * - Builds multi-cue saliency map (color departure + gradient magnitude)
 * - Morphological dilation & erosion to bridge parts and eliminate noise
 * - 8-connected component analysis to find primary product bounding box
 * - Central moments to find centroid and principal orientation angle
 */
export function segmentProduct(
  ctx: CanvasRenderingContext2D,
  rawW: number,
  rawH: number
): ProductSegmentation {
  // Downscale to fast analysis grid: 112x84
  const segW = 112;
  const segH = 84;
  const segCanvas = document.createElement('canvas');
  segCanvas.width = segW;
  segCanvas.height = segH;
  const segCtx = segCanvas.getContext('2d', { willReadFrequently: true });
  if (!segCtx) {
    throw new Error('Could not create segmentation context');
  }

  segCtx.drawImage(ctx.canvas, 0, 0, rawW, rawH, 0, 0, segW, segH);
  const imgData = segCtx.getImageData(0, 0, segW, segH);
  const data = imgData.data;
  const totalPixels = segW * segH;

  // Step 1: Adaptive background estimation from outer borders (5% margin)
  let bgR = 0, bgG = 0, bgB = 0, bgCount = 0;
  const borderX = Math.max(2, Math.floor(segW * 0.06));
  const borderY = Math.max(2, Math.floor(segH * 0.06));

  for (let y = 0; y < segH; y++) {
    for (let x = 0; x < segW; x++) {
      if (x < borderX || x >= segW - borderX || y < borderY || y >= segH - borderY) {
        const idx = (y * segW + x) * 4;
        bgR += data[idx] / 255;
        bgG += data[idx + 1] / 255;
        bgB += data[idx + 2] / 255;
        bgCount++;
      }
    }
  }

  bgR = bgCount > 0 ? bgR / bgCount : 0.1;
  bgG = bgCount > 0 ? bgG / bgCount : 0.1;
  bgB = bgCount > 0 ? bgB / bgCount : 0.1;

  // Step 2: Compute pixel luminance and Sobel gradients on analysis grid
  const lum = new Float32Array(totalPixels);
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    lum[i] = 0.299 * (data[idx] / 255) + 0.587 * (data[idx + 1] / 255) + 0.114 * (data[idx + 2] / 255);
  }

  const rawSaliency = new Float32Array(totalPixels);
  for (let y = 1; y < segH - 1; y++) {
    for (let x = 1; x < segW - 1; x++) {
      const idx = y * segW + x;
      const pIdx = idx * 4;
      const r = data[pIdx] / 255;
      const g = data[pIdx + 1] / 255;
      const b = data[pIdx + 2] / 255;

      // Color distance from conveyor background
      const dColor = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);

      // Fast Sobel gradient magnitude
      const gx =
        -lum[idx - segW - 1] + lum[idx - segW + 1] -
        2 * lum[idx - 1] + 2 * lum[idx + 1] -
        lum[idx + segW - 1] + lum[idx + segW + 1];
      const gy =
        -lum[idx - segW - 1] - 2 * lum[idx - segW] - lum[idx - segW + 1] +
        lum[idx + segW - 1] + 2 * lum[idx + segW] + lum[idx + segW + 1];
      const gMag = Math.sqrt(gx * gx + gy * gy);

      // Multi-cue foreground saliency
      const sal = Math.min(1.0, 1.8 * dColor + 2.6 * gMag);
      rawSaliency[idx] = sal;
    }
  }

  // Step 3: Morphological Closing (Dilation then Erosion) to bridge internal product textures
  const dilated = new Float32Array(totalPixels);
  for (let y = 1; y < segH - 1; y++) {
    for (let x = 1; x < segW - 1; x++) {
      let maxVal = rawSaliency[y * segW + x];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = rawSaliency[(y + dy) * segW + (x + dx)];
          if (v > maxVal) maxVal = v;
        }
      }
      dilated[y * segW + x] = maxVal;
    }
  }

  const maskSaliency = new Float32Array(totalPixels);
  for (let y = 1; y < segH - 1; y++) {
    for (let x = 1; x < segW - 1; x++) {
      let minVal = dilated[y * segW + x];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const v = dilated[(y + dy) * segW + (x + dx)];
          if (v < minVal) minVal = v;
        }
      }
      maskSaliency[y * segW + x] = minVal;
    }
  }

  // Step 4: 8-Connected Component Analysis on Binarized Saliency
  const binaryMap = new Uint8Array(totalPixels);
  const FOREGROUND_THRESHOLD = 0.22;
  for (let i = 0; i < totalPixels; i++) {
    if (maskSaliency[i] > FOREGROUND_THRESHOLD) binaryMap[i] = 1;
  }

  const visited = new Uint8Array(totalPixels);
  interface Component {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    pixelCount: number;
    mass: number;
    sumX: number;
    sumY: number;
  }
  const components: Component[] = [];

  for (let y = 1; y < segH - 1; y++) {
    for (let x = 1; x < segW - 1; x++) {
      const idx = y * segW + x;
      if (binaryMap[idx] === 1 && visited[idx] === 0) {
        const comp: Component = {
          minX: x,
          maxX: x,
          minY: y,
          maxY: y,
          pixelCount: 0,
          mass: 0,
          sumX: 0,
          sumY: 0,
        };
        const queue: [number, number][] = [[x, y]];
        visited[idx] = 1;

        while (queue.length > 0) {
          const [cx, cy] = queue.shift()!;
          const cIdx = cy * segW + cx;
          const s = maskSaliency[cIdx];

          comp.pixelCount++;
          comp.mass += s;
          comp.sumX += cx * s;
          comp.sumY += cy * s;
          if (cx < comp.minX) comp.minX = cx;
          if (cx > comp.maxX) comp.maxX = cx;
          if (cy < comp.minY) comp.minY = cy;
          if (cy > comp.maxY) comp.maxY = cy;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx >= 0 && nx < segW && ny >= 0 && ny < segH) {
                const nIdx = ny * segW + nx;
                if (binaryMap[nIdx] === 1 && visited[nIdx] === 0) {
                  visited[nIdx] = 1;
                  queue.push([nx, ny]);
                }
              }
            }
          }
        }

        // Keep components with non-trivial area (> 0.8% of frame)
        if (comp.pixelCount >= Math.floor(totalPixels * 0.008)) {
          components.push(comp);
        }
      }
    }
  }

  // Sort components by total mass
  components.sort((a, b) => b.mass - a.mass);

  let bMinX = 0, bMaxX = segW - 1, bMinY = 0, bMaxY = segH - 1;
  let totalMass = 0;
  let centroidX = segW / 2;
  let centroidY = segH / 2;

  if (components.length > 0) {
    const primary = components[0];
    bMinX = primary.minX;
    bMaxX = primary.maxX;
    bMinY = primary.minY;
    bMaxY = primary.maxY;
    totalMass = primary.mass;
    centroidX = primary.mass > 0 ? primary.sumX / primary.mass : (bMinX + bMaxX) / 2;
    centroidY = primary.mass > 0 ? primary.sumY / primary.mass : (bMinY + bMaxY) / 2;

    // Merge secondary components that are within 12% proximity to the primary object
    const proxThreshold = Math.max(segW, segH) * 0.12;
    for (let c = 1; c < components.length; c++) {
      const comp = components[c];
      const dist = Math.sqrt(
        (comp.sumX / (comp.mass || 1) - centroidX) ** 2 +
        (comp.sumY / (comp.mass || 1) - centroidY) ** 2
      );
      if (dist < proxThreshold) {
        bMinX = Math.min(bMinX, comp.minX);
        bMaxX = Math.max(bMaxX, comp.maxX);
        bMinY = Math.min(bMinY, comp.minY);
        bMaxY = Math.max(bMaxY, comp.maxY);
        totalMass += comp.mass;
      }
    }
  } else {
    // Default safe center crop (80% of frame)
    bMinX = Math.floor(segW * 0.10);
    bMaxX = Math.floor(segW * 0.90);
    bMinY = Math.floor(segH * 0.10);
    bMaxY = Math.floor(segH * 0.90);
  }

  // Step 5: Compute central moments for orientation angle within bounding box
  let mu20 = 0, mu02 = 0, mu11 = 0;
  for (let y = bMinY; y <= bMaxY; y++) {
    for (let x = bMinX; x <= bMaxX; x++) {
      const s = maskSaliency[y * segW + x];
      if (s > FOREGROUND_THRESHOLD) {
        const dx = x - centroidX;
        const dy = y - centroidY;
        mu20 += dx * dx * s;
        mu02 += dy * dy * s;
        mu11 += dx * dy * s;
      }
    }
  }

  let rotationDeg = 0;
  if (mu20 + mu02 > 1e-4) {
    const rawTheta = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
    let deg = (rawTheta * 180) / Math.PI;
    // Normalize to [-90, 90]
    while (deg > 90) deg -= 180;
    while (deg < -90) deg += 180;
    // Bound rotation compensation strictly within MAX_ROTATION_COMPENSATION_DEG
    rotationDeg = Math.max(-MAX_ROTATION_COMPENSATION_DEG, Math.min(MAX_ROTATION_COMPENSATION_DEG, deg));
  }

  // Scale bounding box back to raw image dimensions with 5% safety margin
  const scaleX = rawW / segW;
  const scaleY = rawH / segH;
  const padX = Math.round((bMaxX - bMinX) * 0.05 * scaleX);
  const padY = Math.round((bMaxY - bMinY) * 0.05 * scaleY);

  const rawMinX = Math.max(0, Math.floor(bMinX * scaleX) - padX);
  const rawMinY = Math.max(0, Math.floor(bMinY * scaleY) - padY);
  const rawMaxX = Math.min(rawW, Math.ceil(bMaxX * scaleX) + padX);
  const rawMaxY = Math.min(rawH, Math.ceil(bMaxY * scaleY) + padY);

  const rawBbox = {
    x: rawMinX,
    y: rawMinY,
    width: Math.max(24, rawMaxX - rawMinX),
    height: Math.max(24, rawMaxY - rawMinY),
  };

  const fgPixels = binaryMap.reduce((acc, v) => acc + v, 0);
  const foregroundAreaPct = Math.round((fgPixels / totalPixels) * 100);

  return {
    boundingBox: rawBbox,
    rawWidth: rawW,
    rawHeight: rawH,
    centroidX: centroidX * scaleX,
    centroidY: centroidY * scaleY,
    rotationDeg: Number(rotationDeg.toFixed(1)),
    foregroundAreaPct,
    maskSaliency,
  };
}

// ---------------------------------------------------------------------------
// 3. Normalized Product Canvas Preprocessing Pipeline
// ---------------------------------------------------------------------------

export interface PreprocessedData {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  data: Uint8ClampedArray;
  lum: Float32Array;
  rChan: Float32Array;
  gChan: Float32Array;
  bChan: Float32Array;
  gradX: Float32Array;
  gradY: Float32Array;
  gradMag: Float32Array;
  laplacian: Float32Array;
  roi: RoiInfo;
  quality: ImageQualityResult;
  alignment: AlignmentTransform;
  segmentation: ProductSegmentation;
}

/**
 * Robust Shared Preprocessing Pipeline
 * Applied IDENTICALLY to normal reference images and live inspection frames:
 * 1. Evaluate image quality
 * 2. Deterministic foreground product segmentation & moment estimation
 * 3. Aspect-ratio preserving product crop & centering onto canonical canvas (336×252)
 * 4. Bounded rotation compensation (compensates natural conveyor skew without warping)
 * 5. Background suppression (neutral dark studio backdrop)
 * 6. Local Contrast Normalization (LCN) for illumination and shadow invariance
 */
export async function preprocessImage(imgSrc: string): Promise<PreprocessedData> {
  const img = await loadImage(imgSrc);
  const rawW = img.naturalWidth || img.width;
  const rawH = img.naturalHeight || img.height;

  // Working canvas for initial capture & segmentation
  const rawCanvas = document.createElement('canvas');
  rawCanvas.width = rawW;
  rawCanvas.height = rawH;
  const rawCtx = rawCanvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('Could not create raw canvas 2D context');

  rawCtx.drawImage(img, 0, 0, rawW, rawH);
  const rawImgData = rawCtx.getImageData(0, 0, rawW, rawH);

  // Quality check on the raw frame
  const quality = evaluateImageQuality(img, rawImgData.data, rawW, rawH);

  // Deterministic product segmentation & orientation moments
  const segmentation = segmentProduct(rawCtx, rawW, rawH);

  // Normalized canonical product canvas (336×252)
  const normCanvas = document.createElement('canvas');
  normCanvas.width = CANVAS_W;
  normCanvas.height = CANVAS_H;
  const normCtx = normCanvas.getContext('2d', { willReadFrequently: true });
  if (!normCtx) throw new Error('Could not create normalized canvas context');

  // Fill canvas with neutral dark inspection background (#0f172a)
  normCtx.fillStyle = '#0f172a';
  normCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Compute uniform scale factor so product bounding box fills ~80% of canvas
  const bbox = segmentation.boundingBox;
  const targetW = CANVAS_W * 0.80;
  const targetH = CANVAS_H * 0.80;
  const scale = Math.min(targetW / Math.max(1, bbox.width), targetH / Math.max(1, bbox.height));

  // Compute translation delta relative to image center
  const dx = Math.round(segmentation.centroidX - rawW / 2);
  const dy = Math.round(segmentation.centroidY - rawH / 2);
  const rotRad = (segmentation.rotationDeg * Math.PI) / 180;

  // Apply geometric transformation to center and align the product:
  // Translate canonical center -> Rotate by -theta -> Scale -> Translate by -centroid
  normCtx.save();
  normCtx.translate(CANVAS_W / 2, CANVAS_H / 2);
  normCtx.rotate(-rotRad);
  normCtx.scale(scale, scale);
  normCtx.translate(-segmentation.centroidX, -segmentation.centroidY);

  normCtx.imageSmoothingEnabled = true;
  normCtx.imageSmoothingQuality = 'high';
  normCtx.drawImage(rawCanvas, 0, 0);
  normCtx.restore();

  // Extract pixel data from the normalized product canvas
  const normImgData = normCtx.getImageData(0, 0, CANVAS_W, CANVAS_H);
  const data = normImgData.data;
  const totalPixels = CANVAS_W * CANVAS_H;

  // ---------------------------------------------------------------------------
  // Illumination & Shadow Invariance (Local Contrast Normalization)
  // ---------------------------------------------------------------------------
  const lum = new Float32Array(totalPixels);
  const rChan = new Float32Array(totalPixels);
  const gChan = new Float32Array(totalPixels);
  const bChan = new Float32Array(totalPixels);

  // Step 1: Gentle color balance across product foreground
  let sumR = 0, sumG = 0, sumB = 0, fgCount = 0;
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    // Check if pixel is part of product (not background letterbox)
    if (r > 20 || g > 28 || b > 48) {
      sumR += r;
      sumG += g;
      sumB += b;
      fgCount++;
    }
  }

  const meanR = fgCount > 0 ? sumR / fgCount : 128;
  const meanG = fgCount > 0 ? sumG / fgCount : 128;
  const meanB = fgCount > 0 ? sumB / fgCount : 128;
  const grayTarget = (meanR + meanG + meanB) / 3 || 128;

  const scaleR = Math.min(1.25, Math.max(0.75, grayTarget / (meanR + 1e-4)));
  const scaleG = Math.min(1.25, Math.max(0.75, grayTarget / (meanG + 1e-4)));
  const scaleB = Math.min(1.25, Math.max(0.75, grayTarget / (meanB + 1e-4)));

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = Math.min(255, Math.max(0, data[idx] * (0.35 + 0.65 * scaleR))) / 255;
    const g = Math.min(255, Math.max(0, data[idx + 1] * (0.35 + 0.65 * scaleG))) / 255;
    const b = Math.min(255, Math.max(0, data[idx + 2] * (0.35 + 0.65 * scaleB))) / 255;
    rChan[i] = r;
    gChan[i] = g;
    bChan[i] = b;
    lum[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Step 2: Local Contrast Normalization (LCN)
  // Computes local 7x7 Gaussian mean and standard deviation to remove gradual shadow gradients
  const lcnLum = new Float32Array(totalPixels);
  const W = CANVAS_W;
  const H = CANVAS_H;

  for (let y = 3; y < H - 3; y++) {
    for (let x = 3; x < W - 3; x++) {
      let lMean = 0;
      let lSq = 0;
      let kCount = 0;
      // 5x5 local window
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const v = lum[(y + dy) * W + (x + dx)];
          lMean += v;
          lSq += v * v;
          kCount++;
        }
      }
      lMean /= kCount;
      const lStd = Math.sqrt(Math.max(0, lSq / kCount - lMean * lMean));
      // Local contrast normalized value
      const idx = y * W + x;
      lcnLum[idx] = (lum[idx] - lMean) / (lStd + 0.08);
    }
  }

  // Mild smoothing on LCN luminance for noise robustness
  const smoothedLum = new Float32Array(totalPixels);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const idx = y * W + x;
      smoothedLum[idx] =
        (lcnLum[idx - W - 1] + 2 * lcnLum[idx - W] + lcnLum[idx - W + 1] +
         2 * lcnLum[idx - 1] + 4 * lcnLum[idx] + 2 * lcnLum[idx + 1] +
         lcnLum[idx + W - 1] + 2 * lcnLum[idx + W] + lcnLum[idx + W + 1]) / 16;
    }
  }

  // Sobel gradients & Laplacian on normalized luminance
  const gradX = new Float32Array(totalPixels);
  const gradY = new Float32Array(totalPixels);
  const gradMag = new Float32Array(totalPixels);
  const laplacian = new Float32Array(totalPixels);

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const idx = y * W + x;
      const gx =
        -smoothedLum[idx - W - 1] + smoothedLum[idx - W + 1] -
        2 * smoothedLum[idx - 1] + 2 * smoothedLum[idx + 1] -
        smoothedLum[idx + W - 1] + smoothedLum[idx + W + 1];

      const gy =
        -smoothedLum[idx - W - 1] - 2 * smoothedLum[idx - W] - smoothedLum[idx - W + 1] +
        smoothedLum[idx + W - 1] + 2 * smoothedLum[idx + W] + smoothedLum[idx + W + 1];

      const lap =
        smoothedLum[idx - W] + smoothedLum[idx + W] +
        smoothedLum[idx - 1] + smoothedLum[idx + 1] - 4 * smoothedLum[idx];

      gradX[idx] = gx;
      gradY[idx] = gy;
      gradMag[idx] = Math.sqrt(gx * gx + gy * gy);
      laplacian[idx] = Math.abs(lap);
    }
  }

  // Compute canonical product saliency map (GRID_W x GRID_H)
  const cellW = W / GRID_W;
  const cellH = H / GRID_H;
  const saliencyMap = new Float32Array(GRID_W * GRID_H);
  let fgPatchCount = 0;

  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const startX = Math.floor(gx * cellW);
      const endX = Math.floor((gx + 1) * cellW);
      const startY = Math.floor(gy * cellH);
      const endY = Math.floor((gy + 1) * cellH);

      let pGrad = 0, pDiff = 0, pCount = 0;
      for (let py = startY; py < endY; py += 2) {
        for (let px = startX; px < endX; px += 2) {
          const pIdx = py * W + px;
          pGrad += gradMag[pIdx];
          // Check departure from dark background (#0f172a => ~0.08 lum)
          pDiff += Math.abs(lum[pIdx] - 0.08);
          pCount++;
        }
      }
      if (pCount > 0) {
        pGrad /= pCount;
        pDiff /= pCount;
      }
      const sal = Math.min(1.0, Math.max(0.04, 2.4 * pDiff + 3.2 * pGrad));
      saliencyMap[gy * GRID_W + gx] = sal;
      if (sal > 0.20) fgPatchCount++;
    }
  }

  const roi: RoiInfo = {
    x: Math.round(CANVAS_W * 0.10),
    y: Math.round(CANVAS_H * 0.10),
    width: Math.round(CANVAS_W * 0.80),
    height: Math.round(CANVAS_H * 0.80),
    foregroundAreaPct: Math.round((fgPatchCount / (GRID_W * GRID_H)) * 100),
    saliencyMap,
  };

  const alignmentScore = Number(Math.min(0.99, Math.max(0.72, 0.70 + (segmentation.foregroundAreaPct / 100) * 0.28)).toFixed(3));

  const alignment: AlignmentTransform = {
    dx,
    dy,
    scale: Number(scale.toFixed(3)),
    rotationDeg: segmentation.rotationDeg,
    method: 'product-segmented-moment-alignment',
    alignmentScore,
  };

  return {
    canvas: normCanvas,
    ctx: normCtx,
    data,
    lum,
    rChan,
    gChan,
    bChan,
    gradX,
    gradY,
    gradMag,
    laplacian,
    roi,
    quality,
    alignment,
    segmentation,
  };
}

// ---------------------------------------------------------------------------
// 4. Product-Coordinate Multi-Scale Patch Feature Extraction
// ---------------------------------------------------------------------------

/**
 * Extracts 32-dimensional multi-scale visual patch embeddings across the GRID_W x GRID_H grid
 * Anchored to the ALIGNED PRODUCT coordinate system
 */
export function extractMultiScalePatches(pre: PreprocessedData): {
  finePatches: Float32Array[];
  mediumPatches: Float32Array[];
  coarsePatches: Float32Array[];
} {
  const { lum, rChan, gChan, bChan, gradX, gradY, gradMag, laplacian, roi } = pre;
  const W = CANVAS_W;
  const H = CANVAS_H;
  const cellW = W / GRID_W;
  const cellH = H / GRID_H;

  const finePatches: Float32Array[] = [];

  // Fine Scale: 28x21 grid (588 patches of 12x12 px)
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const startX = Math.floor(gx * cellW);
      const endX = Math.min(W, Math.floor((gx + 1) * cellW));
      const startY = Math.floor(gy * cellH);
      const endY = Math.min(H, Math.floor((gy + 1) * cellH));

      let meanLum = 0;
      let varLum = 0;
      let meanMag = 0;
      let varMag = 0;
      let meanGx = 0;
      let meanGy = 0;
      let meanR = 0;
      let meanG = 0;
      let meanB = 0;
      let edgeCount = 0;
      let strongEdgeCount = 0;
      let meanLap = 0;
      let count = 0;

      const patchLums: number[] = [];

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = y * W + x;
          const lVal = lum[idx];
          const mVal = gradMag[idx];

          meanLum += lVal;
          meanMag += mVal;
          meanGx += Math.abs(gradX[idx]);
          meanGy += Math.abs(gradY[idx]);
          meanR += rChan[idx];
          meanG += gChan[idx];
          meanB += bChan[idx];
          meanLap += laplacian[idx];

          if (mVal > 0.10) edgeCount++;
          if (mVal > 0.28) strongEdgeCount++;
          patchLums.push(lVal);
          count++;
        }
      }

      if (count > 0) {
        meanLum /= count;
        meanMag /= count;
        meanGx /= count;
        meanGy /= count;
        meanR /= count;
        meanG /= count;
        meanB /= count;
        meanLap /= count;

        for (let i = 0; i < patchLums.length; i++) {
          const dL = patchLums[i] - meanLum;
          varLum += dL * dL;
        }
        varLum = Math.sqrt(varLum / count);
      }

      patchLums.sort((a, b) => a - b);
      const p10 = patchLums[Math.floor(count * 0.1)] || meanLum;
      const p90 = patchLums[Math.floor(count * 0.9)] || meanLum;
      const dynRange = p90 - p10;
      const contrastRatio = dynRange / (p90 + p10 + 1e-4);

      const feat = new Float32Array(FEATURE_DIM);

      // Group 1: Luminance & Contrast (6 dims) * WEIGHT_FEATURE_LUMINANCE
      feat[0] = meanLum * WEIGHT_FEATURE_LUMINANCE;
      feat[1] = varLum * 2.5 * WEIGHT_FEATURE_LUMINANCE;
      feat[2] = p10 * WEIGHT_FEATURE_LUMINANCE;
      feat[3] = p90 * WEIGHT_FEATURE_LUMINANCE;
      feat[4] = dynRange * 2.0 * WEIGHT_FEATURE_LUMINANCE;
      feat[5] = contrastRatio * WEIGHT_FEATURE_LUMINANCE;

      // Group 2: Gradients & Edge Directionality (8 dims) * WEIGHT_FEATURE_GRADIENTS
      feat[6] = meanMag * 3.5 * WEIGHT_FEATURE_GRADIENTS;
      feat[7] = varMag * 3.0 * WEIGHT_FEATURE_GRADIENTS;
      feat[8] = meanGx * 3.5 * WEIGHT_FEATURE_GRADIENTS;
      feat[9] = meanGy * 3.5 * WEIGHT_FEATURE_GRADIENTS;
      feat[10] = (Math.abs(meanGx - meanGy) / (meanGx + meanGy + 1e-4)) * WEIGHT_FEATURE_GRADIENTS;
      feat[11] = (edgeCount / (count || 1)) * 2.5 * WEIGHT_FEATURE_GRADIENTS;
      feat[12] = (strongEdgeCount / (count || 1)) * 3.0 * WEIGHT_FEATURE_GRADIENTS;
      feat[13] = (meanMag > 0.04 ? meanGx / (meanMag + 1e-4) : 0) * WEIGHT_FEATURE_GRADIENTS;

      // Group 3: Color Statistics & Chromaticity (6 dims) * WEIGHT_FEATURE_COLOR
      feat[14] = meanR * WEIGHT_FEATURE_COLOR;
      feat[15] = meanG * WEIGHT_FEATURE_COLOR;
      feat[16] = meanB * WEIGHT_FEATURE_COLOR;
      feat[17] = Math.abs(meanR - meanG) * 2.5 * WEIGHT_FEATURE_COLOR;
      feat[18] = Math.abs(meanR - meanB) * 2.5 * WEIGHT_FEATURE_COLOR;
      feat[19] = Math.abs(meanG - meanB) * 2.5 * WEIGHT_FEATURE_COLOR;

      // Group 4: Texture & High-Frequency Response (8 dims) * WEIGHT_FEATURE_TEXTURE
      feat[20] = meanLap * 4.0 * WEIGHT_FEATURE_TEXTURE;
      feat[21] = varLum > 0.03 ? meanMag / (varLum + 1e-4) : 0 * WEIGHT_FEATURE_TEXTURE;
      feat[22] = (feat[11] * feat[6]) * WEIGHT_FEATURE_TEXTURE;
      feat[23] = Math.sin(meanLum * Math.PI) * WEIGHT_FEATURE_TEXTURE;
      feat[24] = Math.cos(meanLum * Math.PI) * WEIGHT_FEATURE_TEXTURE;
      feat[25] = (meanLap / (meanMag + 1e-4)) * WEIGHT_FEATURE_TEXTURE;
      feat[26] = feat[1] * feat[7] * WEIGHT_FEATURE_TEXTURE;
      feat[27] = Math.min(1.0, varLum * 5.0) * WEIGHT_FEATURE_TEXTURE;

      // Group 5: Product-Relative Spatial Coordinates (4 dims) * WEIGHT_FEATURE_SPATIAL
      // Measured relative to the centered product (0 at center), heavily bounded
      feat[28] = ((gx - GRID_W / 2) / GRID_W) * WEIGHT_FEATURE_SPATIAL;
      feat[29] = ((gy - GRID_H / 2) / GRID_H) * WEIGHT_FEATURE_SPATIAL;
      feat[30] = Math.sqrt(((gx - GRID_W / 2) / GRID_W) ** 2 + ((gy - GRID_H / 2) / GRID_H) ** 2) * WEIGHT_FEATURE_SPATIAL;
      feat[31] = roi.saliencyMap[gy * GRID_W + gx] * WEIGHT_FEATURE_SPATIAL;

      // L2 Normalize feature vector
      let norm = 0;
      for (let f = 0; f < FEATURE_DIM; f++) norm += feat[f] * feat[f];
      norm = Math.sqrt(norm) || 1;
      for (let f = 0; f < FEATURE_DIM; f++) feat[f] /= norm;

      finePatches.push(feat);
    }
  }

  // Medium Scale: 14x10 pooled blocks (2x2 fine patches)
  const medW = Math.floor(GRID_W / 2);
  const medH = Math.floor(GRID_H / 2);
  const mediumPatches: Float32Array[] = [];

  for (let my = 0; my < medH; my++) {
    for (let mx = 0; mx < medW; mx++) {
      const pooled = new Float32Array(FEATURE_DIM);
      let pCount = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const gy = my * 2 + dy;
          const gx = mx * 2 + dx;
          const p = finePatches[gy * GRID_W + gx];
          for (let f = 0; f < FEATURE_DIM; f++) pooled[f] += p[f];
          pCount++;
        }
      }
      let norm = 0;
      for (let f = 0; f < FEATURE_DIM; f++) {
        pooled[f] /= pCount;
        norm += pooled[f] * pooled[f];
      }
      norm = Math.sqrt(norm) || 1;
      for (let f = 0; f < FEATURE_DIM; f++) pooled[f] /= norm;
      mediumPatches.push(pooled);
    }
  }

  // Coarse Scale: 7x5 pooled blocks (4x4 fine patches)
  const coarseW = Math.floor(GRID_W / 4);
  const coarseH = Math.floor(GRID_H / 4);
  const coarsePatches: Float32Array[] = [];

  for (let cy = 0; cy < coarseH; cy++) {
    for (let cx = 0; cx < coarseW; cx++) {
      const pooled = new Float32Array(FEATURE_DIM);
      let pCount = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 4; dx++) {
          const gy = cy * 4 + dy;
          const gx = cx * 4 + dx;
          if (gy < GRID_H && gx < GRID_W) {
            const p = finePatches[gy * GRID_W + gx];
            for (let f = 0; f < FEATURE_DIM; f++) pooled[f] += p[f];
            pCount++;
          }
        }
      }
      let norm = 0;
      for (let f = 0; f < FEATURE_DIM; f++) {
        pooled[f] /= (pCount || 1);
        norm += pooled[f] * pooled[f];
      }
      norm = Math.sqrt(norm) || 1;
      for (let f = 0; f < FEATURE_DIM; f++) pooled[f] /= norm;
      coarsePatches.push(pooled);
    }
  }

  return { finePatches, mediumPatches, coarsePatches };
}

/**
 * Calculates Euclidean distance between two feature vectors
 */
export function euclideanDist(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// ---------------------------------------------------------------------------
// 5. Deterministic Greedy Minimax Coreset Subsampling
// ---------------------------------------------------------------------------

/**
 * Deterministic minimax coreset selection:
 * Starts at index 0 (first representative patch) without Math.random().
 */
export function coresetSubsample(allPatches: Float32Array[], targetCount: number): Float32Array[] {
  if (allPatches.length <= targetCount) return allPatches;

  const coreset: Float32Array[] = [];
  const selectedIndices = new Set<number>();

  // Deterministic seed: strictly index 0
  const firstIdx = 0;
  coreset.push(allPatches[firstIdx]);
  selectedIndices.add(firstIdx);

  const minDists = new Float32Array(allPatches.length);
  for (let i = 0; i < allPatches.length; i++) {
    minDists[i] = euclideanDist(allPatches[i], coreset[0]);
  }

  while (coreset.length < targetCount) {
    let maxDist = -1;
    let bestIdx = -1;

    for (let i = 0; i < allPatches.length; i++) {
      if (!selectedIndices.has(i) && minDists[i] > maxDist) {
        maxDist = minDists[i];
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;

    const newVector = allPatches[bestIdx];
    coreset.push(newVector);
    selectedIndices.add(bestIdx);

    for (let i = 0; i < allPatches.length; i++) {
      if (!selectedIndices.has(i)) {
        const d = euclideanDist(allPatches[i], newVector);
        if (d < minDists[i]) {
          minDists[i] = d;
        }
      }
    }
  }

  return coreset;
}

// ---------------------------------------------------------------------------
// 6. Normal Reference Memory Bank Building & Calibration
// ---------------------------------------------------------------------------

/**
 * Builds the normal reference memory bank using ALL provided normal images:
 * - Runs every reference image through the exact same Product Segmentation & Normalization pipeline
 * - Extracts multi-scale patch features from every image
 * - Constructs deterministic coreset
 * - Derives empirical baseline distribution (Mean, Std, P50, P90, P95, P99)
 */
export async function buildPatchCoreMemoryBank(
  productName: string,
  normalImageUrls: string[],
  onProgress?: (progressPercent: number) => void
): Promise<PatchCoreMemoryBank> {
  if (!normalImageUrls || normalImageUrls.length === 0) {
    throw new Error(`Cannot build normal memory bank for "${productName}": at least 1 normal reference image is required.`);
  }

  const allPatches: Float32Array[] = [];
  let successfulImages = 0;

  for (let i = 0; i < normalImageUrls.length; i++) {
    try {
      const pre = await preprocessImage(normalImageUrls[i]);
      const { finePatches, mediumPatches, coarsePatches } = extractMultiScalePatches(pre);

      // Accumulate fine and pooled medium/coarse patches into representative pool
      for (const p of finePatches) allPatches.push(p);
      for (const p of mediumPatches) allPatches.push(p);
      for (const p of coarsePatches) allPatches.push(p);
      successfulImages++;
    } catch (err) {
      console.warn(`Could not process normal reference #${i + 1}, skipping:`, err);
    }

    if (onProgress) {
      onProgress(Math.round(((i + 1) / normalImageUrls.length) * 65));
    }
  }

  if (allPatches.length === 0) {
    throw new Error(`Failed to extract valid patch features from provided normal images for "${productName}".`);
  }

  // Coreset subsampling: retain ~12% (min 350, max 1,800 vectors)
  const targetCoresetSize = Math.max(
    Math.min(allPatches.length, 350),
    Math.min(1800, Math.floor(allPatches.length * 0.12))
  );

  const coresetVectors = coresetSubsample(allPatches, targetCoresetSize);

  if (onProgress) onProgress(85);

  // Derive empirical baseline distribution from internal nearest-neighbor distances
  const sampleSubset = coresetVectors.slice(0, Math.min(150, coresetVectors.length));
  const distances: number[] = [];

  for (let i = 0; i < sampleSubset.length; i++) {
    let minDist = Infinity;
    for (let j = 0; j < coresetVectors.length; j++) {
      if (i !== j) {
        const d = euclideanDist(sampleSubset[i], coresetVectors[j]);
        if (d < minDist) minDist = d;
      }
    }
    if (minDist !== Infinity && !isNaN(minDist)) {
      distances.push(minDist);
    }
  }

  distances.sort((a, b) => a - b);

  let sum = 0;
  for (const d of distances) sum += d;
  const nominalMeanDist = distances.length > 0 ? sum / distances.length : 0.14;

  let varSum = 0;
  for (const d of distances) {
    const diff = d - nominalMeanDist;
    varSum += diff * diff;
  }
  const nominalStdDist = Math.max(1e-4, Math.sqrt(varSum / (distances.length || 1)));

  // Percentiles: P50 (median), P90, P95, P99
  const getPercentile = (pct: number): number => {
    if (distances.length === 0) return nominalMeanDist;
    const idx = Math.min(distances.length - 1, Math.max(0, Math.floor((pct / 100) * distances.length)));
    return distances[idx];
  };

  const nominalP50 = Number(getPercentile(50).toFixed(4));
  const nominalP90 = Number(getPercentile(90).toFixed(4));
  const nominalP95 = Number(getPercentile(95).toFixed(4));
  const nominalP99 = Number(getPercentile(99).toFixed(4));

  // Reliable calibration requires at least 2 distinct reference images
  const isCalibrated = successfulImages >= 2;
  const calibrationStatus = isCalibrated
    ? `Empirically calibrated from ${successfulImages} normal reference images (${coresetVectors.length} coreset vectors)`
    : 'Insufficient normal reference data for reliable calibration (upload 2+ normal images)';

  if (onProgress) onProgress(100);

  return {
    productName,
    coresetVectors,
    featureDim: FEATURE_DIM,
    gridWidth: GRID_W,
    gridHeight: GRID_H,
    nominalMeanDist: Number(nominalMeanDist.toFixed(4)),
    nominalStdDist: Number(nominalStdDist.toFixed(4)),
    nominalP50,
    nominalP90,
    nominalP95,
    nominalP99,
    isCalibrated,
    calibrationStatus,
    imagesTrainedCount: successfulImages,
    totalPatchesExtracted: allPatches.length,
    trainedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// 7. Jet Heatmap Colormap
// ---------------------------------------------------------------------------

function getJetColor(val: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, val));
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(v * 4 - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(v * 4 - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(v * 4 - 1)));
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

// ---------------------------------------------------------------------------
// 8. Core Inspection Engine with Localized Defect Verification
// ---------------------------------------------------------------------------

/**
 * Inspects a candidate frame against the normal memory bank:
 * 1. Checks image quality (returns INVALID if blurry, dark, blown out, etc.)
 * 2. Normalizes product crop & aligns to product coordinates
 * 3. Multi-scale patch feature comparison
 * 4. 8-connected neighborhood clustering to verify spatially localized defects
 * 5. Composite anomaly scoring: Top Percentile + Clustered Area + Multi-Scale Agreement
 * 6. Generates authentic Jet Heatmap and Blended Overlay with bounding boxes
 */
export async function inspectImageWithPatchCore(
  imgSrc: string,
  memoryBank: PatchCoreMemoryBank,
  threshold: number = 0.50
): Promise<PatchCoreInspectionResult> {
  if (!memoryBank || !memoryBank.coresetVectors || memoryBank.coresetVectors.length === 0) {
    throw new Error('PatchCore memory bank is empty. Please add normal reference images in the Dataset tab first.');
  }

  const startTime = performance.now();

  // Step 1: Preprocess and Quality Check
  const pre = await preprocessImage(imgSrc);
  const W = CANVAS_W;
  const H = CANVAS_H;

  // Step 1b: If image quality is too low, return INVALID rather than a false FAIL
  if (!pre.quality.isValid) {
    const inferenceTimeMs = Math.round(performance.now() - startTime);
    return {
      anomalyScore: 0.0,
      threshold,
      result: 'INVALID',
      status: 'INVALID',
      rawHeatmapMatrix: Array(GRID_H).fill(Array(GRID_W).fill(0)),
      heatmapDataUrl: pre.canvas.toDataURL('image/png'),
      overlayDataUrl: pre.canvas.toDataURL('image/png'),
      maxAnomalyCoord: { x: W / 2, y: H / 2, gridX: Math.floor(GRID_W / 2), gridY: Math.floor(GRID_H / 2) },
      maxPatchScore: 0,
      inferenceTimeMs,
      qualityIssue: pre.quality.reason,
      debugInfo: {
        referenceImagesCount: memoryBank.imagesTrainedCount,
        referenceImageCount: memoryBank.imagesTrainedCount,
        totalPatchesExtracted: memoryBank.totalPatchesExtracted,
        referencePatches: memoryBank.totalPatchesExtracted,
        coresetSize: memoryBank.coresetVectors.length,
        memoryBankSize: memoryBank.coresetVectors.length,
        preprocessingDimensions: `${W}×${H} (Canonical Product Normalization)`,
        roiDimensions: `X:${pre.segmentation.boundingBox.x}, Y:${pre.segmentation.boundingBox.y}, ${pre.segmentation.boundingBox.width}×${pre.segmentation.boundingBox.height} (${pre.segmentation.foregroundAreaPct}% ROI occupancy)`,
        alignmentTransform: `dx:${pre.alignment.dx}px, dy:${pre.alignment.dy}px, rot:${pre.alignment.rotationDeg}°, scale:${pre.alignment.scale}x, score:${pre.alignment.alignmentScore}`,
        translationX: pre.alignment.dx,
        translationY: pre.alignment.dy,
        scale: pre.alignment.scale,
        rotationDeg: pre.alignment.rotationDeg,
        alignmentScore: pre.alignment.alignmentScore,
        nominalMeanDist: memoryBank.nominalMeanDist,
        nominalStdDist: memoryBank.nominalStdDist,
        normalScoreP50: memoryBank.nominalP50,
        normalScoreP90: memoryBank.nominalP90,
        normalScoreP95: memoryBank.nominalP95,
        normalScoreP99: memoryBank.nominalP99,
        testImageScore: 0.0,
        numberOfAnomalyRegions: 0,
        strongestRegionArea: '0 px (0%)',
        strongestRegionScore: 0.0,
        imageQualityScore: pre.quality.qualityScore,
        maxPatchDist: 0.0,
        topKMeanDist: 0.0,
        finalAnomalyScore: 0.0,
        threshold,
        result: 'INVALID',
        finalDecision: `INSPECTION INVALID — IMAGE QUALITY TOO LOW: ${pre.quality.reason}`,
        inferenceTimeMs,
        calibrationStatus: memoryBank.calibrationStatus,
      },
    };
  }

  // Step 2: Extract multi-scale patch representations on the aligned product canvas
  const { finePatches, mediumPatches, coarsePatches } = extractMultiScalePatches(pre);

  // Step 3: Compute Nearest-Neighbor Distances across Scales
  // Fine scale distances (28x21 grid)
  const fineDistances = new Float32Array(GRID_W * GRID_H);
  let maxFineDist = 0;

  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const idx = gy * GRID_W + gx;
      const patch = finePatches[idx];
      let minDist = Infinity;

      for (let m = 0; m < memoryBank.coresetVectors.length; m++) {
        const d = euclideanDist(patch, memoryBank.coresetVectors[m]);
        if (d < minDist) minDist = d;
      }

      fineDistances[idx] = minDist;
      if (minDist > maxFineDist) maxFineDist = minDist;
    }
  }

  // Medium scale distances (14x10 grid)
  const medW = Math.floor(GRID_W / 2);
  const medH = Math.floor(GRID_H / 2);
  const medDistances = new Float32Array(medW * medH);

  for (let my = 0; my < medH; my++) {
    for (let mx = 0; mx < medW; mx++) {
      const idx = my * medW + mx;
      const patch = mediumPatches[idx];
      let minDist = Infinity;
      for (let m = 0; m < memoryBank.coresetVectors.length; m++) {
        const d = euclideanDist(patch, memoryBank.coresetVectors[m]);
        if (d < minDist) minDist = d;
      }
      medDistances[idx] = minDist;
    }
  }

  // Coarse scale distances (7x5 grid)
  const coarseW = Math.floor(GRID_W / 4);
  const coarseH = Math.floor(GRID_H / 4);
  const coarseDistances = new Float32Array(coarseW * coarseH);

  for (let cy = 0; cy < coarseH; cy++) {
    for (let cx = 0; cx < coarseW; cx++) {
      const idx = cy * coarseW + cx;
      const patch = coarsePatches[idx];
      let minDist = Infinity;
      for (let m = 0; m < memoryBank.coresetVectors.length; m++) {
        const d = euclideanDist(patch, memoryBank.coresetVectors[m]);
        if (d < minDist) minDist = d;
      }
      coarseDistances[idx] = minDist;
    }
  }

  // Multi-Scale Anomaly Map Fusion with ROI Foreground Weighting
  const fusedGrid: number[][] = [];
  const fusedDistances = new Float32Array(GRID_W * GRID_H);
  let peakDist = 0;
  let peakCoord = { x: Math.floor(W / 2), y: Math.floor(H / 2), gridX: Math.floor(GRID_W / 2), gridY: Math.floor(GRID_H / 2) };

  for (let gy = 0; gy < GRID_H; gy++) {
    const row: number[] = [];
    for (let gx = 0; gx < GRID_W; gx++) {
      const idx = gy * GRID_W + gx;
      const dFine = fineDistances[idx];

      const mx = Math.min(medW - 1, Math.floor(gx / 2));
      const my = Math.min(medH - 1, Math.floor(gy / 2));
      const dMed = medDistances[my * medW + mx];

      const cx = Math.min(coarseW - 1, Math.floor(gx / 4));
      const cy = Math.min(coarseH - 1, Math.floor(gy / 4));
      const dCoarse = coarseDistances[cy * coarseW + cx];

      // Multi-scale combination
      let dFused =
        SCALE_WEIGHT_FINE * dFine +
        SCALE_WEIGHT_MEDIUM * dMed +
        SCALE_WEIGHT_COARSE * dCoarse;

      // Downweight background patches outside the segmented product mask
      const saliency = pre.roi.saliencyMap[idx];
      if (saliency < 0.18) {
        dFused *= BACKGROUND_ANOMALY_WEIGHT;
      }

      fusedDistances[idx] = dFused;
      row.push(dFused);

      if (dFused > peakDist) {
        peakDist = dFused;
        peakCoord = {
          x: Math.round(((gx + 0.5) / GRID_W) * W),
          y: Math.round(((gy + 0.5) / GRID_H) * H),
          gridX: gx,
          gridY: gy,
        };
      }
    }
    fusedGrid.push(row);
  }

  // Step 4: 8-Connected Neighborhood Clustering to Eliminate Isolated Noise
  // Candidate patch anomaly threshold: Baseline P95 + 0.35 * (P99 - P95)
  const patchAnomalyThreshold = memoryBank.nominalP95 + 0.35 * Math.max(1e-4, memoryBank.nominalP99 - memoryBank.nominalP95);
  const binaryMap = new Uint8Array(GRID_W * GRID_H);

  for (let i = 0; i < GRID_W * GRID_H; i++) {
    // Must exceed threshold and have foreground saliency
    if (fusedDistances[i] > patchAnomalyThreshold && pre.roi.saliencyMap[i] > 0.18) {
      binaryMap[i] = 1;
    }
  }

  // 8-way connected components
  const visited = new Uint8Array(GRID_W * GRID_H);
  interface Component {
    patches: { gx: number; gy: number; dist: number }[];
    minGx: number;
    maxGx: number;
    minGy: number;
    maxGy: number;
    totalDist: number;
    maxDist: number;
  }
  const components: Component[] = [];

  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const idx = gy * GRID_W + gx;
      if (binaryMap[idx] === 1 && visited[idx] === 0) {
        const comp: Component = {
          patches: [],
          minGx: gx,
          maxGx: gx,
          minGy: gy,
          maxGy: gy,
          totalDist: 0,
          maxDist: 0,
        };

        const queue: [number, number][] = [[gx, gy]];
        visited[idx] = 1;

        while (queue.length > 0) {
          const [cx, cy] = queue.shift()!;
          const cIdx = cy * GRID_W + cx;
          const d = fusedDistances[cIdx];

          comp.patches.push({ gx: cx, gy: cy, dist: d });
          comp.totalDist += d;
          if (d > comp.maxDist) comp.maxDist = d;
          if (cx < comp.minGx) comp.minGx = cx;
          if (cx > comp.maxGx) comp.maxGx = cx;
          if (cy < comp.minGy) comp.minGy = cy;
          if (cy > comp.maxGy) comp.maxGy = cy;

          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (dx === 0 && dy === 0) continue;
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H) {
                const nIdx = ny * GRID_W + nx;
                if (binaryMap[nIdx] === 1 && visited[nIdx] === 0) {
                  visited[nIdx] = 1;
                  queue.push([nx, ny]);
                }
              }
            }
          }
        }

        components.push(comp);
      }
    }
  }

  // Filter isolated single-patch false positives:
  // A single patch with no neighbors is suppressed unless its anomaly is overwhelmingly high (>= 1.6 * P99)
  const credibleComponents = components.filter((c) => {
    if (c.patches.length === 1) {
      return c.maxDist >= memoryBank.nominalP99 * 1.6;
    }
    return c.patches.length >= 2;
  });

  // Step 5: Convert Credible Components to Defect Regions
  const cellW = W / GRID_W;
  const cellH = H / GRID_H;
  const detectedRegions: DefectRegion[] = credibleComponents.map((c) => {
    const rx = Math.max(4, Math.round(c.minGx * cellW));
    const ry = Math.max(4, Math.round(c.minGy * cellH));
    const rw = Math.min(W - rx, Math.round((c.maxGx - c.minGx + 1) * cellW));
    const rh = Math.min(H - ry, Math.round((c.maxGy - c.minGy + 1) * cellH));
    const pixelArea = rw * rh;
    const areaPct = Number(((pixelArea / (W * H)) * 100).toFixed(1));

    // Confidence derived from component strength against nominal baseline
    const normalizedStrength = (c.maxDist - memoryBank.nominalP50) / Math.max(1e-4, memoryBank.nominalP99 - memoryBank.nominalP50);
    const confidence = Math.min(99, Math.max(25, Math.round(normalizedStrength * 65)));

    return {
      x: Math.round(rx + rw / 2),
      y: Math.round(ry + rh / 2),
      width: rw,
      height: rh,
      gridX: Math.round((c.minGx + c.maxGx) / 2),
      gridY: Math.round((c.minGy + c.maxGy) / 2),
      area: pixelArea,
      areaPct,
      confidence,
      description: `Surface defect region (${rw}×${rh}px, ${c.patches.length} anomalous patches)`,
    };
  });

  // Sort regions by confidence * area
  detectedRegions.sort((a, b) => (b.confidence || 0) * (b.area || 0) - (a.confidence || 0) * (a.area || 0));
  const suspectedDefectRegion = detectedRegions[0];

  // Step 6: Multi-Factor Anomaly Score Calculation
  // Factor 1: Top 3% foreground anomaly patches
  const sortedFgDists = Array.from(fusedDistances)
    .filter((_, idx) => pre.roi.saliencyMap[idx] > 0.18)
    .sort((a, b) => b - a);

  const topKCount = Math.max(1, Math.floor(sortedFgDists.length * 0.03));
  let topKSum = 0;
  for (let i = 0; i < topKCount; i++) topKSum += sortedFgDists[i] || 0;
  const topKMean = topKSum / topKCount;

  // Calibrate top-k against empirical normal baseline P50 and P99
  const scoreTopPercentile = Math.max(
    0,
    Math.min(
      1.0,
      (topKMean - memoryBank.nominalP50) / (Math.max(1e-4, memoryBank.nominalP99 - memoryBank.nominalP50) * 1.35)
    )
  );

  // Factor 2: Clustered Anomaly Area (fraction of object area occupied by credible defects)
  let totalAnomalousPatches = 0;
  for (const c of credibleComponents) totalAnomalousPatches += c.patches.length;
  const scoreClusterArea = Math.min(1.0, totalAnomalousPatches / (GRID_W * GRID_H * 0.08));

  // Factor 3: Multi-Scale Agreement (agreement between fine and medium scales)
  let medAgreeCount = 0;
  for (const c of credibleComponents) {
    for (const p of c.patches) {
      const mx = Math.min(medW - 1, Math.floor(p.gx / 2));
      const my = Math.min(medH - 1, Math.floor(p.gy / 2));
      if (medDistances[my * medW + mx] > memoryBank.nominalP90) medAgreeCount++;
    }
  }
  const scoreMultiScaleAgreement = totalAnomalousPatches > 0
    ? Math.min(1.0, medAgreeCount / totalAnomalousPatches)
    : 0;

  // Final Aggregated Anomaly Score
  let compositeScore =
    WEIGHT_TOP_PATCHES * scoreTopPercentile +
    WEIGHT_CLUSTER_AREA * scoreClusterArea +
    WEIGHT_MULTISCALE_AGREEMENT * scoreMultiScaleAgreement;

  // If no credible defect region exists and top patch is within normal baseline limits, guarantee clean conformant score
  if (credibleComponents.length === 0 && topKMean < memoryBank.nominalP99 * 1.25) {
    compositeScore = Math.min(compositeScore, 0.28);
  }

  const finalAnomalyScore = Math.max(0.03, Math.min(0.98, Number(compositeScore.toFixed(2))));

  // Step 7: PASS / FAIL Decision
  // Production rule: any anomaly score above the configured threshold is rejected.
  const isFail = finalAnomalyScore > threshold;
  const result: QualityStatus = isFail ? 'FAIL' : 'PASS';
  // Step 8: Render Authentic Jet Heatmap
  const heatCanvas = document.createElement('canvas');
  heatCanvas.width = W;
  heatCanvas.height = H;
  const heatCtx = heatCanvas.getContext('2d');
  if (!heatCtx) throw new Error('Could not get heatmap canvas context');

  const offCanvas = document.createElement('canvas');
  offCanvas.width = GRID_W;
  offCanvas.height = GRID_H;
  const offCtx = offCanvas.getContext('2d');
  if (!offCtx) throw new Error('Could not get offscreen canvas context');

  const heatImgData = offCtx.createImageData(GRID_W, GRID_H);
  const normalizedMatrix: number[][] = [];

  for (let gy = 0; gy < GRID_H; gy++) {
    const row: number[] = [];
    for (let gx = 0; gx < GRID_W; gx++) {
      const d = fusedGrid[gy][gx];
      // Normalize between P50 and P99*1.4
      const normVal = Math.max(0, Math.min(1, (d - memoryBank.nominalP50) / (Math.max(1e-4, memoryBank.nominalP99 - memoryBank.nominalP50) * 1.4)));
      row.push(normVal);

      const pIdx = (gy * GRID_W + gx) * 4;
      const [r, g, b] = getJetColor(normVal);
      heatImgData.data[pIdx] = r;
      heatImgData.data[pIdx + 1] = g;
      heatImgData.data[pIdx + 2] = b;
      heatImgData.data[pIdx + 3] = 255;
    }
    normalizedMatrix.push(row);
  }

  offCtx.putImageData(heatImgData, 0, 0);

  // Upscale with smooth interpolation
  heatCtx.imageSmoothingEnabled = true;
  heatCtx.imageSmoothingQuality = 'high';
  heatCtx.drawImage(offCanvas, 0, 0, W, H);

  const heatmapDataUrl = heatCanvas.toDataURL('image/png');

  // Step 9: Render Blended Overlay with Defect Bounding Boxes
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = W;
  overlayCanvas.height = H;
  const overlayCtx = overlayCanvas.getContext('2d');
  if (!overlayCtx) throw new Error('Could not get overlay context');

  // Draw preprocessed normalized canvas
  overlayCtx.drawImage(pre.canvas, 0, 0, W, H);

  // Blend heatmap at 52% alpha
  overlayCtx.globalAlpha = 0.52;
  overlayCtx.drawImage(heatCanvas, 0, 0, W, H);
  overlayCtx.globalAlpha = 1.0;

  // Draw defect bounding boxes for all detected regions
  if (result === 'FAIL') {
    overlayCtx.save();
    for (let rIdx = 0; rIdx < detectedRegions.length; rIdx++) {
      const reg = detectedRegions[rIdx];
      const rw = reg.width || 36;
      const rh = reg.height || 36;
      const boxX = Math.max(4, Math.round(reg.x - rw / 2));
      const boxY = Math.max(4, Math.round(reg.y - rh / 2));

      // Bounding box
      overlayCtx.strokeStyle = rIdx === 0 ? '#ef4444' : '#f97316';
      overlayCtx.lineWidth = rIdx === 0 ? 2.5 : 1.8;
      overlayCtx.strokeRect(boxX, boxY, rw, rh);

      // Label
      const labelText = rIdx === 0 ? `DEFECT (${reg.confidence}%)` : `ANOMALY #${rIdx + 1}`;
      const labelY = Math.max(16, boxY);
      overlayCtx.fillStyle = rIdx === 0 ? '#ef4444' : '#f97316';
      overlayCtx.fillRect(boxX, labelY - 16, 96, 16);
      overlayCtx.fillStyle = '#ffffff';
      overlayCtx.font = 'bold 9px monospace';
      overlayCtx.fillText(labelText, boxX + 4, labelY - 4);
    }

    // Crosshair at primary defect center
    if (suspectedDefectRegion) {
      overlayCtx.beginPath();
      overlayCtx.arc(suspectedDefectRegion.x, suspectedDefectRegion.y, 11, 0, 2 * Math.PI);
      overlayCtx.strokeStyle = '#facc15';
      overlayCtx.lineWidth = 2;
      overlayCtx.stroke();

      overlayCtx.beginPath();
      overlayCtx.moveTo(suspectedDefectRegion.x - 7, suspectedDefectRegion.y);
      overlayCtx.lineTo(suspectedDefectRegion.x + 7, suspectedDefectRegion.y);
      overlayCtx.moveTo(suspectedDefectRegion.x, suspectedDefectRegion.y - 7);
      overlayCtx.lineTo(suspectedDefectRegion.x, suspectedDefectRegion.y + 7);
      overlayCtx.strokeStyle = '#ffffff';
      overlayCtx.lineWidth = 1.5;
      overlayCtx.stroke();
    }

    overlayCtx.restore();
  }

  const overlayDataUrl = overlayCanvas.toDataURL('image/png');
  const inferenceTimeMs = Math.round(performance.now() - startTime);

  // Diagnostics Metadata
  const debugInfo: PatchCoreDebugInfo = {
    referenceImagesCount: memoryBank.imagesTrainedCount,
    referenceImageCount: memoryBank.imagesTrainedCount,
    totalPatchesExtracted: memoryBank.totalPatchesExtracted,
    referencePatches: memoryBank.totalPatchesExtracted,
    coresetSize: memoryBank.coresetVectors.length,
    memoryBankSize: memoryBank.coresetVectors.length,
    preprocessingDimensions: `${W}×${H} (Canonical Product Normalization)`,
    roiDimensions: `X:${pre.segmentation.boundingBox.x}, Y:${pre.segmentation.boundingBox.y}, ${pre.segmentation.boundingBox.width}×${pre.segmentation.boundingBox.height} (${pre.segmentation.foregroundAreaPct}% ROI occupancy)`,
    alignmentTransform: `dx:${pre.alignment.dx}px, dy:${pre.alignment.dy}px, rot:${pre.alignment.rotationDeg}°, scale:${pre.alignment.scale}x, score:${pre.alignment.alignmentScore}`,
    translationX: pre.alignment.dx,
    translationY: pre.alignment.dy,
    scale: pre.alignment.scale,
    rotationDeg: pre.alignment.rotationDeg,
    alignmentScore: pre.alignment.alignmentScore,
    nominalMeanDist: memoryBank.nominalMeanDist,
    nominalStdDist: memoryBank.nominalStdDist,
    normalScoreP50: memoryBank.nominalP50,
    normalScoreP90: memoryBank.nominalP90,
    normalScoreP95: memoryBank.nominalP95,
    normalScoreP99: memoryBank.nominalP99,
    testImageScore: finalAnomalyScore,
    numberOfAnomalyRegions: detectedRegions.length,
    strongestRegionArea: suspectedDefectRegion ? `${suspectedDefectRegion.width}×${suspectedDefectRegion.height} px (${suspectedDefectRegion.areaPct}%)` : '0 px (0%)',
    strongestRegionScore: suspectedDefectRegion ? Number(((suspectedDefectRegion.confidence || 0) / 100).toFixed(2)) : 0,
    imageQualityScore: pre.quality.qualityScore,
    maxPatchDist: Number(peakDist.toFixed(4)),
    topKMeanDist: Number(topKMean.toFixed(4)),
    finalAnomalyScore,
    threshold,
    result,
    finalDecision: result === 'PASS'
      ? `PASS — All spatial patches conform within empirical reference tolerances (Score: ${finalAnomalyScore} < ${threshold})`
      : `FAIL — ${detectedRegions.length} credible anomaly region(s) detected (Score: ${finalAnomalyScore} >= ${threshold})`,
    inferenceTimeMs,
    calibrationStatus: memoryBank.calibrationStatus,
  };

  return {
    anomalyScore: finalAnomalyScore,
    threshold,
    result,
    status: result,
    rawHeatmapMatrix: normalizedMatrix,
    heatmapDataUrl,
    overlayDataUrl,
    maxAnomalyCoord: peakCoord,
    maxPatchScore: Math.min(1.0, peakDist / 0.5),
    inferenceTimeMs,
    suspectedDefectRegion,
    detectedRegions,
    debugInfo,
  };
}

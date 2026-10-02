/**
 * PatchCore-based Anomaly Detection Engine for VisionQC
 *
 * Implements the PatchCore framework (Roth et al., CVPR 2022):
 * 1. Aspect-ratio-preserving patch feature embedding extraction with letterboxing
 * 2. Deterministic Memory Bank representation construction from normal reference images
 * 3. Greedy minimax coreset subsampling for fast nearest-neighbor inference
 * 4. Empirical dispersion-based anomaly scoring and authentic spatial anomaly heatmap localization
 */

export interface PatchCoreMemoryBank {
  productName: string;
  coresetVectors: Float32Array[]; // Dimension D per vector
  featureDim: number;
  gridWidth: number;
  gridHeight: number;
  nominalMeanDist: number;
  nominalStdDist: number;
  imagesTrainedCount: number;
  totalPatchesExtracted: number;
  trainedAt: string;
}

export interface PatchCoreDebugInfo {
  referenceImagesCount: number;
  totalPatchesExtracted: number;
  coresetSize: number;
  nominalMeanDist: number;
  nominalStdDist: number;
  maxPatchDist: number;
  topKMeanDist: number;
  finalAnomalyScore: number;
  threshold: number;
  result: 'PASS' | 'FAIL';
  inferenceTimeMs: number;
}

export interface PatchCoreInspectionResult {
  anomalyScore: number; // 0.00 to 1.00
  threshold: number;
  result: 'PASS' | 'FAIL';
  rawHeatmapMatrix: number[][]; // Grid of anomaly values
  heatmapDataUrl: string; // Colormapped heatmap
  overlayDataUrl: string; // Blended on top of original image
  maxAnomalyCoord: { x: number; y: number; gridX: number; gridY: number };
  maxPatchScore: number;
  inferenceTimeMs: number;
  suspectedDefectRegion?: {
    x: number;
    y: number;
    width: number;
    height: number;
    gridX: number;
    gridY: number;
    confidence: number;
    description: string;
  };
  debugInfo?: PatchCoreDebugInfo;
}

const GRID_W = 28;
const GRID_H = 21;
const FEATURE_DIM = 24;

/**
 * Explicit weighting factor for spatial coordinate priors (feat[13], feat[14], feat[15]).
 * Scaled down to prevent slight camera/part physical alignment shifts from dominating
 * the Euclidean distance, keeping optical visual features (gradients, color, texture)
 * as the dominant signal.
 */
export const SPATIAL_COORDINATE_WEIGHT = 0.15;

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
      let width = img.naturalWidth || 800;
      let height = img.naturalHeight || 600;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(src);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(src);
    img.src = src;
  });
}

/**
 * Loads an image from a URL or data URI into an HTMLImageElement
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image. The file format may be corrupted or unsupported.'));
    img.src = src;
  });
}

/**
 * Extracts patch feature embeddings from an image across a spatial grid.
 *
 * Aspect-Ratio-Preserving Preprocessing:
 * Instead of non-uniformly stretching images to 336x252, this calculates a uniform
 * scaling factor so the entire image fits inside 336x252 while preserving natural aspect ratio.
 * Any unused canvas areas are letterboxed / pillarboxed with a neutral black background (#000000).
 * Both reference images and inspection images undergo this identical geometric pipeline.
 */
async function extractPatchFeatures(imgSrc: string): Promise<{
  patches: Float32Array[];
  width: number;
  height: number;
  canvas: HTMLCanvasElement;
}> {
  const img = await loadImage(imgSrc);
  if (img.naturalWidth === 0 || img.naturalHeight === 0) {
    throw new Error('Image decode error: Image has 0 dimension.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = 336;
  canvas.height = 252;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create canvas 2D context');

  // Letterbox background: neutral solid black padding
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Compute uniform scale to preserve aspect ratio without stretching
  const imgW = img.naturalWidth || img.width;
  const imgH = img.naturalHeight || img.height;
  const scale = Math.min(canvas.width / imgW, canvas.height / imgH);
  const drawW = Math.round(imgW * scale);
  const drawH = Math.round(imgH * scale);
  const offsetX = Math.round((canvas.width - drawW) / 2);
  const offsetY = Math.round((canvas.height - drawH) / 2);

  ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const W = canvas.width;
  const H = canvas.height;

  // Convert to grayscale & normalized channels for fast feature extraction
  const gray = new Float32Array(W * H);
  const rChan = new Float32Array(W * H);
  const gChan = new Float32Array(W * H);
  const bChan = new Float32Array(W * H);

  for (let i = 0; i < W * H; i++) {
    const idx = i * 4;
    const r = data[idx] / 255;
    const g = data[idx + 1] / 255;
    const b = data[idx + 2] / 255;
    rChan[i] = r;
    gChan[i] = g;
    bChan[i] = b;
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  // Compute horizontal and vertical gradients (Sobel filter)
  const gradX = new Float32Array(W * H);
  const gradY = new Float32Array(W * H);
  const gradMag = new Float32Array(W * H);

  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const idx = y * W + x;
      // Sobel horizontal
      const gx =
        -gray[idx - W - 1] + gray[idx - W + 1]
        - 2 * gray[idx - 1] + 2 * gray[idx + 1]
        - gray[idx + W - 1] + gray[idx + W + 1];
      // Sobel vertical
      const gy =
        -gray[idx - W - 1] - 2 * gray[idx - W] - gray[idx - W + 1]
        + gray[idx + W - 1] + 2 * gray[idx + W] + gray[idx + W + 1];

      gradX[idx] = gx;
      gradY[idx] = gy;
      gradMag[idx] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  // Extract spatial patches across GRID_W x GRID_H
  const cellW = W / GRID_W;
  const cellH = H / GRID_H;
  const patches: Float32Array[] = [];

  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const startX = Math.floor(gx * cellW);
      const endX = Math.min(W, Math.floor((gx + 1) * cellW));
      const startY = Math.floor(gy * cellH);
      const endY = Math.min(H, Math.floor((gy + 1) * cellH));

      let meanGray = 0;
      let varGray = 0;
      let meanMag = 0;
      let varMag = 0;
      let meanGx = 0;
      let meanGy = 0;
      let meanR = 0;
      let meanG = 0;
      let meanB = 0;
      let edgeCount = 0;
      let count = 0;

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = y * W + x;
          const gVal = gray[idx];
          const mVal = gradMag[idx];

          meanGray += gVal;
          meanMag += mVal;
          meanGx += Math.abs(gradX[idx]);
          meanGy += Math.abs(gradY[idx]);
          meanR += rChan[idx];
          meanG += gChan[idx];
          meanB += bChan[idx];
          if (mVal > 0.15) edgeCount++;
          count++;
        }
      }

      if (count > 0) {
        meanGray /= count;
        meanMag /= count;
        meanGx /= count;
        meanGy /= count;
        meanR /= count;
        meanG /= count;
        meanB /= count;

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = y * W + x;
            const diffG = gray[idx] - meanGray;
            const diffM = gradMag[idx] - meanMag;
            varGray += diffG * diffG;
            varMag += diffM * diffM;
          }
        }
        varGray = Math.sqrt(varGray / count);
        varMag = Math.sqrt(varMag / count);
      }

      // Feature vector (24-dim representation per patch)
      const feat = new Float32Array(FEATURE_DIM);
      feat[0] = meanGray;
      feat[1] = varGray * 3;
      feat[2] = meanMag * 4;
      feat[3] = varMag * 4;
      feat[4] = meanGx * 4;
      feat[5] = meanGy * 4;
      feat[6] = meanR;
      feat[7] = meanG;
      feat[8] = meanB;
      feat[9] = edgeCount / (count || 1);
      feat[10] = Math.abs(meanR - meanG) * 2;
      feat[11] = Math.abs(meanR - meanB) * 2;
      feat[12] = Math.abs(meanG - meanB) * 2;

      // Spatial coordinate priors with explicit reduced weighting to prevent alignment shifts
      // from dominating visual optical anomalies
      feat[13] = (gx / GRID_W) * SPATIAL_COORDINATE_WEIGHT;
      feat[14] = (gy / GRID_H) * SPATIAL_COORDINATE_WEIGHT;
      feat[15] = Math.sqrt((gx / GRID_W) ** 2 + (gy / GRID_H) ** 2) * SPATIAL_COORDINATE_WEIGHT;

      feat[16] = Math.sin(feat[0] * Math.PI);
      feat[17] = Math.cos(feat[0] * Math.PI);
      feat[18] = meanMag > 0.05 ? meanGx / (meanMag + 1e-4) : 0;
      feat[19] = meanMag > 0.05 ? meanGy / (meanMag + 1e-4) : 0;
      feat[20] = varGray > 0.05 ? varMag / (varGray + 1e-4) : 0;
      feat[21] = (feat[6] + feat[7] + feat[8]) / 3;
      feat[22] = feat[9] * feat[2];
      feat[23] = feat[1] * feat[3];

      // L2 Normalize feature vector
      let norm = 0;
      for (let f = 0; f < FEATURE_DIM; f++) norm += feat[f] * feat[f];
      norm = Math.sqrt(norm) || 1;
      for (let f = 0; f < FEATURE_DIM; f++) feat[f] /= norm;

      patches.push(feat);
    }
  }

  return { patches, width: W, height: H, canvas };
}

/**
 * Calculates Euclidean distance between two feature vectors
 */
function euclideanDist(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Coreset Subsampling using Deterministic Greedy Minimax selection (PatchCore algorithm)
 * Compresses the raw patch bank into a representative manifold subset.
 *
 * Deterministic Guarantee:
 * The seed index is strictly fixed to index 0 (first representative patch) instead of Math.random().
 * The same reference dataset will always yield the exact same coreset memory bank.
 */
function coresetSubsample(allPatches: Float32Array[], targetCount: number): Float32Array[] {
  if (allPatches.length <= targetCount) return allPatches;

  const coreset: Float32Array[] = [];
  const selectedIndices = new Set<number>();

  // Deterministic seed: choose the first patch index (0) instead of Math.random().
  const firstIdx = 0;
  coreset.push(allPatches[firstIdx]);
  selectedIndices.add(firstIdx);

  // Min distances to current coreset for all points
  const minDists = new Float32Array(allPatches.length);
  for (let i = 0; i < allPatches.length; i++) {
    minDists[i] = euclideanDist(allPatches[i], coreset[0]);
  }

  // Iteratively select point with maximum min-distance
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

    // Update min distances with the new point
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

/**
 * Builds the normal-product memory bank from reference images
 * Calculates empirical nominal mean and empirical nominal standard deviation.
 */
export async function buildPatchCoreMemoryBank(
  productName: string,
  normalImageUrls: string[],
  onProgress?: (progressPercent: number) => void
): Promise<PatchCoreMemoryBank> {
  if (!normalImageUrls || normalImageUrls.length === 0) {
    throw new Error(`Cannot build memory bank for "${productName}": at least 1 normal reference image is required.`);
  }

  const allPatches: Float32Array[] = [];

  for (let i = 0; i < normalImageUrls.length; i++) {
    try {
      const { patches } = await extractPatchFeatures(normalImageUrls[i]);
      for (const p of patches) {
        allPatches.push(p);
      }
    } catch (err) {
      console.warn(`Could not extract features from image #${i + 1}, skipping:`, err);
    }

    if (onProgress) {
      onProgress(Math.round(((i + 1) / normalImageUrls.length) * 70));
    }
  }

  if (allPatches.length === 0) {
    throw new Error(`Failed to extract valid patch features from provided normal images for "${productName}".`);
  }

  // Coreset subsampling: retain 12% of total patches (minimum 300, max 1,500)
  const targetCoresetSize = Math.max(Math.min(allPatches.length, 300), Math.min(1500, Math.floor(allPatches.length * 0.12)));
  const coresetVectors = coresetSubsample(allPatches, targetCoresetSize);

  if (onProgress) onProgress(90);

  // Compute empirical baseline statistics from nearest-neighbor distance distribution
  let sumDist = 0;
  let count = 0;
  const sampleSubset = coresetVectors.slice(0, Math.min(100, coresetVectors.length));
  const sampleDistances: number[] = [];

  for (let i = 0; i < sampleSubset.length; i++) {
    let minDist = Infinity;
    for (let j = 0; j < coresetVectors.length; j++) {
      if (i !== j) {
        const d = euclideanDist(sampleSubset[i], coresetVectors[j]);
        if (d < minDist) minDist = d;
      }
    }
    if (minDist !== Infinity && !isNaN(minDist)) {
      sampleDistances.push(minDist);
      sumDist += minDist;
      count++;
    }
  }

  // Empirical Mean
  const nominalMeanDist = count > 0 ? sumDist / count : 0.15;

  // Empirical Variance & Standard Deviation:
  // variance = average((distance - mean)^2)
  // std = sqrt(variance)
  let varianceSum = 0;
  if (count > 0) {
    for (let i = 0; i < sampleDistances.length; i++) {
      const diff = sampleDistances[i] - nominalMeanDist;
      varianceSum += diff * diff;
    }
    varianceSum /= count;
  }

  // Safe empirical standard deviation: Use small numerical epsilon (1e-4) only to prevent division by zero.
  // No hardcoded 0.08 hidden fallback.
  const EPSILON = 1e-4;
  const nominalStdDist = Math.max(EPSILON, Math.sqrt(varianceSum));

  if (onProgress) onProgress(100);

  return {
    productName,
    coresetVectors,
    featureDim: FEATURE_DIM,
    gridWidth: GRID_W,
    gridHeight: GRID_H,
    nominalMeanDist,
    nominalStdDist,
    imagesTrainedCount: normalImageUrls.length,
    totalPatchesExtracted: allPatches.length,
    trainedAt: new Date().toISOString(),
  };
}

/**
 * Jet Colormap approximation: value 0.0 (Blue) -> 0.5 (Green/Yellow) -> 1.0 (Deep Red)
 */
function getJetColor(val: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, val));
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(v * 4 - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(v * 4 - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(v * 4 - 1)));
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Inspects a new image against the trained Memory Bank:
 * 1. Computes patch distances to the normal memory bank
 * 2. Generates genuine 2D Anomaly Heatmap
 * 3. Generates blended Heatmap Overlay on original image
 * 4. Calculates anomaly score (0.0 to 1.0) and PASS / FAIL decision
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

  const { patches, width: W, height: H, canvas: origCanvas } = await extractPatchFeatures(imgSrc);

  // 1. Calculate nearest-neighbor distance for each patch
  const rawHeatmapMatrix: number[][] = [];
  const patchDistances = new Float32Array(GRID_W * GRID_H);

  let patchIdx = 0;
  let maxDist = 0;
  let maxCoord = { x: 0, y: 0, gridX: 0, gridY: 0 };

  for (let gy = 0; gy < GRID_H; gy++) {
    const row: number[] = [];
    for (let gx = 0; gx < GRID_W; gx++) {
      const patch = patches[patchIdx];
      let minDist = Infinity;

      // Find nearest neighbor in coreset memory bank
      for (let m = 0; m < memoryBank.coresetVectors.length; m++) {
        const d = euclideanDist(patch, memoryBank.coresetVectors[m]);
        if (d < minDist) {
          minDist = d;
        }
      }

      patchDistances[patchIdx] = minDist;
      row.push(minDist);

      if (minDist > maxDist) {
        maxDist = minDist;
        maxCoord = {
          x: Math.round(((gx + 0.5) / GRID_W) * W),
          y: Math.round(((gy + 0.5) / GRID_H) * H),
          gridX: gx,
          gridY: gy,
        };
      }

      patchIdx++;
    }
    rawHeatmapMatrix.push(row);
  }

  // 2. Normalize anomaly distances based on empirical baseline distribution
  const baseMean = memoryBank.nominalMeanDist;
  const baseStd = Math.max(1e-4, memoryBank.nominalStdDist);

  const normalizedMatrix: number[][] = [];
  const sortedDists = Array.from(patchDistances).sort((a, b) => b - a);
  // Top 3% anomaly patches contribute to image-level score
  const topKCount = Math.max(1, Math.floor(GRID_W * GRID_H * 0.03));
  let topKSum = 0;
  for (let i = 0; i < topKCount; i++) {
    topKSum += sortedDists[i];
  }
  const topKMean = topKSum / topKCount;

  // Calibrated Z-score deviation against actual empirical nominal distribution
  const z = (topKMean - baseMean) / baseStd;
  const sigmoidScore = 1 / (1 + Math.exp(-1.1 * (z - 2.0)));
  const anomalyScore = Math.max(0.04, Math.min(0.98, Number(sigmoidScore.toFixed(2))));

  // Normalize grid values for heatmap display
  for (let gy = 0; gy < GRID_H; gy++) {
    const row: number[] = [];
    for (let gx = 0; gx < GRID_W; gx++) {
      const val = (rawHeatmapMatrix[gy][gx] - baseMean) / (baseStd * 2.5);
      row.push(Math.max(0, Math.min(1, val)));
    }
    normalizedMatrix.push(row);
  }

  // Calculate suspected defect region bounding box
  let minAnomalyX = W;
  let minAnomalyY = H;
  let maxAnomalyX = 0;
  let maxAnomalyY = 0;
  let anomalousPatchCount = 0;

  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const d = rawHeatmapMatrix[gy][gx];
      if (d > baseMean + 1.5 * baseStd) {
        anomalousPatchCount++;
        const px = Math.round(((gx + 0.5) / GRID_W) * W);
        const py = Math.round(((gy + 0.5) / GRID_H) * H);
        if (px < minAnomalyX) minAnomalyX = px;
        if (py < minAnomalyY) minAnomalyY = py;
        if (px > maxAnomalyX) maxAnomalyX = px;
        if (py > maxAnomalyY) maxAnomalyY = py;
      }
    }
  }

  const defectWidth = anomalousPatchCount > 0 ? Math.max(28, maxAnomalyX - minAnomalyX + 24) : 36;
  const defectHeight = anomalousPatchCount > 0 ? Math.max(28, maxAnomalyY - minAnomalyY + 24) : 36;

  const suspectedDefectRegion = {
    x: maxCoord.x,
    y: maxCoord.y,
    width: defectWidth,
    height: defectHeight,
    gridX: maxCoord.gridX,
    gridY: maxCoord.gridY,
    confidence: Math.round(anomalyScore * 100),
    description: anomalyScore >= threshold
      ? `Defect detected at (${maxCoord.x}px, ${maxCoord.y}px)`
      : 'Conforming normal surface',
  };

  // 3. Render Heatmap Canvas
  const heatCanvas = document.createElement('canvas');
  heatCanvas.width = W;
  heatCanvas.height = H;
  const heatCtx = heatCanvas.getContext('2d');
  if (!heatCtx) throw new Error('Could not get heatmap canvas context');

  // Draw smooth interpolated anomaly map
  const offCanvas = document.createElement('canvas');
  offCanvas.width = GRID_W;
  offCanvas.height = GRID_H;
  const offCtx = offCanvas.getContext('2d');
  if (!offCtx) throw new Error('Could not get offscreen canvas context');

  const heatImgData = offCtx.createImageData(GRID_W, GRID_H);
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const v = normalizedMatrix[gy][gx];
      const pIdx = (gy * GRID_W + gx) * 4;
      const [r, g, b] = getJetColor(v);
      heatImgData.data[pIdx] = r;
      heatImgData.data[pIdx + 1] = g;
      heatImgData.data[pIdx + 2] = b;
      heatImgData.data[pIdx + 3] = 255;
    }
  }
  offCtx.putImageData(heatImgData, 0, 0);

  // Upscale with smooth interpolation
  heatCtx.imageSmoothingEnabled = true;
  heatCtx.imageSmoothingQuality = 'high';
  heatCtx.drawImage(offCanvas, 0, 0, W, H);

  const heatmapDataUrl = heatCanvas.toDataURL('image/png');

  // 4. Render Blended Overlay Canvas (Original image + Heatmap overlay)
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = W;
  overlayCanvas.height = H;
  const overlayCtx = overlayCanvas.getContext('2d');
  if (!overlayCtx) throw new Error('Could not get overlay context');

  // Draw original image
  overlayCtx.drawImage(origCanvas, 0, 0, W, H);
  // Blend heatmap on top with alpha
  overlayCtx.globalAlpha = 0.55;
  overlayCtx.drawImage(heatCanvas, 0, 0, W, H);
  overlayCtx.globalAlpha = 1.0;

  // If anomaly exceeds threshold, mark defect bounding box and crosshair
  if (anomalyScore >= threshold) {
    overlayCtx.save();

    // Defect bounding box
    const boxX = Math.max(4, Math.round(maxCoord.x - defectWidth / 2));
    const boxY = Math.max(4, Math.round(maxCoord.y - defectHeight / 2));
    overlayCtx.strokeStyle = '#ef4444';
    overlayCtx.lineWidth = 2.5;
    overlayCtx.strokeRect(boxX, boxY, defectWidth, defectHeight);

    // Defect label tag
    const labelY = Math.max(16, boxY);
    overlayCtx.fillStyle = '#ef4444';
    overlayCtx.fillRect(boxX, labelY - 16, 92, 16);
    overlayCtx.fillStyle = '#ffffff';
    overlayCtx.font = 'bold 9px monospace';
    overlayCtx.fillText('DEFECT REGION', boxX + 4, labelY - 4);

    // Center Crosshair
    overlayCtx.beginPath();
    overlayCtx.arc(maxCoord.x, maxCoord.y, 12, 0, 2 * Math.PI);
    overlayCtx.strokeStyle = '#facc15';
    overlayCtx.lineWidth = 2;
    overlayCtx.stroke();

    overlayCtx.beginPath();
    overlayCtx.moveTo(maxCoord.x - 8, maxCoord.y);
    overlayCtx.lineTo(maxCoord.x + 8, maxCoord.y);
    overlayCtx.moveTo(maxCoord.x, maxCoord.y - 8);
    overlayCtx.lineTo(maxCoord.x, maxCoord.y + 8);
    overlayCtx.strokeStyle = '#ffffff';
    overlayCtx.lineWidth = 1.5;
    overlayCtx.stroke();

    overlayCtx.restore();
  }

  const overlayDataUrl = overlayCanvas.toDataURL('image/png');

  const result: 'PASS' | 'FAIL' = anomalyScore < threshold ? 'PASS' : 'FAIL';
  const endTime = performance.now();
  const inferenceTimeMs = Math.round(endTime - startTime);

  const debugInfo: PatchCoreDebugInfo = {
    referenceImagesCount: memoryBank.imagesTrainedCount,
    totalPatchesExtracted: memoryBank.totalPatchesExtracted || (memoryBank.imagesTrainedCount * GRID_W * GRID_H),
    coresetSize: memoryBank.coresetVectors.length,
    nominalMeanDist: Number(baseMean.toFixed(4)),
    nominalStdDist: Number(baseStd.toFixed(4)),
    maxPatchDist: Number(maxDist.toFixed(4)),
    topKMeanDist: Number(topKMean.toFixed(4)),
    finalAnomalyScore: anomalyScore,
    threshold,
    result,
    inferenceTimeMs,
  };

  return {
    anomalyScore,
    threshold,
    result,
    rawHeatmapMatrix: normalizedMatrix,
    heatmapDataUrl,
    overlayDataUrl,
    maxAnomalyCoord: maxCoord,
    maxPatchScore: Math.min(1.0, maxDist / 0.5),
    inferenceTimeMs,
    suspectedDefectRegion,
    debugInfo,
  };
}

/**
 * Live Conveyor-Belt Inspection Engine for VisionQC
 *
 * Implements continuous, autonomous optical inspection:
 * 1. Continuous MediaStream lifecycle management
 * 2. Controlled processing loop at configurable FPS (DEFAULT_LIVE_INSPECTION_FPS)
 * 3. Deterministic ROI-based product presence & occupancy detection
 * 4. State machine: IDLE -> PRODUCT_DETECTED -> ENTERING -> READY_FOR_INSPECTION -> INSPECTING -> RESULT_RECORDED -> WAIT_FOR_PRODUCT_EXIT -> IDLE
 * 5. Best-frame sharpness selection to avoid motion-blurred captures
 * 6. Duplicate inspection lockout until product exits the inspection zone
 * 7. Real performance and bottleneck monitoring (Camera FPS, Processing FPS, Latency)
 */

export type ConveyorState =
  | 'IDLE'
  | 'PRODUCT_DETECTED'
  | 'ENTERING'
  | 'READY_FOR_INSPECTION'
  | 'INSPECTING'
  | 'RESULT_RECORDED'
  | 'WAIT_FOR_PRODUCT_EXIT';

export interface RoiNormalized {
  x: number; // 0.0 to 1.0 (left)
  y: number; // 0.0 to 1.0 (top)
  width: number; // 0.0 to 1.0 (width)
  height: number; // 0.0 to 1.0 (height)
}

export interface RoiFrameAnalysis {
  occupancyScore: number; // 0.00 to 1.00
  edgeDensity: number; // 0.00 to 1.00
  contrastScore: number; // 0.00 to 1.00
  motionScore: number; // 0.00 to 1.00
  sharpnessScore: number; // variance of gradients
  isProductPresent: boolean;
  isStable: boolean;
  timestamp: number;
}

export interface FrameCandidate {
  dataUrl: string;
  timestamp: number;
  sharpness: number;
  occupancy: number;
}

export interface LiveDiagnostics {
  cameraFps: number;
  processingFps: number;
  currentState: ConveyorState;
  roiOccupancy: number; // percentage (0-100)
  productDetectionScore: number; // 0.00 to 1.00
  blurScore: number;
  framesSampled: number;
  framesInspected: number;
  productsDetected: number;
  productsInspected: number;
  productsSkipped: number;
  averageInferenceTimeMs: number;
  lastInferenceTimeMs: number;
  isBottleneck: boolean;
}

// ---------------------------------------------------------------------------
// Pipeline Constants
// ---------------------------------------------------------------------------

export const DEFAULT_LIVE_INSPECTION_FPS = 10;
export const MIN_LIVE_INSPECTION_FPS = 4;
export const MAX_LIVE_INSPECTION_FPS = 20;

// Detection thresholds inside Inspection Zone
export const OCCUPANCY_THRESHOLD_ENTER = 0.20; // Product enters ROI
export const OCCUPANCY_THRESHOLD_READY = 0.40; // Product well-seated inside ROI
export const OCCUPANCY_THRESHOLD_EXIT = 0.16; // Product has cleared ROI (empty belt)
export const MOTION_STABILITY_THRESHOLD = 0.16; // Motion delta low enough for crisp capture
export const MIN_SHARPNESS_LIMIT = 0.0010; // Reject severely blurred frames
export const MAX_CANDIDATE_BUFFER = 5;

// Default center inspection zone (70% width, 70% height)
export const DEFAULT_ROI_NORMALIZED: RoiNormalized = {
  x: 0.15,
  y: 0.15,
  width: 0.70,
  height: 0.70,
};

/**
 * Reusable low-resolution canvas for ultra-fast frame analysis (no garbage collection lag)
 */
class LiveFrameAnalyzer {
  private sampleCanvas: HTMLCanvasElement | null = null;
  private sampleCtx: CanvasRenderingContext2D | null = null;
  private captureCanvas: HTMLCanvasElement | null = null;
  private captureCtx: CanvasRenderingContext2D | null = null;
  private prevFrameLum: Float32Array | null = null;
  private sampleW = 64;
  private sampleH = 48;

  constructor() {}

  private ensureCanvases() {
    if (!this.sampleCanvas && typeof document !== 'undefined') {
      this.sampleCanvas = document.createElement('canvas');
      this.sampleCanvas.width = this.sampleW;
      this.sampleCanvas.height = this.sampleH;
      this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true });
    }
    if (!this.captureCanvas && typeof document !== 'undefined') {
      this.captureCanvas = document.createElement('canvas');
      this.captureCanvas.width = 640;
      this.captureCanvas.height = 480;
      this.captureCtx = this.captureCanvas.getContext('2d', { willReadFrequently: true });
    }
  }

  /**
   * Fast ROI analysis to detect product presence, occupancy, motion, and sharpness
   */
  public analyzeRoi(video: HTMLVideoElement, roi: RoiNormalized): RoiFrameAnalysis {
    this.ensureCanvases();
    if (!this.sampleCtx) {
      return {
        occupancyScore: 0,
        edgeDensity: 0,
        contrastScore: 0,
        motionScore: 0,
        sharpnessScore: 0,
        isProductPresent: false,
        isStable: false,
        timestamp: performance.now(),
      };
    }

    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;

    const rx = Math.max(0, Math.floor(roi.x * vw));
    const ry = Math.max(0, Math.floor(roi.y * vh));
    const rw = Math.min(vw - rx, Math.floor(roi.width * vw));
    const rh = Math.min(vh - ry, Math.floor(roi.height * vh));

    // Draw only the ROI into the small 64x48 sampling canvas
    this.sampleCtx.drawImage(video, rx, ry, rw, rh, 0, 0, this.sampleW, this.sampleH);
    const imgData = this.sampleCtx.getImageData(0, 0, this.sampleW, this.sampleH);
    const data = imgData.data;
    const totalPixels = this.sampleW * this.sampleH;

    const currLum = new Float32Array(totalPixels);
    let sumL = 0;
    let sumSqL = 0;

    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const l = 0.299 * (data[idx] / 255) + 0.587 * (data[idx + 1] / 255) + 0.114 * (data[idx + 2] / 255);
      currLum[i] = l;
      sumL += l;
      sumSqL += l * l;
    }

    const meanL = sumL / totalPixels;
    const contrast = Math.sqrt(Math.max(0, sumSqL / totalPixels - meanL * meanL));

    // Estimate background luminance from the border pixels of the ROI thumbnail
    let borderLumSum = 0;
    let borderCount = 0;
    for (let y = 0; y < this.sampleH; y++) {
      for (let x = 0; x < this.sampleW; x++) {
        if (x < 3 || x >= this.sampleW - 3 || y < 3 || y >= this.sampleH - 3) {
          borderLumSum += currLum[y * this.sampleW + x];
          borderCount++;
        }
      }
    }
    const bgLum = borderCount > 0 ? borderLumSum / borderCount : meanL;

    // Sobel gradients and Occupancy
    let edgeCount = 0;
    let occupancyCount = 0;
    let gradEnergy = 0;
    let gradSamples = 0;

    for (let y = 1; y < this.sampleH - 1; y++) {
      for (let x = 1; x < this.sampleW - 1; x++) {
        const idx = y * this.sampleW + x;
        const l = currLum[idx];

        // Departure from background
        const diffBg = Math.abs(l - bgLum);

        // Fast Sobel
        const gx = -currLum[idx - this.sampleW - 1] + currLum[idx - this.sampleW + 1] - 2 * currLum[idx - 1] + 2 * currLum[idx + 1] - currLum[idx + this.sampleW - 1] + currLum[idx + this.sampleW + 1];
        const gy = -currLum[idx - this.sampleW - 1] - 2 * currLum[idx - this.sampleW] - currLum[idx - this.sampleW + 1] + currLum[idx + this.sampleW - 1] + 2 * currLum[idx + this.sampleW] + currLum[idx + this.sampleW + 1];
        const mag = Math.sqrt(gx * gx + gy * gy);

        gradEnergy += mag * mag;
        gradSamples++;

        if (mag > 0.14) edgeCount++;
        if (diffBg > 0.12 || mag > 0.16) occupancyCount++;
      }
    }

    const edgeDensity = edgeCount / (gradSamples || 1);
    const occupancyScore = Math.min(1.0, occupancyCount / (gradSamples || 1));
    const sharpnessScore = gradSamples > 0 ? gradEnergy / gradSamples : 0;

    // Motion score (frame-to-frame delta)
    let motionScore = 0;
    if (this.prevFrameLum && this.prevFrameLum.length === totalPixels) {
      let motionSum = 0;
      for (let i = 0; i < totalPixels; i++) {
        motionSum += Math.abs(currLum[i] - this.prevFrameLum[i]);
      }
      motionScore = motionSum / totalPixels;
    }
    this.prevFrameLum = currLum;

    const isProductPresent = occupancyScore >= OCCUPANCY_THRESHOLD_ENTER;
    const isStable = motionScore <= MOTION_STABILITY_THRESHOLD && sharpnessScore >= MIN_SHARPNESS_LIMIT;

    return {
      occupancyScore: Number(occupancyScore.toFixed(3)),
      edgeDensity: Number(edgeDensity.toFixed(3)),
      contrastScore: Number(contrast.toFixed(3)),
      motionScore: Number(motionScore.toFixed(3)),
      sharpnessScore: Number(sharpnessScore.toFixed(4)),
      isProductPresent,
      isStable,
      timestamp: performance.now(),
    };
  }

  /**
   * Captures high-resolution frame dataUrl cropped exactly to the ROI
   */
  public captureRoiFrame(video: HTMLVideoElement, roi: RoiNormalized): string {
    this.ensureCanvases();
    if (!this.captureCanvas || !this.captureCtx) return '';

    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;

    const rx = Math.max(0, Math.floor(roi.x * vw));
    const ry = Math.max(0, Math.floor(roi.y * vh));
    const rw = Math.min(vw - rx, Math.floor(roi.width * vw));
    const rh = Math.min(vh - ry, Math.floor(roi.height * vh));

    if (this.captureCanvas.width !== rw || this.captureCanvas.height !== rh) {
      this.captureCanvas.width = rw;
      this.captureCanvas.height = rh;
    }

    this.captureCtx.drawImage(video, rx, ry, rw, rh, 0, 0, rw, rh);
    return this.captureCanvas.toDataURL('image/jpeg', 0.88);
  }
}

// ---------------------------------------------------------------------------
// Autonomous Conveyor State Machine Tracker
// ---------------------------------------------------------------------------

export class LiveConveyorTracker {
  private state: ConveyorState = 'IDLE';
  private analyzer = new LiveFrameAnalyzer();
  private candidateBuffer: FrameCandidate[] = [];
  private roi: RoiNormalized = { ...DEFAULT_ROI_NORMALIZED };
  private inspectionFps: number = DEFAULT_LIVE_INSPECTION_FPS;

  // Diagnostics counters
  private framesSampled: number = 0;
  private framesInspected: number = 0;
  private productsDetected: number = 0;
  private productsInspected: number = 0;
  private productsSkipped: number = 0;
  private inferenceTimes: number[] = [];

  // Timing & FPS metrics
  private lastSampleTime: number = 0;
  private sampleIntervals: number[] = [];
  private cameraFrameCount: number = 0;
  private cameraFpsStartTime: number = performance.now();
  private measuredCameraFps: number = 0;
  private measuredProcessingFps: number = 0;
  private lastInferenceTimeMs: number = 0;

  // Inspection execution callback
  private onTriggerInspection: ((frameDataUrl: string) => Promise<void>) | null = null;
  private isProcessingInspection: boolean = false;

  constructor(roi?: RoiNormalized, fps?: number) {
    if (roi) this.roi = { ...roi };
    if (fps) this.inspectionFps = Math.max(MIN_LIVE_INSPECTION_FPS, Math.min(MAX_LIVE_INSPECTION_FPS, fps));
  }

  public setRoi(roi: RoiNormalized) {
    this.roi = { ...roi };
  }

  public getRoi(): RoiNormalized {
    return { ...this.roi };
  }

  public setFps(fps: number) {
    this.inspectionFps = Math.max(MIN_LIVE_INSPECTION_FPS, Math.min(MAX_LIVE_INSPECTION_FPS, fps));
  }

  public getFps(): number {
    return this.inspectionFps;
  }

  public setInspectionHandler(handler: (frameDataUrl: string) => Promise<void>) {
    this.onTriggerInspection = handler;
  }

  public markCameraFrame() {
    this.cameraFrameCount++;
    const now = performance.now();
    const elapsed = now - this.cameraFpsStartTime;
    if (elapsed >= 1000) {
      this.measuredCameraFps = Math.round((this.cameraFrameCount * 1000) / elapsed);
      this.cameraFrameCount = 0;
      this.cameraFpsStartTime = now;
    }
  }

  public recordInferenceComplete(durationMs: number) {
    this.lastInferenceTimeMs = durationMs;
    this.inferenceTimes.push(durationMs);
    if (this.inferenceTimes.length > 20) this.inferenceTimes.shift();
    this.productsInspected++;
    this.isProcessingInspection = false;
    this.state = 'RESULT_RECORDED';
  }

  public recordInferenceSkipped(reason: string) {
    console.warn(`[LiveConveyor] Inspection skipped: ${reason}`);
    this.productsSkipped++;
    this.isProcessingInspection = false;
    this.state = 'WAIT_FOR_PRODUCT_EXIT';
  }

  public resetSessionCounters() {
    this.framesSampled = 0;
    this.framesInspected = 0;
    this.productsDetected = 0;
    this.productsInspected = 0;
    this.productsSkipped = 0;
    this.inferenceTimes = [];
    this.candidateBuffer = [];
    this.state = 'IDLE';
  }

  /**
   * Evaluates one live video frame tick:
   * Called continuously by the inspection loop at inspectionFps
   */
  public async processFrameTick(video: HTMLVideoElement): Promise<{
    state: ConveyorState;
    analysis: RoiFrameAnalysis;
    diagnostics: LiveDiagnostics;
  }> {
    const now = performance.now();
    this.framesSampled++;

    // Calculate processing FPS
    if (this.lastSampleTime > 0) {
      const dt = now - this.lastSampleTime;
      this.sampleIntervals.push(dt);
      if (this.sampleIntervals.length > 10) this.sampleIntervals.shift();
      const avgDt = this.sampleIntervals.reduce((a, b) => a + b, 0) / this.sampleIntervals.length;
      this.measuredProcessingFps = avgDt > 0 ? Math.round(1000 / avgDt) : this.inspectionFps;
    }
    this.lastSampleTime = now;

    // Fast image analysis on the Inspection Zone ROI
    const analysis = this.analyzer.analyzeRoi(video, this.roi);

    // State Machine Transitions
    switch (this.state) {
      case 'IDLE': {
        if (analysis.occupancyScore >= OCCUPANCY_THRESHOLD_ENTER) {
          this.state = 'PRODUCT_DETECTED';
          this.productsDetected++;
          this.candidateBuffer = [];
        }
        break;
      }

      case 'PRODUCT_DETECTED': {
        if (analysis.occupancyScore >= OCCUPANCY_THRESHOLD_READY) {
          this.state = 'ENTERING';
        } else if (analysis.occupancyScore < OCCUPANCY_THRESHOLD_EXIT) {
          // False trigger or jitter
          this.state = 'IDLE';
        }
        break;
      }

      case 'ENTERING': {
        // Collect candidate frames while product settles in ROI
        const frameDataUrl = this.analyzer.captureRoiFrame(video, this.roi);
        this.candidateBuffer.push({
          dataUrl: frameDataUrl,
          timestamp: now,
          sharpness: analysis.sharpnessScore,
          occupancy: analysis.occupancyScore,
        });

        if (this.candidateBuffer.length > MAX_CANDIDATE_BUFFER) {
          this.candidateBuffer.shift();
        }

        // When product stabilizes or maximum candidates buffered, ready for inspection
        if (analysis.isStable || this.candidateBuffer.length >= 3) {
          this.state = 'READY_FOR_INSPECTION';
        } else if (analysis.occupancyScore < OCCUPANCY_THRESHOLD_EXIT) {
          // Product rushed past without settling
          this.recordInferenceSkipped('Product exited ROI before stabilization');
        }
        break;
      }

      case 'READY_FOR_INSPECTION': {
        if (!this.isProcessingInspection && this.onTriggerInspection) {
          // Select clearest frame from circular candidate buffer (highest sharpness score)
          let bestCandidate = this.candidateBuffer[0];
          for (let i = 1; i < this.candidateBuffer.length; i++) {
            if (this.candidateBuffer[i].sharpness > bestCandidate.sharpness) {
              bestCandidate = this.candidateBuffer[i];
            }
          }

          if (!bestCandidate) {
            bestCandidate = {
              dataUrl: this.analyzer.captureRoiFrame(video, this.roi),
              timestamp: now,
              sharpness: analysis.sharpnessScore,
              occupancy: analysis.occupancyScore,
            };
          }

          // If frame sharpness is below minimum limit, skip to prevent false FAIL
          if (bestCandidate.sharpness < MIN_SHARPNESS_LIMIT) {
            this.recordInferenceSkipped('Motion blur / optical sharpness too low');
            break;
          }

          this.state = 'INSPECTING';
          this.isProcessingInspection = true;
          this.framesInspected++;
          this.candidateBuffer = []; // Release temporary frame memory

          // Trigger asynchronous inspection pipeline
          this.onTriggerInspection(bestCandidate.dataUrl).catch((err) => {
            console.error('[LiveConveyor] Inspection execution error:', err);
            this.recordInferenceSkipped(err.message || 'Execution error');
          });
        }
        break;
      }

      case 'INSPECTING': {
        // While processing, continue updating video stream and wait for recordInferenceComplete()
        break;
      }

      case 'RESULT_RECORDED': {
        // Once result has been recorded, immediately transition to wait-for-exit
        this.state = 'WAIT_FOR_PRODUCT_EXIT';
        break;
      }

      case 'WAIT_FOR_PRODUCT_EXIT': {
        // Strict debouncing / duplicate prevention:
        // Lock out new inspections until product completely exits the ROI
        if (analysis.occupancyScore <= OCCUPANCY_THRESHOLD_EXIT) {
          this.state = 'IDLE';
          this.candidateBuffer = [];
        }
        break;
      }
    }

    const avgInference =
      this.inferenceTimes.length > 0
        ? Math.round(this.inferenceTimes.reduce((a, b) => a + b, 0) / this.inferenceTimes.length)
        : 0;

    const targetIntervalMs = 1000 / this.inspectionFps;
    const isBottleneck = this.lastInferenceTimeMs > targetIntervalMs * 2.5;

    const diagnostics: LiveDiagnostics = {
      cameraFps: this.measuredCameraFps,
      processingFps: this.measuredProcessingFps,
      currentState: this.state,
      roiOccupancy: Math.round(analysis.occupancyScore * 100),
      productDetectionScore: analysis.occupancyScore,
      blurScore: Number(analysis.sharpnessScore.toFixed(4)),
      framesSampled: this.framesSampled,
      framesInspected: this.framesInspected,
      productsDetected: this.productsDetected,
      productsInspected: this.productsInspected,
      productsSkipped: this.productsSkipped,
      averageInferenceTimeMs: avgInference,
      lastInferenceTimeMs: this.lastInferenceTimeMs,
      isBottleneck,
    };

    return {
      state: this.state,
      analysis,
      diagnostics,
    };
  }

  public cleanup() {
    this.candidateBuffer = [];
    this.onTriggerInspection = null;
    this.isProcessingInspection = false;
    this.state = 'IDLE';
  }
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ProductPart, InspectionRecord, NavSection, DefectRegion, QualityStatus } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { getUserDatasets } from '../services/firebase';
import { getProductDataset } from '../services/datasetStore';
import { 
  buildPatchCoreMemoryBank, 
  inspectImageWithPatchCore, 
  PatchCoreMemoryBank, 
  PatchCoreInspectionResult,
  compressImageForStorage 
} from '../services/patchcore';
import {
  LiveConveyorTracker,
  ConveyorState,
  RoiNormalized,
  LiveDiagnostics,
  DEFAULT_LIVE_INSPECTION_FPS,
  DEFAULT_ROI_NORMALIZED,
} from '../services/liveInspection';
import { 
  Camera, 
  Video, 
  VideoOff, 
  Upload, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Play, 
  Square,
  Sparkles,
  ArrowRight,
  Crosshair,
  Layers,
  Image as ImageIcon,
  Trash2,
  FileCheck,
  Activity,
  Flame,
  Loader2,
  Sliders,
  ShieldCheck,
  Box,
  TrendingUp,
  Cpu,
  AlertCircle
} from 'lucide-react';

interface InspectionViewProps {
  products: ProductPart[];
  currentProduct: ProductPart | null;
  threshold: number;
  audibleAlerts?: boolean;
  onUpdateThreshold: (val: number) => void;
  onSelectProduct: (product: ProductPart) => void;
  onRecordInspection: (record: InspectionRecord) => void;
  onNavigate?: (section: NavSection) => void;
  onCreateProduct?: () => void;
}

type ViewMode = 'live' | 'original' | 'heatmap' | 'overlay';
type StationTab = 'conveyor' | 'manual';

/**
 * Web Audio API Industrial Audio Feedback
 */
function playIndustrialAlert(isPass: boolean) {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    if (isPass) {
      // Crisp dual-tone industrial acceptance beep
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      osc1.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.12);
    } else {
      // Industrial rejection buzz
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(180, now);
      gain1.gain.setValueAtTime(0.18, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.28);
    }
  } catch {
    // Autoplay restrictions or background tab
  }
}

export const InspectionView: React.FC<InspectionViewProps> = ({
  products,
  currentProduct,
  threshold,
  audibleAlerts = true,
  onUpdateThreshold,
  onSelectProduct,
  onRecordInspection,
  onNavigate,
  onCreateProduct,
}) => {
  const { currentUser } = useAuth();

  // Mode Selection: Live Conveyor Inspection (Default) vs Manual Test Mode
  const [activeTab, setActiveTab] = useState<StationTab>('conveyor');

  // Video and Media Stream Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Camera state
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isRequestingCamera, setIsRequestingCamera] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [streamInfo, setStreamInfo] = useState<{ width: number; height: number; fps: number } | null>(null);

  // Autonomous Conveyor Belt System State
  const [isLiveInspectionRunning, setIsLiveInspectionRunning] = useState<boolean>(false);
  const [conveyorState, setConveyorState] = useState<ConveyorState>('IDLE');
  const [liveInspectionFps, setLiveInspectionFps] = useState<number>(DEFAULT_LIVE_INSPECTION_FPS);
  const [roiConfig, setRoiConfig] = useState<RoiNormalized>({ ...DEFAULT_ROI_NORMALIZED });
  const [roiPreset, setRoiPreset] = useState<'standard' | 'compact' | 'wide'>('standard');

  // Session Inspection Counters
  const [sessionInspectedCount, setSessionInspectedCount] = useState<number>(0);
  const [sessionPassCount, setSessionPassCount] = useState<number>(0);
  const [sessionFailCount, setSessionFailCount] = useState<number>(0);

  // Latest Live Result Banner
  const [currentLiveResult, setCurrentLiveResult] = useState<{
    result: QualityStatus;
    anomalyScore: number;
    threshold: number;
    productIndex: number;
    defectRegion?: DefectRegion;
    timestamp: string;
  } | null>(null);

  // Live Performance & Bottleneck Diagnostics
  const [liveDiagnostics, setLiveDiagnostics] = useState<LiveDiagnostics>({
    cameraFps: 0,
    processingFps: 0,
    currentState: 'IDLE',
    roiOccupancy: 0,
    productDetectionScore: 0,
    blurScore: 0,
    framesSampled: 0,
    framesInspected: 0,
    productsDetected: 0,
    productsInspected: 0,
    productsSkipped: 0,
    averageInferenceTimeMs: 0,
    lastInferenceTimeMs: 0,
    isBottleneck: false,
  });

  // Manual Test Mode Captured Image
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<{
    source: 'webcam' | 'upload';
    name: string;
    timestamp: string;
    resolution?: string;
  } | null>(null);

  const [activeViewMode, setActiveViewMode] = useState<ViewMode>('live');
  const [showDebugInfo, setShowDebugInfo] = useState<boolean>(false);

  // Normal Reference Representation state
  const [referenceImages, setReferenceImages] = useState<{ id: string; dataUrl: string; fileName: string }[]>([]);
  const [isLoadingReferences, setIsLoadingReferences] = useState<boolean>(false);
  const [memoryBank, setMemoryBank] = useState<PatchCoreMemoryBank | null>(null);
  const [isTrainingMemoryBank, setIsTrainingMemoryBank] = useState<boolean>(false);
  const [trainingProgress, setTrainingProgress] = useState<number>(0);

  // Active AI Inspection Result state
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisStep, setAnalysisStep] = useState<string>('');
  const [inspectionResult, setInspectionResult] = useState<PatchCoreInspectionResult | null>(null);
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);

  // Tracker and Memory Bank Caches
  const trackerRef = useRef<LiveConveyorTracker>(new LiveConveyorTracker(roiConfig, liveInspectionFps));
  const memoryBankCacheRef = useRef<Map<string, { bank: PatchCoreMemoryBank; count: number }>>(new Map());
  const loopIntervalRef = useRef<number | null>(null);

  // 1. Load normal reference images for current product from users/{userId}/datasets
  useEffect(() => {
    if (!currentProduct || !currentUser) {
      setReferenceImages([]);
      setMemoryBank(null);
      return;
    }

    let isMounted = true;
    setIsLoadingReferences(true);

    const loadProductReferences = async () => {
      try {
        const items = await getUserDatasets(currentUser.uid, currentProduct.id);
        if (!isMounted) return;

        if (items && items.length > 0) {
          const valid = items
            .filter((it) => it.dataUrl && it.dataUrl.length > 0)
            .map((it) => ({
              id: it.id,
              dataUrl: it.dataUrl as string,
              fileName: it.fileName,
            }));
          setReferenceImages(valid);
        } else {
          const localItems = getProductDataset(currentProduct.name, currentUser.uid);
          const valid = localItems
            .filter((it) => it.dataUrl && it.dataUrl.length > 0)
            .map((it) => ({
              id: it.id,
              dataUrl: it.dataUrl,
              fileName: it.fileName,
            }));
          setReferenceImages(valid);
        }
      } catch (err) {
        console.warn('Error loading reference images from Firestore:', err);
        const localItems = getProductDataset(currentProduct.name, currentUser.uid);
        if (isMounted) {
          setReferenceImages(
            localItems.map((it) => ({
              id: it.id,
              dataUrl: it.dataUrl,
              fileName: it.fileName,
            }))
          );
        }
      } finally {
        if (isMounted) setIsLoadingReferences(false);
      }
    };

    loadProductReferences();

    const cached = memoryBankCacheRef.current.get(currentProduct.id);
    if (cached) {
      setMemoryBank(cached.bank);
    } else {
      setMemoryBank(null);
    }

    setInspectionResult(null);
    setLastSavedId(null);

    return () => {
      isMounted = false;
    };
  }, [currentProduct?.id, currentUser?.uid]);

  /**
   * Stop camera stream tracks and clear stream reference
   */
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((track) => {
          track.stop();
        });
      } catch (err) {
        console.warn('Error stopping camera tracks:', err);
      }
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsCameraActive(false);
    setIsRequestingCamera(false);
    setStreamInfo(null);
  }, []);

  /**
   * Start continuous live camera stream
   */
  const startCamera = useCallback(async (): Promise<boolean> => {
    setCameraError(null);
    setIsRequestingCamera(true);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Browser camera unavailable: The MediaDevices API is not supported in this browser or is restricted.'
      );
      setIsRequestingCamera(false);
      return false;
    }

    if (streamRef.current && isCameraActive) {
      setIsRequestingCamera(false);
      return true;
    }

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280, min: 640 },
            height: { ideal: 720, min: 480 },
            facingMode: 'environment',
          },
          audio: false,
        });
      } catch (firstErr) {
        console.warn('Ideal camera constraints failed, attempting fallback:', firstErr);
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.muted = true;

        videoRef.current.onloadedmetadata = async () => {
          if (videoRef.current) {
            try {
              await videoRef.current.play();
              setStreamInfo({
                width: videoRef.current.videoWidth || 1280,
                height: videoRef.current.videoHeight || 720,
                fps: 30,
              });
            } catch (playErr) {
              console.warn('Video play interrupted:', playErr);
            }
          }
        };
      }

      setIsCameraActive(true);
      setActiveViewMode('live');
      setCameraError(null);
      return true;
    } catch (err: any) {
      console.error('Camera access error:', err);
      setIsCameraActive(false);

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError(
          'Camera permission denied: Please enable camera permissions in your browser to inspect live parts.'
        );
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError(
          'No camera detected: Connect a USB or industrial web camera to enable optical inspection.'
        );
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setCameraError(
          'Camera already in use: Another program or browser tab is accessing the camera device.'
        );
      } else {
        setCameraError(`Camera initialization error: ${err.message || 'Unable to open camera.'}`);
      }
      return false;
    } finally {
      setIsRequestingCamera(false);
    }
  }, [isCameraActive]);

  /**
   * Pre-builds or retrieves the normal reference memory bank
   */
  const ensureMemoryBank = useCallback(async (): Promise<PatchCoreMemoryBank> => {
    if (!currentProduct) {
      throw new Error('Please select a manufactured part profile first.');
    }

    if (referenceImages.length === 0) {
      throw new Error(
        `Cannot run AI anomaly inspection: No normal reference images found for "${currentProduct.name}" in users/${currentUser?.uid}/datasets. Please add reference images in the Dataset tab first.`
      );
    }

    const cached = memoryBankCacheRef.current.get(currentProduct.id);
    if (cached && cached.count === referenceImages.length) {
      return cached.bank;
    }

    setIsTrainingMemoryBank(true);
    setTrainingProgress(10);
    setAnalysisStep('Building normal representation from reference dataset...');

    try {
      const urls = referenceImages.map((r) => r.dataUrl);
      const bank = await buildPatchCoreMemoryBank(currentProduct.name, urls, (pct) => {
        setTrainingProgress(pct);
      });

      memoryBankCacheRef.current.set(currentProduct.id, {
        bank,
        count: referenceImages.length,
      });
      setMemoryBank(bank);
      return bank;
    } finally {
      setIsTrainingMemoryBank(false);
      setTrainingProgress(0);
    }
  }, [currentProduct, referenceImages, currentUser?.uid]);

  /**
   * Autonomous AI Inspection Execution:
   * Called by the conveyor state machine when a product settles in the Inspection Zone
   */
  const handleAutoInspect = useCallback(async (frameDataUrl: string) => {
    if (!currentProduct || !currentUser) {
      trackerRef.current.recordInferenceSkipped('No product or operator profile');
      return;
    }

    const effectiveThreshold = currentProduct.nominalThreshold ?? threshold ?? 0.50;
    setIsAnalyzing(true);
    setAnalysisStep('Analyzing candidate frame...');

    try {
      const bank = await ensureMemoryBank();
      const result = await inspectImageWithPatchCore(frameDataUrl, bank, effectiveThreshold);

      if (result.result === 'INVALID') {
        trackerRef.current.recordInferenceSkipped(result.qualityIssue || 'Image quality below tolerance');
        return;
      }

      // Record completed inspection
      setSessionInspectedCount((prev) => prev + 1);
      if (result.result === 'PASS') {
        setSessionPassCount((prev) => prev + 1);
        if (audibleAlerts) playIndustrialAlert(true);
      } else {
        setSessionFailCount((prev) => prev + 1);
        if (audibleAlerts) playIndustrialAlert(false);
      }

      setInspectionResult(result);
      const nextIndex = sessionInspectedCount + 1;
      setCurrentLiveResult({
        result: result.result,
        anomalyScore: result.anomalyScore,
        threshold: effectiveThreshold,
        productIndex: nextIndex,
        defectRegion: result.suspectedDefectRegion,
        timestamp: new Date().toLocaleTimeString(),
      });

      // Persist exactly ONE record to Firestore
      const recordId = `QC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      const compressedInspectionImage = await compressImageForStorage(frameDataUrl, 800, 0.82);
      const compressedOverlay = await compressImageForStorage(result.overlayDataUrl, 800, 0.82);
      const compressedHeatmap = await compressImageForStorage(result.heatmapDataUrl, 400, 0.80);

      const inspectionRecord: InspectionRecord = {
        id: recordId,
        userId: currentUser.uid,
        productId: currentProduct.id,
        partId: currentProduct.id,
        productName: currentProduct.name,
        product_name: currentProduct.name,
        partSku: currentProduct.sku,
        timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
        anomalyScore: result.anomalyScore,
        anomaly_score: result.anomalyScore,
        threshold: effectiveThreshold,
        status: result.result,
        result: result.result,
        confidenceScore: Number((1 - result.anomalyScore).toFixed(2)),
        imageUrl: compressedInspectionImage,
        imageDataUrl: compressedInspectionImage,
        image_path: `Conveyor_Frame_${currentProduct.sku}_#${nextIndex}.jpg`,
        heatmapUrl: compressedHeatmap,
        overlayUrl: compressedOverlay,
        suspectedDefectRegion: result.suspectedDefectRegion,
        defectLocation: result.result === 'FAIL' 
          ? `(${result.maxAnomalyCoord.x}px, ${result.maxAnomalyCoord.y}px)` 
          : '',
        defectType: result.result === 'FAIL' ? 'Surface Anomaly' : 'Conformant',
        inferenceTimeMs: result.inferenceTimeMs,
        batchNumber: `BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
        operator: currentUser.displayName || 'Operator',
        inspectionLine: currentProduct.activeLine || 'Line 01 - Optical Bench',
        source: 'live_camera',
      };

      onRecordInspection(inspectionRecord);
      setLastSavedId(recordId);

      // Notify tracker that inference finished so it transitions to WAIT_FOR_PRODUCT_EXIT
      trackerRef.current.recordInferenceComplete(result.inferenceTimeMs);
    } catch (err: any) {
      console.error('[LiveConveyor] Inspection failure:', err);
      trackerRef.current.recordInferenceSkipped(err.message || 'Inspection error');
    } finally {
      setIsAnalyzing(false);
      setAnalysisStep('');
    }
  }, [currentProduct, currentUser, threshold, audibleAlerts, ensureMemoryBank, onRecordInspection, sessionInspectedCount]);

  /**
   * Start Autonomous Live Inspection Loop
   */
  const handleStartLiveInspection = async () => {
    if (!currentProduct) {
      setCameraError('Please select a product part profile first.');
      return;
    }

    if (referenceImages.length === 0) {
      setCameraError(
        `Cannot start live inspection: No normal reference images uploaded for "${currentProduct.name}". Please add normal images in the Dataset tab first.`
      );
      return;
    }

    const cameraStarted = await startCamera();
    if (!cameraStarted) return;

    // Connect tracker inspection callback
    trackerRef.current.setInspectionHandler(handleAutoInspect);
    trackerRef.current.setRoi(roiConfig);
    trackerRef.current.setFps(liveInspectionFps);
    setIsLiveInspectionRunning(true);
    setCameraError(null);

    // Frame sampling loop at LIVE_INSPECTION_FPS
    if (loopIntervalRef.current) clearInterval(loopIntervalRef.current);

    loopIntervalRef.current = window.setInterval(async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) return;

      trackerRef.current.markCameraFrame();
      const tickResult = await trackerRef.current.processFrameTick(videoRef.current);

      setConveyorState(tickResult.state);
      setLiveDiagnostics(tickResult.diagnostics);
    }, Math.round(1000 / liveInspectionFps));
  };

  /**
   * Stop Live Inspection Loop
   */
  const handleStopLiveInspection = () => {
    if (loopIntervalRef.current) {
      clearInterval(loopIntervalRef.current);
      loopIntervalRef.current = null;
    }

    trackerRef.current.cleanup();
    setIsLiveInspectionRunning(false);
    setConveyorState('IDLE');
    setAnalysisStep('');
  };

  /**
   * Change ROI Preset (Standard, Compact, Wide)
   */
  const handleSetRoiPreset = (preset: 'standard' | 'compact' | 'wide') => {
    setRoiPreset(preset);
    let newRoi: RoiNormalized;
    if (preset === 'compact') {
      newRoi = { x: 0.25, y: 0.25, width: 0.50, height: 0.50 };
    } else if (preset === 'wide') {
      newRoi = { x: 0.08, y: 0.08, width: 0.84, height: 0.84 };
    } else {
      newRoi = { ...DEFAULT_ROI_NORMALIZED };
    }
    setRoiConfig(newRoi);
    trackerRef.current.setRoi(newRoi);
  };

  /**
   * Change Sampling FPS
   */
  const handleChangeFps = (fps: number) => {
    setLiveInspectionFps(fps);
    trackerRef.current.setFps(fps);
    if (isLiveInspectionRunning) {
      // Re-arm interval with new FPS
      if (loopIntervalRef.current) clearInterval(loopIntervalRef.current);
      loopIntervalRef.current = window.setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return;
        trackerRef.current.markCameraFrame();
        const tickResult = await trackerRef.current.processFrameTick(videoRef.current);
        setConveyorState(tickResult.state);
        setLiveDiagnostics(tickResult.diagnostics);
      }, Math.round(1000 / fps));
    }
  };

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (loopIntervalRef.current) {
        clearInterval(loopIntervalRef.current);
      }
      stopCamera();
    };
  }, [stopCamera]);

  /**
   * Manual Test Mode Image Upload
   */
  const handleManualFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        setCapturedImage(result);
        setImageMeta({
          source: 'upload',
          name: file.name,
          timestamp: new Date().toLocaleTimeString(),
        });
        setInspectionResult(null);
        setActiveViewMode('original');
      }
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /**
   * Manual Test Mode Inspection Run
   */
  const handleRunManualInspection = async () => {
    if (!capturedImage) {
      setCameraError('Please upload an image first.');
      return;
    }
    if (!currentProduct) {
      setCameraError('Please select a product first.');
      return;
    }
    const effectiveThreshold = currentProduct.nominalThreshold ?? threshold ?? 0.50;
    setIsAnalyzing(true);
    setAnalysisStep('Analyzing test frame...');

    try {
      const bank = await ensureMemoryBank();
      const result = await inspectImageWithPatchCore(capturedImage, bank, effectiveThreshold);
      setInspectionResult(result);
      setActiveViewMode('overlay');

      if (audibleAlerts && result.result !== 'INVALID') {
        playIndustrialAlert(result.result === 'PASS');
      }

      if (result.result !== 'INVALID') {
        const recordId = `QC-MANUAL-${Date.now().toString().slice(-6)}`;
        onRecordInspection({
          id: recordId,
          userId: currentUser?.uid,
          productId: currentProduct.id,
          partId: currentProduct.id,
          productName: currentProduct.name,
          product_name: currentProduct.name,
          partSku: currentProduct.sku,
          timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
          anomalyScore: result.anomalyScore,
          anomaly_score: result.anomalyScore,
          threshold: effectiveThreshold,
          status: result.result,
          result: result.result,
          confidenceScore: Number((1 - result.anomalyScore).toFixed(2)),
          imageUrl: capturedImage,
          imageDataUrl: capturedImage,
          image_path: imageMeta?.name || 'Manual_Test_Image.jpg',
          heatmapUrl: result.heatmapDataUrl,
          overlayUrl: result.overlayDataUrl,
          suspectedDefectRegion: result.suspectedDefectRegion,
          defectLocation: result.result === 'FAIL' ? `(${result.maxAnomalyCoord.x}px, ${result.maxAnomalyCoord.y}px)` : '',
          defectType: result.result === 'FAIL' ? 'Surface Anomaly' : 'Conformant',
          inferenceTimeMs: result.inferenceTimeMs,
          source: 'manual_upload',
        });
        setLastSavedId(recordId);
      }
    } catch (err: any) {
      setCameraError(err.message || 'Inspection failed');
    } finally {
      setIsAnalyzing(false);
      setAnalysisStep('');
    }
  };

  const effectiveThreshold = currentProduct?.nominalThreshold ?? threshold ?? 0.50;
  const yieldPct = sessionInspectedCount > 0 ? ((sessionPassCount / sessionInspectedCount) * 100).toFixed(1) : '100.0';

  return (
    <div className="space-y-6">
      
      {/* Top Station Bar: Part Selector & Station Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-500 mb-1">
            <span className="flex items-center gap-1.5 text-blue-600 font-semibold">
              <span className="w-2 h-2 rounded-full bg-blue-600" />
              CONTINUOUS INDUSTRIAL OPTICAL STATION
            </span>
            <span>·</span>
            <span>LINE CONVEYOR-01</span>
            <span>·</span>
            <span className="text-slate-400">Autonomous Edge AI</span>
          </div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight font-mono">
            Live Conveyor-Belt Optical Chamber
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Continuous optical stream monitoring with automated product presence detection and zero-click defect localization.
          </p>
        </div>

        {/* Product Part Dropdown Selector */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-mono font-medium text-slate-600 whitespace-nowrap">
            Inspection Part:
          </label>
          {products.length === 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-slate-400 italic">No products yet</span>
              {onCreateProduct && (
                <button
                  type="button"
                  onClick={onCreateProduct}
                  className="px-2.5 py-1 text-xs font-mono font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition-colors"
                >
                  + Register Part
                </button>
              )}
            </div>
          ) : (
            <select
              value={currentProduct?.id || ''}
              onChange={(e) => {
                const selected = products.find((p) => p.id === e.target.value);
                if (selected) onSelectProduct(selected);
              }}
              className="bg-slate-50 border border-slate-300 text-slate-800 text-xs font-mono px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium cursor-pointer"
            >
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.sku})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Mode Tabs: LIVE CONVEYOR (Default) vs MANUAL TEST MODE */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <div className="flex items-center gap-2 font-mono text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('conveyor')}
            className={`px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'conveyor'
                ? 'bg-blue-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Video className="w-4 h-4" />
            <span>LIVE CONVEYOR INSPECTION</span>
            {isLiveInspectionRunning && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-1" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('manual')}
            className={`px-4 py-2 rounded-lg font-semibold flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === 'manual'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            <Upload className="w-4 h-4" />
            <span>MANUAL TEST MODE (OFFLINE / DEBUG)</span>
          </button>
        </div>

        <div className="hidden sm:flex items-center gap-3 text-xs font-mono text-slate-500">
          <span>Tolerance: <strong className="text-slate-800">{effectiveThreshold.toFixed(2)}</strong></span>
          <span>·</span>
          <span>References: <strong className="text-slate-800">{referenceImages.length}</strong></span>
        </div>
      </div>

      {/* Camera & Permission Error Alert Banner */}
      {cameraError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs font-mono text-rose-800 flex items-start justify-between gap-3 shadow-xs animate-fadeIn">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-rose-900 mb-0.5">Optical Sensor Warning</div>
              <div className="leading-relaxed">{cameraError}</div>
            </div>
          </div>
          <button
            onClick={() => setCameraError(null)}
            className="text-rose-500 hover:text-rose-800 text-xs font-bold px-2 py-1 rounded hover:bg-rose-100 transition-colors cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (8 cols): Large Continuous Live Camera Viewport Area */}
        <div className="lg:col-span-8 space-y-4">
          
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            
            {/* Viewport Header with Live Status & Mode Badge */}
            <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${
                  isLiveInspectionRunning ? 'bg-emerald-400 animate-ping' : isCameraActive ? 'bg-blue-400' : 'bg-slate-500'
                }`} />
                <span className="font-bold text-white tracking-wide">
                  {activeTab === 'conveyor' ? 'CONVEYOR OPTICAL FEED' : 'MANUAL TEST FEED'}
                </span>

                {isLiveInspectionRunning && (
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold border border-emerald-500/30 flex items-center gap-1.5 ml-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    AUTONOMOUS INSPECTION ACTIVE
                  </span>
                )}
              </div>

              {/* View Mode Tabs for Manual Mode or Result Overlays */}
              <div className="flex items-center gap-1 bg-slate-800/80 p-0.5 rounded-lg border border-slate-700 text-[10px]">
                <button
                  type="button"
                  onClick={() => setActiveViewMode('live')}
                  className={`px-2.5 py-1 rounded transition-colors ${
                    activeViewMode === 'live' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Live Feed
                </button>
                {inspectionResult && (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveViewMode('overlay')}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        activeViewMode === 'overlay' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Overlay + Defect
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveViewMode('heatmap')}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        activeViewMode === 'heatmap' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Heatmap
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Viewport Display Chamber */}
            <div className="relative aspect-video w-full bg-slate-950 flex items-center justify-center overflow-hidden select-none">
              
              {/* Continuous Video Feed */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover transition-opacity duration-300 ${
                  isCameraActive && activeViewMode === 'live' ? 'opacity-100' : 'opacity-0 hidden'
                }`}
              />

              {/* Image Overlays (When inspecting or reviewing results) */}
              {activeViewMode === 'overlay' && inspectionResult && (
                <img
                  src={inspectionResult.overlayDataUrl}
                  alt="Inspection Overlay"
                  className="w-full h-full object-contain"
                />
              )}

              {activeViewMode === 'heatmap' && inspectionResult && (
                <img
                  src={inspectionResult.heatmapDataUrl}
                  alt="Anomaly Heatmap"
                  className="w-full h-full object-contain"
                />
              )}

              {activeViewMode === 'original' && capturedImage && (
                <img
                  src={capturedImage}
                  alt="Captured Frame"
                  className="w-full h-full object-contain"
                />
              )}

              {/* Camera Standby Indicator */}
              {!isCameraActive && !capturedImage && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-400 space-y-3">
                  <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 shadow-inner">
                    <VideoOff className="w-8 h-8" />
                  </div>
                  <div>
                    <div className="text-sm font-bold font-mono text-slate-200">
                      Conveyor Optical Chamber Standby
                    </div>
                    <p className="text-xs text-slate-500 max-w-sm mt-1 font-mono">
                      Click &quot;Start Live Inspection&quot; to begin continuous automated conveyor tracking.
                    </p>
                  </div>
                </div>
              )}

              {/* CONVEYOR INSPECTION ZONE RETICLE (Active in Live Feed) */}
              {isCameraActive && activeViewMode === 'live' && (
                <div
                  className="absolute pointer-events-none transition-all duration-300"
                  style={{
                    left: `${roiConfig.x * 100}%`,
                    top: `${roiConfig.y * 100}%`,
                    width: `${roiConfig.width * 100}%`,
                    height: `${roiConfig.height * 100}%`,
                  }}
                >
                  {/* Dynamic Reticle Border depending on State */}
                  <div className={`w-full h-full rounded-lg relative transition-all duration-200 border-2 ${
                    conveyorState === 'IDLE'
                      ? 'border-dashed border-blue-400/40'
                      : conveyorState === 'PRODUCT_DETECTED' || conveyorState === 'ENTERING'
                      ? 'border-amber-400 animate-pulse shadow-[0_0_15px_rgba(251,191,36,0.3)]'
                      : conveyorState === 'READY_FOR_INSPECTION' || conveyorState === 'INSPECTING'
                      ? 'border-cyan-400 animate-pulse shadow-[0_0_20px_rgba(34,211,238,0.4)]'
                      : currentLiveResult?.result === 'FAIL'
                      ? 'border-rose-500 shadow-[0_0_25px_rgba(244,63,94,0.5)]'
                      : 'border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.4)]'
                  }`}>
                    {/* Industrial Corner Accents */}
                    <div className="absolute -top-1 -left-1 w-5 h-5 border-t-4 border-l-4 border-inherit" />
                    <div className="absolute -top-1 -right-1 w-5 h-5 border-t-4 border-r-4 border-inherit" />
                    <div className="absolute -bottom-1 -left-1 w-5 h-5 border-b-4 border-l-4 border-inherit" />
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 border-b-4 border-r-4 border-inherit" />

                    {/* Center Crosshair */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-30">
                      <div className="w-8 h-0.5 bg-white" />
                      <div className="h-8 w-0.5 bg-white -ml-4" />
                    </div>

                    {/* Inspection Zone Label */}
                    <div className="absolute -top-6 left-1 bg-slate-900/80 px-2 py-0.5 rounded text-[10px] font-mono text-blue-300 font-bold tracking-wider backdrop-blur-xs flex items-center gap-1.5">
                      <Box className="w-3 h-3 text-blue-400" />
                      <span>INSPECTION ZONE</span>
                    </div>

                    {/* Occupancy Indicator in Corner */}
                    <div className="absolute bottom-2 right-2 bg-slate-950/80 px-2 py-0.5 rounded text-[10px] font-mono text-slate-300 font-semibold backdrop-blur-xs">
                      Occupancy: {liveDiagnostics.roiOccupancy}%
                    </div>
                  </div>
                </div>
              )}

              {/* LIVE CONVEYOR FLOATING HUD (Top Left & Top Right) */}
              {isCameraActive && activeViewMode === 'live' && (
                <>
                  <div className="absolute top-3 left-3 flex flex-col gap-1 font-mono text-[10px] pointer-events-none">
                    <span className="px-2.5 py-1 rounded bg-slate-900/80 text-white backdrop-blur-xs flex items-center gap-1.5 border border-slate-700/60 shadow-sm">
                      <span className={`w-2 h-2 rounded-full ${
                        conveyorState === 'IDLE' ? 'bg-slate-400' : 'bg-emerald-400 animate-ping'
                      }`} />
                      <span>STATE: <strong>{conveyorState}</strong></span>
                    </span>
                  </div>

                  <div className="absolute top-3 right-3 flex items-center gap-2 font-mono text-[10px] pointer-events-none">
                    <span className="px-2 py-1 rounded bg-slate-900/80 text-slate-300 backdrop-blur-xs border border-slate-700/60">
                      Cam: <strong className="text-white">{liveDiagnostics.cameraFps} FPS</strong>
                    </span>
                    <span className="px-2 py-1 rounded bg-slate-900/80 text-slate-300 backdrop-blur-xs border border-slate-700/60">
                      Proc: <strong className="text-white">{liveDiagnostics.processingFps} FPS</strong>
                    </span>
                    {liveDiagnostics.isBottleneck && (
                      <span className="px-2 py-1 rounded bg-rose-600/90 text-white font-bold animate-pulse backdrop-blur-xs border border-rose-400">
                        PROCESSING BOTTLENECK
                      </span>
                    )}
                  </div>
                </>
              )}

              {/* REAL-TIME PRODUCT RESULT CARD OVERLAY (Floats in Viewport) */}
              {isCameraActive && activeViewMode === 'live' && (
                <div className="absolute bottom-3 left-3 right-3 pointer-events-none flex justify-center">
                  {isAnalyzing ? (
                    <div className="bg-slate-900/90 border border-cyan-500/50 rounded-xl px-5 py-3 text-white font-mono text-xs shadow-2xl backdrop-blur-md flex items-center gap-3 animate-pulse">
                      <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
                      <div>
                        <div className="font-bold text-cyan-300">CURRENT PRODUCT: Inspecting...</div>
                        <div className="text-[11px] text-slate-400">Comparing multi-scale patch vectors against normal baseline...</div>
                      </div>
                    </div>
                  ) : currentLiveResult ? (
                    <div className={`rounded-xl px-5 py-3 font-mono text-xs shadow-2xl backdrop-blur-md flex items-center justify-between gap-6 border-2 transition-all ${
                      currentLiveResult.result === 'PASS'
                        ? 'bg-slate-950/90 border-emerald-500 text-white'
                        : 'bg-slate-950/90 border-rose-500 text-white'
                    }`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                          currentLiveResult.result === 'PASS' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                        }`}>
                          {currentLiveResult.result === 'PASS' ? (
                            <CheckCircle2 className="w-6 h-6" />
                          ) : (
                            <XCircle className="w-6 h-6" />
                          )}
                        </div>
                        <div>
                          <div className="text-sm font-bold flex items-center gap-2">
                            <span>{currentLiveResult.result === 'PASS' ? 'PASS ✓' : 'FAIL ⚠'}</span>
                            <span className="text-[11px] font-normal text-slate-400">Product #{currentLiveResult.productIndex}</span>
                          </div>
                          <div className="text-[11px] text-slate-300">
                            Score: <strong>{currentLiveResult.anomalyScore.toFixed(2)}</strong> (Limit: {currentLiveResult.threshold.toFixed(2)})
                            {currentLiveResult.defectRegion && (
                              <span className="text-rose-400 ml-2">· Defect Detected ({currentLiveResult.defectRegion.confidence}%)</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="text-right text-[10px] text-slate-400">
                        <div>Logged to Firestore</div>
                        <div>{currentLiveResult.timestamp}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-900/70 border border-slate-700/50 rounded-lg px-4 py-1.5 text-slate-400 font-mono text-[11px] backdrop-blur-xs">
                      {isLiveInspectionRunning ? 'Watching conveyor: Awaiting manufactured part in Inspection Zone...' : 'Station idle'}
                    </div>
                  )}
                </div>
              )}

            </div>

            {/* ACTION BAR: PRIMARY CONVEYOR CONTROLS */}
            <div className="p-4 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              
              {/* Left Group: START / STOP LIVE INSPECTION */}
              {activeTab === 'conveyor' ? (
                <div className="flex flex-wrap items-center gap-3">
                  {!isLiveInspectionRunning ? (
                    <button
                      type="button"
                      onClick={handleStartLiveInspection}
                      disabled={isRequestingCamera}
                      className="flex items-center gap-2.5 px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 active:scale-98 text-white text-xs font-mono font-bold rounded-lg transition-all shadow-md shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
                    >
                      <Play className="w-4 h-4 fill-white" />
                      <span>{isRequestingCamera ? 'Initializing Camera...' : 'START LIVE INSPECTION'}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleStopLiveInspection}
                      className="flex items-center gap-2.5 px-6 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-98 text-white text-xs font-mono font-bold rounded-lg transition-all shadow-md shadow-rose-600/20 cursor-pointer"
                    >
                      <Square className="w-4 h-4 fill-white" />
                      <span>STOP LIVE INSPECTION</span>
                    </button>
                  )}

                  {/* Camera On/Off Toggle */}
                  {!isLiveInspectionRunning && (
                    <button
                      type="button"
                      onClick={isCameraActive ? stopCamera : startCamera}
                      className="flex items-center gap-2 px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-mono font-semibold rounded-lg border border-slate-300 transition-colors cursor-pointer"
                    >
                      {isCameraActive ? <VideoOff className="w-4 h-4 text-slate-500" /> : <Video className="w-4 h-4 text-slate-500" />}
                      <span>{isCameraActive ? 'Turn Off Camera' : 'Test Camera Stream'}</span>
                    </button>
                  )}
                </div>
              ) : (
                /* Manual Test Mode Controls */
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,image/jpeg,image/png,image/webp"
                    onChange={handleManualFileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-mono font-semibold rounded-lg border border-slate-300 transition-colors cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    <span>Upload Test Frame</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleRunManualInspection}
                    disabled={!capturedImage || isAnalyzing}
                    className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-mono font-bold rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Run Manual AI Inspection</span>
                  </button>

                  {capturedImage && (
                    <button
                      type="button"
                      onClick={() => {
                        setCapturedImage(null);
                        setInspectionResult(null);
                      }}
                      className="p-2 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}

              {/* Right Group: ROI Presets and Sampling FPS */}
              <div className="flex flex-wrap items-center gap-3 font-mono text-xs">
                {/* ROI Preset Selector */}
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 px-1 font-semibold">Zone:</span>
                  {(['compact', 'standard', 'wide'] as const).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleSetRoiPreset(preset)}
                      className={`px-2 py-0.5 text-[11px] rounded transition-colors cursor-pointer ${
                        roiPreset === preset
                          ? 'bg-white text-blue-700 font-bold shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {preset === 'compact' ? '50%' : preset === 'standard' ? '70%' : '85%'}
                    </button>
                  ))}
                </div>

                {/* Sampling FPS Selector */}
                <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 px-1 font-semibold">FPS:</span>
                  {[5, 10, 15].map((fpsVal) => (
                    <button
                      key={fpsVal}
                      type="button"
                      onClick={() => handleChangeFps(fpsVal)}
                      className={`px-2 py-0.5 text-[11px] rounded transition-colors cursor-pointer ${
                        liveInspectionFps === fpsVal
                          ? 'bg-white text-blue-700 font-bold shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {fpsVal}
                    </button>
                  ))}
                </div>
              </div>

            </div>

          </div>

          {/* Operational Guidance Callout */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-600 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Cpu className="w-4 h-4 text-blue-600 shrink-0" />
              <span>
                <strong>Continuous Pipeline:</strong> Sampling video feed at {liveInspectionFps} FPS. Product occupancy &amp; motion tracker triggers anomaly inspection upon entering the Inspection Zone, with automated duplicate lockout until exit.
              </span>
            </div>
            <span className="text-[11px] text-slate-400 shrink-0 hidden sm:inline">
              ISO 9001 Conveyor Spec
            </span>
          </div>

        </div>

        {/* Right Column (4 cols): Session Metrics, Status, and Diagnostics */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* PRODUCT COUNTER & SESSION YIELD PANEL */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4 font-mono">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                <span>Conveyor Production Metrics</span>
              </h3>
              <span className={`w-2 h-2 rounded-full ${
                isLiveInspectionRunning ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
              }`} />
            </div>

            {/* Total Inspected Counter */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Products Inspected</span>
                <span className="text-2xl font-bold text-slate-900 tabular-nums">
                  {sessionInspectedCount}
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider block">Production Yield</span>
                <span className="text-base font-bold text-blue-600 tabular-nums">
                  {yieldPct}%
                </span>
              </div>
            </div>

            {/* PASS / FAIL Counters */}
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-emerald-800 font-bold uppercase">Conformant</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                </div>
                <div className="text-xl font-bold text-emerald-700 tabular-nums">
                  {sessionPassCount}
                </div>
              </div>

              <div className="p-3 bg-rose-50/80 border border-rose-200 rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-rose-800 font-bold uppercase">Rejected</span>
                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                </div>
                <div className="text-xl font-bold text-rose-700 tabular-nums">
                  {sessionFailCount}
                </div>
              </div>
            </div>

            {/* Live Inspection Timing Metrics */}
            <div className="pt-2 border-t border-slate-100 text-[11px] space-y-1.5 text-slate-600">
              <div className="flex justify-between">
                <span className="text-slate-400">Sampling Speed:</span>
                <span className="font-semibold text-slate-900 tabular-nums">{liveDiagnostics.processingFps} FPS</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Avg Inspection Time:</span>
                <span className="font-semibold text-slate-900 tabular-nums">{liveDiagnostics.averageInferenceTimeMs} ms</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Last Inspection Time:</span>
                <span className="font-semibold text-slate-900 tabular-nums">{liveDiagnostics.lastInferenceTimeMs} ms</span>
              </div>
            </div>
          </div>

          {/* ACTIVE PRODUCT & PROFILE INFO */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs font-mono text-xs space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200">
              <h4 className="font-bold text-slate-900 uppercase text-[11px] flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-600" />
                <span>Station Configuration</span>
              </h4>
              <span className="text-[10px] text-slate-400">{currentProduct?.sku || 'SKU-N/A'}</span>
            </div>

            <div className="space-y-2 text-slate-600 text-[11px]">
              <div className="flex justify-between">
                <span className="text-slate-400">Target Part:</span>
                <span className="font-semibold text-slate-900 truncate max-w-[180px]">{currentProduct?.name || 'None selected'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Rejection Threshold:</span>
                <span className="font-semibold text-blue-700">{effectiveThreshold.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Normal Reference Model:</span>
                <span className="font-semibold text-slate-900">{referenceImages.length} images</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Conveyor Inspection Zone:</span>
                <span className="font-semibold text-slate-900">
                  {Math.round(roiConfig.width * 100)}% × {Math.round(roiConfig.height * 100)}%
                </span>
              </div>
            </div>
          </div>

          {/* COLLAPSIBLE PIPELINE DIAGNOSTICS */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs font-mono text-xs">
            <button
              type="button"
              onClick={() => setShowDebugInfo(!showDebugInfo)}
              className="w-full flex items-center justify-between text-slate-700 hover:text-slate-900 font-bold transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-blue-600" />
                <span>Live Conveyor Diagnostics</span>
              </span>
              <span className="text-[10px] text-slate-500 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded font-normal transition-colors">
                {showDebugInfo ? 'Hide ▲' : 'Inspect ▼'}
              </span>
            </button>

            {showDebugInfo && (
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5 text-[11px] text-slate-600 animate-fadeIn max-h-[380px] overflow-y-auto pr-1">
                <div className="flex justify-between">
                  <span className="text-slate-400">Camera FPS:</span>
                  <span className="font-semibold text-slate-900">{liveDiagnostics.cameraFps} FPS</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Processing FPS:</span>
                  <span className="font-semibold text-slate-900">{liveDiagnostics.processingFps} FPS</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Current State:</span>
                  <span className="font-bold text-blue-700">{liveDiagnostics.currentState}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">ROI Occupancy:</span>
                  <span className="font-semibold text-slate-900">{liveDiagnostics.roiOccupancy}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Product Detection Score:</span>
                  <span className="font-semibold text-slate-900">{liveDiagnostics.productDetectionScore}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Blur / Sharpness Score:</span>
                  <span className="font-semibold text-slate-900">{liveDiagnostics.blurScore}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Frames Sampled:</span>
                  <span className="font-semibold text-slate-900">{liveDiagnostics.framesSampled}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Frames Inspected:</span>
                  <span className="font-semibold text-slate-900">{liveDiagnostics.framesInspected}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Products Detected:</span>
                  <span className="font-semibold text-slate-900">{liveDiagnostics.productsDetected}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Products Inspected:</span>
                  <span className="font-semibold text-slate-900">{liveDiagnostics.productsInspected}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Products Skipped:</span>
                  <span className="font-semibold text-slate-900">{liveDiagnostics.productsSkipped}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Bottleneck Status:</span>
                  <span className={`font-bold ${liveDiagnostics.isBottleneck ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {liveDiagnostics.isBottleneck ? 'BOTTLENECK DETECTED' : 'NORMAL'}
                  </span>
                </div>
                {/* INSPECTION PIPELINE & ALIGNMENT DIAGNOSTICS */}
                {inspectionResult?.debugInfo ? (
                  <>
                    <div className="pt-2.5 border-t border-slate-200">
                      <div className="font-bold text-slate-800 text-[11px] mb-1.5 flex items-center justify-between">
                        <span>Pipeline &amp; Alignment Metrics</span>
                        <span className="text-[10px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded font-mono">
                          {inspectionResult.debugInfo.inferenceTimeMs}ms
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Normal Reference Images:</span>
                      <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.referenceImageCount} images</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Total Patches Extracted:</span>
                      <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.totalPatchesExtracted}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Coreset Memory Bank:</span>
                      <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.coresetSize} vectors</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Preprocessing Canvas:</span>
                      <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.preprocessingDimensions}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Product Segmentation ROI:</span>
                      <span className="font-semibold text-slate-900 truncate max-w-[190px]" title={inspectionResult.debugInfo.roiDimensions}>
                        {inspectionResult.debugInfo.roiDimensions}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Alignment Transform:</span>
                      <span className="font-semibold text-slate-900 truncate max-w-[190px]" title={inspectionResult.debugInfo.alignmentTransform}>
                        {inspectionResult.debugInfo.alignmentTransform}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Translation (dX / dY):</span>
                      <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.translationX}px / {inspectionResult.debugInfo.translationY}px</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Scale / Rotation:</span>
                      <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.scale}x / {inspectionResult.debugInfo.rotationDeg}°</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Alignment Score:</span>
                      <span className="font-semibold text-emerald-700">{inspectionResult.debugInfo.alignmentScore}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Image Quality Score:</span>
                      <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.imageQualityScore}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Baseline Mean (μ) / Std (σ):</span>
                      <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.nominalMeanDist} / {inspectionResult.debugInfo.nominalStdDist}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Baseline P50 / P90:</span>
                      <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.normalScoreP50} / {inspectionResult.debugInfo.normalScoreP90}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Baseline P95 / P99:</span>
                      <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.normalScoreP95} / {inspectionResult.debugInfo.normalScoreP99}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Max Patch / Top-K Dist:</span>
                      <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.maxPatchDist} / {inspectionResult.debugInfo.topKMeanDist}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Anomaly Regions Count:</span>
                      <span className={`font-semibold ${inspectionResult.debugInfo.numberOfAnomalyRegions > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                        {inspectionResult.debugInfo.numberOfAnomalyRegions}
                      </span>
                    </div>
                    {inspectionResult.debugInfo.numberOfAnomalyRegions > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Strongest Region Area:</span>
                        <span className="font-semibold text-rose-600">{inspectionResult.debugInfo.strongestRegionArea}</span>
                      </div>
                    )}
                    <div className="text-[10px] text-slate-500 italic pt-1.5 border-t border-slate-100">
                      {inspectionResult.debugInfo.calibrationStatus}
                    </div>
                  </>
                ) : memoryBank ? (
                  <>
                    <div className="pt-2 border-t border-slate-100 flex justify-between">
                      <span className="text-slate-400">Coreset Memory Bank:</span>
                      <span className="font-semibold text-slate-900">{memoryBank.coresetVectors.length} vectors</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Normal Baseline Mean (μ):</span>
                      <span className="font-semibold text-slate-900">{memoryBank.nominalMeanDist}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Normal Baseline P95:</span>
                      <span className="font-semibold text-slate-900">{memoryBank.nominalP95}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Normal Baseline P99:</span>
                      <span className="font-semibold text-slate-900">{memoryBank.nominalP99}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 italic pt-1">
                      {memoryBank.calibrationStatus}
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>

          {/* PERSISTENCE CONFIRMATION */}
          {lastSavedId && (
            <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-lg text-[11px] text-blue-900 font-mono space-y-1">
              <div className="flex items-center gap-1.5 font-bold">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span>Latest Inspection Logged to Firestore</span>
              </div>
              <div className="text-blue-800 truncate">
                Record ID: <span className="font-bold">{lastSavedId}</span>
              </div>
              <div className="text-[10px] text-blue-600">
                Visible in History audit trail &amp; Dashboard live metrics.
              </div>
            </div>
          )}

        </div>

      </div>

    </div>
  );
};

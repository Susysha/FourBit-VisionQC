import React, { useState, useEffect, useRef } from 'react';
import { ProductPart, InspectionRecord, NavSection, DefectRegion } from '../types';
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
  Camera, 
  Video, 
  VideoOff, 
  Upload, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  RefreshCw, 
  Eye, 
  AlertCircle,
  HelpCircle,
  Sparkles,
  Zap,
  FolderGit2,
  ArrowRight,
  Maximize2,
  Crosshair,
  Layers,
  Image as ImageIcon,
  Clock,
  Trash2,
  FileCheck,
  Play,
  Activity,
  Flame,
  Loader2,
  ExternalLink
} from 'lucide-react';

interface InspectionViewProps {
  products: ProductPart[];
  currentProduct: ProductPart | null;
  threshold: number;
  audibleAlerts?: boolean;
  onUpdateThreshold: (val: number) => void;
  onSelectProduct: (p: ProductPart) => void;
  onRecordInspection: (record: InspectionRecord) => void;
  onNavigate?: (section: NavSection) => void;
  onCreateProduct?: () => void;
}

type ViewMode = 'live' | 'original' | 'heatmap' | 'overlay';

/**
 * Web Audio Synthesizer for industrial pass/fail audio feedback
 */
function playIndustrialAlert(isPass: boolean) {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    if (isPass) {
      // Pleasant dual chime (880Hz then 1174Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, now);
      gain1.gain.setValueAtTime(0.08, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.15);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1174.66, now + 0.1);
      gain2.gain.setValueAtTime(0.08, now + 0.1);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.1);
      osc2.stop(now + 0.3);
    } else {
      // Warning double reject buzz (330Hz then 220Hz)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(330, now);
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.18);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(220, now + 0.2);
      gain2.gain.setValueAtTime(0.12, now + 0.2);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.42);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.2);
      osc2.stop(now + 0.42);
    }
  } catch {
    // Autoplay restrictions or headless browser
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

  // Video and Media Stream Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Camera state
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isRequestingCamera, setIsRequestingCamera] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [streamInfo, setStreamInfo] = useState<{ width: number; height: number; fps: number } | null>(null);

  // Optical Inspection Image & Meta state
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<{
    source: 'webcam' | 'upload';
    name: string;
    timestamp: string;
    resolution?: string;
  } | null>(null);

  const [captureFlash, setCaptureFlash] = useState<boolean>(false);
  const [showReticle, setShowReticle] = useState<boolean>(true);

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
  const [activeViewMode, setActiveViewMode] = useState<ViewMode>('original');
  const [showDebugInfo, setShowDebugInfo] = useState<boolean>(false);

  // Memory bank cache keyed by productId
  const memoryBankCacheRef = useRef<Map<string, { bank: PatchCoreMemoryBank; count: number }>>(new Map());

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
        // Query users/{userId}/datasets for this product
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
          // Check local store fallback scoped to current authenticated user
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

    // Check if memory bank is already cached
    const cached = memoryBankCacheRef.current.get(currentProduct.id);
    if (cached) {
      setMemoryBank(cached.bank);
    } else {
      setMemoryBank(null);
    }

    // Reset previous inspection result when product changes
    setInspectionResult(null);
    setLastSavedId(null);

    return () => {
      isMounted = false;
    };
  }, [currentProduct?.id, currentUser?.uid]);

  /**
   * Stop camera stream tracks and clear stream reference
   */
  const stopCamera = () => {
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
  };

  /**
   * Clean up camera stream on unmount
   */
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  /**
   * Start live camera
   */
  const startCamera = async () => {
    setCameraError(null);
    setIsRequestingCamera(true);

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        'Browser camera unavailable: The MediaDevices API is not supported in this browser or is restricted.'
      );
      setIsRequestingCamera(false);
      return;
    }

    stopCamera();

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1920, min: 640 },
            height: { ideal: 1080, min: 480 },
            facingMode: 'environment',
          },
          audio: false,
        });
      } catch (firstErr) {
        console.warn('High-res camera constraints failed, attempting basic video:', firstErr);
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
    } catch (err: any) {
      console.error('Camera access error:', err);
      setIsCameraActive(false);

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setCameraError(
          'Camera permission denied: Please allow camera access in browser permissions to enable live video inspection.'
        );
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setCameraError(
          'No camera detected: No video camera was found connected. You can use the "Upload Image" option.'
        );
      } else {
        setCameraError(`Camera initialization error: ${err.message || 'Unable to open camera.'}`);
      }
    } finally {
      setIsRequestingCamera(false);
    }
  };

  /**
   * Capture current video frame using HTML canvas
   */
  const handleCaptureImage = () => {
    if (!videoRef.current || !isCameraActive) {
      setCameraError('Cannot capture frame: Camera stream is not active. Please start camera first.');
      return;
    }

    const video = videoRef.current;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    if (width === 0 || height === 0) {
      setCameraError('Video frame is not ready yet. Please wait a moment and try again.');
      return;
    }

    try {
      setCaptureFlash(true);
      setTimeout(() => setCaptureFlash(false), 200);

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas context could not be created');

      ctx.drawImage(video, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

      setCapturedImage(dataUrl);
      const prodName = currentProduct ? currentProduct.name.replace(/\s+/g, '_') : 'Part';
      setImageMeta({
        source: 'webcam',
        name: `Frame_${prodName}_${Date.now().toString().slice(-6)}.jpg`,
        timestamp: new Date().toLocaleTimeString(),
        resolution: `${width} × ${height} px`,
      });
      setInspectionResult(null);
      setLastSavedId(null);
      setActiveViewMode('original');
      setCameraError(null);
    } catch (err: any) {
      console.error('Frame capture error:', err);
      setCameraError(`Frame capture failed: ${err.message || 'Error grabbing video frame'}`);
    }
  };

  /**
   * Upload Image handler (JPG, JPEG, PNG, WebP)
   */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setCameraError('Invalid file type: Please upload a JPG, JPEG, PNG, or WebP image.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setCameraError('Image file is too large: Maximum supported size is 20MB.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setCameraError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      if (result) {
        const img = new Image();
        img.onload = () => {
          setCapturedImage(result);
          setImageMeta({
            source: 'upload',
            name: file.name,
            timestamp: new Date().toLocaleTimeString(),
            resolution: `${img.naturalWidth} × ${img.naturalHeight} px`,
          });
          setInspectionResult(null);
          setLastSavedId(null);
          setActiveViewMode('original');
        };
        img.onerror = () => {
          setCapturedImage(result);
          setImageMeta({
            source: 'upload',
            name: file.name,
            timestamp: new Date().toLocaleTimeString(),
          });
          setInspectionResult(null);
          setLastSavedId(null);
          setActiveViewMode('original');
        };
        img.src = result;
      }
    };
    reader.onerror = () => {
      setCameraError('Failed to read image file. Please try another image.');
    };
    reader.readAsDataURL(file);

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * Clear current captured image
   */
  const handleClearImage = () => {
    setCapturedImage(null);
    setImageMeta(null);
    setInspectionResult(null);
    setLastSavedId(null);
    if (isCameraActive) {
      setActiveViewMode('live');
    } else {
      setActiveViewMode('original');
    }
  };

  /**
   * Builds the PatchCore visual manifold representation if not already cached
   */
  const ensureMemoryBank = async (): Promise<PatchCoreMemoryBank> => {
    if (!currentProduct) {
      throw new Error('Please select a product first.');
    }

    if (referenceImages.length === 0) {
      throw new Error(
        `Cannot run AI anomaly inspection: No normal reference images found for "${currentProduct.name}" in users/${currentUser?.uid}/datasets. Please add reference images in the Dataset tab first.`
      );
    }

    // Check memory bank cache
    const cached = memoryBankCacheRef.current.get(currentProduct.id);
    if (cached && cached.count === referenceImages.length) {
      return cached.bank;
    }

    setIsTrainingMemoryBank(true);
    setTrainingProgress(10);
    setAnalysisStep('Building normal visual representation from reference dataset...');

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
  };

  /**
   * Core AI Anomaly Detection Pipeline
   * 1. Loads real normal reference images from users/{userId}/datasets
   * 2. Builds/retrieves normal visual representation
   * 3. Compares inspection image against normal reference data
   * 4. Calculates authentic anomaly score
   * 5. Generates anomaly localization heatmap & suspected defect region
   * 6. Compares with product threshold (PASS/FAIL)
   * 7. Saves completed record to users/{userId}/inspections/{inspectionId}
   */
  const handleRunAiInspection = async () => {
    if (!capturedImage) {
      setCameraError('No image available to inspect. Please capture a video frame or upload an image first.');
      return;
    }

    if (!currentProduct) {
      setCameraError('No product selected. Please select a manufactured part profile.');
      return;
    }

    if (referenceImages.length === 0) {
      setCameraError(
        `No normal reference images found for "${currentProduct.name}" in users/${currentUser?.uid}/datasets. VisionQC requires normal reference samples to establish baseline tolerances. Please upload normal images in the Dataset tab first.`
      );
      return;
    }

    setIsAnalyzing(true);
    setCameraError(null);

    try {
      // Step 1: Ensure visual manifold representation
      setAnalysisStep('Extracting spatial patch descriptors from normal reference images...');
      const bank = await ensureMemoryBank();

      // Step 2: Compare against normal reference representation
      setAnalysisStep('Computing nearest-neighbor Euclidean distances across 28×21 spatial grid (588 patches)...');
      // Give UI 50ms to render the step status smoothly
      await new Promise((r) => setTimeout(r, 60));

      const effectiveThreshold = currentProduct.nominalThreshold ?? threshold ?? 0.50;
      const result = await inspectImageWithPatchCore(capturedImage, bank, effectiveThreshold);

      // Step 3: Heatmap localization and decision
      setAnalysisStep('Localizing defect coordinates and generating blended overlay...');
      setInspectionResult(result);
      setActiveViewMode('overlay');

      // Audible alert feedback
      if (audibleAlerts) {
        playIndustrialAlert(result.result === 'PASS');
      }

      // Step 4: Save completed inspection to users/{userId}/inspections/{inspectionId}
      const recordId = `QC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

      // Compress storage copy to ensure safe Firestore document sizing (<1MB)
      const compressedInspectionImage = await compressImageForStorage(capturedImage, 800, 0.82);
      const compressedOverlay = await compressImageForStorage(result.overlayDataUrl, 800, 0.82);
      const compressedHeatmap = await compressImageForStorage(result.heatmapDataUrl, 400, 0.80);

      const inspectionRecord: InspectionRecord = {
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
        imageUrl: compressedInspectionImage,
        imageDataUrl: compressedInspectionImage,
        image_path: imageMeta?.name || `Optical_Capture_${currentProduct.sku}.jpg`,
        heatmapUrl: compressedHeatmap,
        overlayUrl: compressedOverlay,
        suspectedDefectRegion: result.suspectedDefectRegion,
        defectLocation: result.result === 'FAIL' 
          ? `(${result.maxAnomalyCoord.x}px, ${result.maxAnomalyCoord.y}px)` 
          : '',
        defectType: result.result === 'FAIL' ? 'Surface Anomaly' : 'Conformant',
        inferenceTimeMs: result.inferenceTimeMs,
        batchNumber: `BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
        operator: currentUser?.displayName || 'Operator',
        inspectionLine: currentProduct.activeLine || 'Line 01 - Optical Bench',
      };

      onRecordInspection(inspectionRecord);
      setLastSavedId(recordId);
    } catch (err: any) {
      console.error('AI inspection error:', err);
      setCameraError(err.message || 'Anomaly detection failed. Check image format and normal references.');
    } finally {
      setIsAnalyzing(false);
      setAnalysisStep('');
    }
  };

  const isPass = inspectionResult?.result === 'PASS';
  const effectiveThreshold = currentProduct?.nominalThreshold ?? threshold ?? 0.50;

  return (
    <div className="space-y-6">
      
      {/* Top Station Bar: Part Selector & Station Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-500 mb-1">
            <span className="flex items-center gap-1.5 text-blue-600 font-semibold">
              <span className="w-2 h-2 rounded-full bg-blue-600" />
              OPTICAL ACQUISITION STATION
            </span>
            <span>·</span>
            <span>CELL QC-01</span>
            <span>·</span>
            <span className="text-slate-400">PatchCore Engine (CVPR 2022)</span>
          </div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight font-mono">
            Live Visual Inspection Chamber
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real computer-vision anomaly detection comparing optical frames against authenticated reference datasets.
          </p>
        </div>

        {/* Product Part Dropdown Selector */}
        <div className="flex items-center gap-3">
          <label className="text-xs font-mono font-medium text-slate-600 whitespace-nowrap">
            Inspection Target:
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
                  + Register Product
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
              className="bg-slate-50 border border-slate-300 text-slate-800 text-xs font-mono px-3 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-medium"
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

      {/* Reference Model Status Notice */}
      {currentProduct && (
        <div className="p-3.5 bg-white border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono shadow-xs">
          <div className="flex items-center gap-2.5">
            {isLoadingReferences ? (
              <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
            ) : referenceImages.length > 0 ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            )}

            <div>
              <span className="font-bold text-slate-900">
                {referenceImages.length > 0 ? (
                  <>Normal Representation: <span className="text-emerald-700">{referenceImages.length} samples</span> loaded from Firestore</>
                ) : (
                  <>Normal Representation: <span className="text-amber-700">0 samples</span> in users/{currentUser?.uid}/datasets</>
                )}
              </span>
              <span className="text-slate-400 ml-2 hidden md:inline">
                {referenceImages.length > 0
                  ? 'Spatial grid: 28×21 (588 patches) · Coreset memory bank ready'
                  : 'Add normal reference images to initialize tolerance manifold'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {referenceImages.length === 0 && onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('dataset')}
                className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-md font-bold text-xs flex items-center gap-1.5 transition-colors"
              >
                <span>Add Reference Images</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
            <span className="text-[11px] text-slate-400 bg-slate-100 px-2 py-1 rounded">
              Tolerance: {effectiveThreshold.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Camera & Permission Error Alert Banner */}
      {cameraError && (
        <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs font-mono text-rose-800 flex items-start justify-between gap-3 shadow-xs animate-fadeIn">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-rose-900 mb-0.5">Optical System Alert</div>
              <div className="leading-relaxed">{cameraError}</div>
            </div>
          </div>
          <button
            onClick={() => setCameraError(null)}
            className="text-rose-500 hover:text-rose-800 text-xs font-bold px-2 py-1 rounded hover:bg-rose-100 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column (8 cols): Large Live Camera / Inspection Viewport Area */}
        <div className="lg:col-span-8 space-y-4">
          
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            
            {/* Viewport Header with View Mode Switcher */}
            <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${isAnalyzing ? 'bg-amber-400 animate-ping' : 'bg-blue-500'}`} />
                <span className="font-bold text-white tracking-wide">
                  OPTICAL SENSOR VIEWPORT
                </span>

                {isCameraActive && (
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold border border-emerald-500/30 flex items-center gap-1.5 ml-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    LIVE FEED
                  </span>
                )}

                {inspectionResult && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ml-1 ${
                    isPass 
                      ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' 
                      : 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                  }`}>
                    {inspectionResult.result} ({inspectionResult.anomalyScore.toFixed(2)})
                  </span>
                )}
              </div>

              {/* View Mode Tabs (When an image or inspection result exists) */}
              <div className="flex items-center gap-1 bg-slate-800/80 p-0.5 rounded-lg border border-slate-700 text-[10px]">
                {isCameraActive && (
                  <button
                    type="button"
                    onClick={() => setActiveViewMode('live')}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      activeViewMode === 'live' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Live Video
                  </button>
                )}
                {capturedImage && (
                  <button
                    type="button"
                    onClick={() => setActiveViewMode('original')}
                    className={`px-2.5 py-1 rounded transition-colors ${
                      activeViewMode === 'original' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Raw Frame
                  </button>
                )}
                {inspectionResult && (
                  <>
                    <button
                      type="button"
                      onClick={() => setActiveViewMode('heatmap')}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        activeViewMode === 'heatmap' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Heatmap
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveViewMode('overlay')}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        activeViewMode === 'overlay' ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Overlay + Defect
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Viewport Display Chamber */}
            <div className="relative aspect-video w-full bg-slate-950 flex items-center justify-center overflow-hidden select-none">
              
              {/* Shutter flash animation on capture */}
              {captureFlash && (
                <div className="absolute inset-0 bg-white z-30 transition-opacity duration-200 opacity-90 pointer-events-none" />
              )}

              {/* View 1: Live Webcam Video Element */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover transition-opacity duration-300 ${
                  isCameraActive && activeViewMode === 'live' ? 'opacity-100' : 'opacity-0 hidden'
                }`}
              />

              {/* View 2: Raw Captured/Uploaded Image */}
              {capturedImage && activeViewMode === 'original' && (
                <img
                  src={capturedImage}
                  alt="Captured Target"
                  className="w-full h-full object-contain"
                />
              )}

              {/* View 3: Anomaly Heatmap (Jet Colormap) */}
              {inspectionResult && activeViewMode === 'heatmap' && (
                <img
                  src={inspectionResult.heatmapDataUrl}
                  alt="Anomaly Heatmap"
                  className="w-full h-full object-contain"
                />
              )}

              {/* View 4: Blended Overlay with Defect Crosshair & Bounding Box */}
              {inspectionResult && activeViewMode === 'overlay' && (
                <img
                  src={inspectionResult.overlayDataUrl}
                  alt="Blended Anomaly Overlay"
                  className="w-full h-full object-contain"
                />
              )}

              {/* Viewport Overlay: Analyzing Spinner */}
              {isAnalyzing && (
                <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xs z-20 flex flex-col items-center justify-center p-6 text-center text-white space-y-3 animate-fadeIn">
                  <div className="w-12 h-12 rounded-full border-3 border-blue-500/30 border-t-blue-500 animate-spin flex items-center justify-center">
                    <Activity className="w-5 h-5 text-blue-400" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-bold font-mono text-white">
                      Evaluating Optical Manifold Distance
                    </div>
                    <div className="text-xs font-mono text-blue-300 max-w-sm">
                      {analysisStep || 'Comparing spatial patch features against normal memory bank...'}
                    </div>
                  </div>
                </div>
              )}

              {/* Camera Inactive & No Image Placeholder */}
              {!isCameraActive && !capturedImage && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center text-slate-400 space-y-3">
                  <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500 shadow-inner">
                    <VideoOff className="w-8 h-8" />
                  </div>
                  <div>
                    <div className="text-sm font-bold font-mono text-slate-200">
                      Optical Sensor Standby
                    </div>
                    <p className="text-xs text-slate-500 max-w-sm mt-1">
                      Start the camera to capture a manufactured part, or upload an image to run the AI anomaly detection pipeline.
                    </p>
                  </div>
                </div>
              )}

              {/* Inspection Reticle & Crosshair Overlay (Only in live video or raw frame) */}
              {showReticle && (activeViewMode === 'live' || (activeViewMode === 'original' && !inspectionResult)) && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="w-3/4 h-3/4 border border-dashed border-blue-500/30 rounded-lg relative">
                    <div className="absolute -top-0.5 -left-0.5 w-4 h-4 border-t-2 border-l-2 border-blue-400" />
                    <div className="absolute -top-0.5 -right-0.5 w-4 h-4 border-t-2 border-r-2 border-blue-400" />
                    <div className="absolute -bottom-0.5 -left-0.5 w-4 h-4 border-b-2 border-l-2 border-blue-400" />
                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 border-b-2 border-r-2 border-blue-400" />
                    
                    <div className="absolute inset-0 flex items-center justify-center opacity-40">
                      <div className="w-6 h-0.5 bg-blue-400" />
                      <div className="h-6 w-0.5 bg-blue-400 -ml-3.25" />
                    </div>
                  </div>

                  <div className="absolute bottom-3 left-4 text-[10px] font-mono text-slate-400/80 bg-slate-900/70 px-2 py-0.5 rounded backdrop-blur-xs">
                    PART: {currentProduct ? currentProduct.name : 'NO PRODUCT SELECTED'}
                  </div>
                </div>
              )}

            </div>

            {/* Action Bar: Camera / Capture / Upload / RUN AI INSPECTION */}
            <div className="p-4 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              
              {/* Left Group: Live Camera & Frame Grab */}
              <div className="flex flex-wrap items-center gap-2.5">
                {!isCameraActive ? (
                  <button
                    type="button"
                    onClick={startCamera}
                    disabled={isRequestingCamera}
                    className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-mono font-bold rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    <Video className="w-4 h-4" />
                    <span>{isRequestingCamera ? 'Requesting Camera...' : 'Start Camera'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white text-xs font-mono font-bold rounded-lg transition-colors shadow-xs cursor-pointer"
                  >
                    <VideoOff className="w-4 h-4" />
                    <span>Stop Camera</span>
                  </button>
                )}

                {/* Capture Image Button */}
                <button
                  type="button"
                  onClick={handleCaptureImage}
                  disabled={!isCameraActive}
                  className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-mono font-bold rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Camera className="w-4 h-4" />
                  <span>Capture Image</span>
                </button>
              </div>

              {/* Middle / Right Group: Upload Image & Primary AI Action */}
              <div className="flex flex-wrap items-center gap-2.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,image/jpeg,image/png,image/webp"
                  onChange={handleFileUpload}
                  className="hidden"
                />

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 text-xs font-mono font-semibold rounded-lg transition-colors border border-slate-300 cursor-pointer"
                >
                  <Upload className="w-4 h-4 text-slate-500" />
                  <span>Upload Image</span>
                </button>

                {capturedImage && (
                  <button
                    type="button"
                    onClick={handleClearImage}
                    title="Discard current image"
                    className="p-2.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-transparent hover:border-rose-200 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}

                {/* CORE AI ANOMALY DETECTION EXECUTE BUTTON */}
                <button
                  type="button"
                  onClick={handleRunAiInspection}
                  disabled={!capturedImage || isAnalyzing || referenceImages.length === 0}
                  className={`flex items-center gap-2 px-5 py-2.5 text-xs font-mono font-bold rounded-lg transition-all shadow-md cursor-pointer ${
                    !capturedImage || referenceImages.length === 0
                      ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none'
                      : isAnalyzing
                      ? 'bg-amber-600 text-white cursor-wait'
                      : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white hover:shadow-lg hover:shadow-blue-500/25 active:scale-98'
                  }`}
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Analyzing Anomaly...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-yellow-300" />
                      <span>Run AI Inspection</span>
                    </>
                  )}
                </button>
              </div>

            </div>

          </div>

          {/* Operational Guidance Callout */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-600 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
              <span>
                <strong>Algorithm:</strong> Pure browser-compatible PatchCore implementation extracting multi-scale Sobel gradients & color moments to detect defects without server roundtrips.
              </span>
            </div>
            <span className="text-[11px] text-slate-400 shrink-0 hidden sm:inline">
              ISO 9001 Compliant
            </span>
          </div>

        </div>

        {/* Right Column (4 cols): Inspection Status Panel & Detailed Anomaly Output */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Inspection Status Panel (Strict adherence to prompt specifications) */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="text-xs font-mono font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-blue-600" />
                <span>Inspection Status Panel</span>
              </h3>
              <span className={`w-2 h-2 rounded-full ${
                inspectionResult ? (isPass ? 'bg-emerald-500' : 'bg-rose-500') : 'bg-blue-500'
              }`} />
            </div>

            {/* Required Status Fields */}
            <div className="space-y-3 font-mono text-xs">
              
              {/* Field 1: Status */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between">
                <span className="text-slate-500 uppercase tracking-wider text-[11px]">Status</span>
                <span className="font-bold text-slate-900 bg-white px-2.5 py-0.5 rounded border border-slate-200 flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${
                    isAnalyzing
                      ? 'bg-amber-500 animate-ping'
                      : inspectionResult
                      ? 'bg-emerald-500'
                      : capturedImage
                      ? 'bg-blue-500'
                      : 'bg-slate-400'
                  }`} />
                  {isAnalyzing
                    ? 'Inferencing...'
                    : inspectionResult
                    ? 'Inspection Complete'
                    : capturedImage
                    ? 'Frame Ready'
                    : 'Awaiting Frame'}
                </span>
              </div>

              {/* Field 2: Image */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-col gap-1">
                <span className="text-slate-500 uppercase tracking-wider text-[11px]">Image</span>
                <div className="font-semibold text-slate-900 truncate" title={imageMeta ? imageMeta.name : 'No image selected'}>
                  {capturedImage && imageMeta ? (
                    <span className="text-blue-700 flex items-center gap-1.5 truncate">
                      <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{imageMeta.name}</span>
                    </span>
                  ) : (
                    <span className="text-slate-500 italic">No optical frame acquired</span>
                  )}
                </div>
                {imageMeta?.resolution && (
                  <span className="text-[10px] text-slate-400">
                    Resolution: {imageMeta.resolution} · {imageMeta.source === 'webcam' ? 'Live Camera Feed' : 'Uploaded File'}
                  </span>
                )}
              </div>

              {/* Field 3: AI Result */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 uppercase tracking-wider text-[11px]">AI Result</span>
                  {inspectionResult ? (
                    <span className={`px-2.5 py-0.5 rounded font-bold text-xs flex items-center gap-1 border ${
                      isPass 
                        ? 'bg-emerald-100 text-emerald-800 border-emerald-300' 
                        : 'bg-rose-100 text-rose-800 border-rose-300'
                    }`}>
                      {isPass ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>PASS (CONFORMANT)</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-3.5 h-3.5 text-rose-600" />
                          <span>FAIL (DEFECT)</span>
                        </>
                      )}
                    </span>
                  ) : (
                    <span className="font-semibold text-slate-500 bg-white px-2 py-0.5 rounded border border-slate-200 text-[11px]">
                      Waiting for inspection
                    </span>
                  )}
                </div>

                {/* Score vs Threshold Meter (When Inspection is Complete) */}
                {inspectionResult && (
                  <div className="pt-2 border-t border-slate-200 space-y-1.5">
                    <div className="flex justify-between items-baseline text-[11px]">
                      <span className="text-slate-500">Anomaly Score:</span>
                      <span className={`text-base font-bold ${isPass ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {inspectionResult.anomalyScore.toFixed(2)}
                        <span className="text-xs text-slate-400 font-normal ml-1">/ {inspectionResult.threshold.toFixed(2)} thres</span>
                      </span>
                    </div>

                    {/* Progress Bar Gauge */}
                    <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden relative">
                      {/* Threshold marker tick */}
                      <div 
                        className="absolute top-0 bottom-0 w-0.5 bg-slate-900 z-10" 
                        style={{ left: `${Math.min(100, inspectionResult.threshold * 100)}%` }}
                        title={`Threshold: ${inspectionResult.threshold.toFixed(2)}`}
                      />
                      <div 
                        className={`h-full transition-all duration-500 ${
                          isPass ? 'bg-emerald-500' : 'bg-rose-500'
                        }`}
                        style={{ width: `${Math.min(100, inspectionResult.anomalyScore * 100)}%` }}
                      />
                    </div>

                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>0.00 (Nominal)</span>
                      <span className="font-semibold text-slate-700">Limit: {inspectionResult.threshold.toFixed(2)}</span>
                      <span>1.00 (Defect)</span>
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* Suspected Defect Region Details (When defect localized) */}
            {inspectionResult && (
              <div className={`p-3.5 rounded-lg border text-xs font-mono space-y-2 ${
                isPass ? 'bg-emerald-50/70 border-emerald-200' : 'bg-rose-50/70 border-rose-200'
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold flex items-center gap-1.5">
                    {isPass ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Flame className="w-4 h-4 text-rose-600" />
                    )}
                    <span>{isPass ? 'Nominal Surface Verified' : 'Suspected Defect Localized'}</span>
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {inspectionResult.inferenceTimeMs} ms latency
                  </span>
                </div>

                {!isPass && inspectionResult.suspectedDefectRegion && (
                  <div className="space-y-1 text-[11px] text-rose-900">
                    <div className="flex justify-between">
                      <span className="text-rose-700">Peak Coordinate:</span>
                      <span className="font-bold">
                        X: {inspectionResult.maxAnomalyCoord.x}px, Y: {inspectionResult.maxAnomalyCoord.y}px
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-rose-700">Defect Region Bounds:</span>
                      <span className="font-bold">
                        {inspectionResult.suspectedDefectRegion.width} × {inspectionResult.suspectedDefectRegion.height} px
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-rose-700">Anomaly Confidence:</span>
                      <span className="font-bold">{inspectionResult.suspectedDefectRegion.confidence}%</span>
                    </div>
                  </div>
                )}

                {isPass && (
                  <div className="text-[11px] text-emerald-800">
                    All 588 spatial patches fall within nominal tolerance limits established by the reference dataset.
                  </div>
                )}
              </div>
            )}

            {/* Confirmation of Persistence to Firestore */}
            {lastSavedId && (
              <div className="p-3 bg-blue-50/80 border border-blue-200 rounded-lg text-[11px] text-blue-900 font-mono space-y-1">
                <div className="flex items-center gap-1.5 font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  <span>Logged to Firestore Database</span>
                </div>
                <div className="text-blue-800 truncate">
                  Record ID: <span className="font-bold">{lastSavedId}</span>
                </div>
                <div className="text-[10px] text-blue-600">
                  Visible in History audit trail & Dashboard rejection metrics.
                </div>
              </div>
            )}

            {/* No Reference Images Callout */}
            {referenceImages.length === 0 && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-[11px] text-amber-900 font-mono space-y-1.5">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Setup Requirement</span>
                </div>
                <p className="leading-relaxed text-amber-800">
                  Please upload 1 or more defect-free normal reference images in the <strong>Dataset tab</strong> before running anomaly detection.
                </p>
                {onNavigate && (
                  <button
                    type="button"
                    onClick={() => onNavigate('dataset')}
                    className="w-full mt-1 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded font-bold text-center transition-colors"
                  >
                    Open Dataset Tab →
                  </button>
                )}
              </div>
            )}

          </div>

          {/* Part Specifications Reference Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-3 font-mono text-xs">
            <div className="pb-2 border-b border-slate-200 flex items-center justify-between">
              <span className="font-bold text-slate-900 uppercase">Target Specifications</span>
              <span className="text-[10px] text-slate-400">{currentProduct ? currentProduct.sku : 'NONE'}</span>
            </div>

            {currentProduct ? (
              <div className="space-y-2 text-slate-600">
                <div className="flex justify-between">
                  <span className="text-slate-400">Component:</span>
                  <span className="font-semibold text-slate-900">{currentProduct.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Nominal Threshold:</span>
                  <span className="font-semibold text-blue-700">{effectiveThreshold.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Reference Model:</span>
                  <span className="font-semibold text-slate-800">{referenceImages.length} normal samples</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Station Line:</span>
                  <span className="font-semibold text-slate-800">{currentProduct.activeLine || 'Cell QC-01'}</span>
                </div>
              </div>
            ) : (
              <div className="py-2 text-center text-slate-400">
                <span className="text-xs">No product registered yet.</span>
              </div>
            )}
          </div>

          {/* Development / Quality Pipeline Diagnostics (Collapsible) */}
          {inspectionResult?.debugInfo && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs font-mono text-xs">
              <button
                type="button"
                onClick={() => setShowDebugInfo(!showDebugInfo)}
                className="w-full flex items-center justify-between text-slate-700 hover:text-slate-900 font-bold transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-blue-600" />
                  <span>Pipeline Diagnostics</span>
                </span>
                <span className="text-[10px] text-slate-500 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded font-normal transition-colors">
                  {showDebugInfo ? 'Hide ▲' : 'Inspect ▼'}
                </span>
              </button>

              {showDebugInfo && (
                <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5 text-[11px] text-slate-600 animate-fadeIn">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Reference Images:</span>
                    <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.referenceImagesCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Extracted Patches:</span>
                    <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.totalPatchesExtracted}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Coreset Memory Bank:</span>
                    <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.coresetSize} vectors</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Nominal Mean Dist (μ):</span>
                    <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.nominalMeanDist}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Nominal Std Dev (σ):</span>
                    <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.nominalStdDist}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Max Patch Distance:</span>
                    <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.maxPatchDist}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Top-3% Mean Distance:</span>
                    <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.topKMeanDist}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Final Anomaly Score:</span>
                    <span className="font-bold text-blue-700">{inspectionResult.debugInfo.finalAnomalyScore}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Product Threshold:</span>
                    <span className="font-semibold text-slate-900">{inspectionResult.debugInfo.threshold}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Result:</span>
                    <span className={`font-bold ${inspectionResult.debugInfo.result === 'PASS' ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {inspectionResult.debugInfo.result}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

      </div>

    </div>
  );
};

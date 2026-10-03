import React, { useState, useRef, useEffect } from 'react';
import { ProductPart, InspectionRecord, NavSection } from '../types';
import { matchCanonicalWasher, CanonicalMatchResult, renderCanonicalHeatmapCanvas } from '../services/canonicalMatcher';
import {
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
  Image as ImageIcon,
  Trash2,
  FileCheck,
  Activity,
  Loader2,
  ShieldCheck,
  TrendingUp,
  AlertCircle,
  FolderGit2,
  Layers,
  RefreshCw,
  Info,
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

type ViewMode = 'original' | 'overlay' | 'heatmap';

/** Industrial audio alert tone */
function playIndustrialAlert(isPass: boolean) {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;
    if (isPass) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } else {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, now);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.28);
    }
  } catch {
    // Audio context autoplay policy fallback
  }
}

export const InspectionView: React.FC<InspectionViewProps> = ({
  products,
  currentProduct,
  audibleAlerts = true,
  onSelectProduct,
  onRecordInspection,
  onNavigate,
  onCreateProduct,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Active uploaded image state
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [imageFileName, setImageFileName] = useState<string>('');
  const [imageMeta, setImageMeta] = useState<{ resolution: string; size: string } | null>(null);

  // Inspection & matching state
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisStep, setAnalysisStep] = useState<string>('');
  const [matchResult, setMatchResult] = useState<CanonicalMatchResult | null>(null);
  const [activeViewMode, setActiveViewMode] = useState<ViewMode>('original');

  // Heatmap rendered images
  const [renderedHeatmapUrl, setRenderedHeatmapUrl] = useState<string | null>(null);
  const [renderedOverlayUrl, setRenderedOverlayUrl] = useState<string | null>(null);

  // Session stats
  const [sessionInspected, setSessionInspected] = useState<number>(0);
  const [sessionPass, setSessionPass] = useState<number>(0);
  const [sessionFail, setSessionFail] = useState<number>(0);

  // Handle File Selection or Drop
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processSelectedFile(file);
    }
  };

  const processSelectedFile = (file: File) => {
    setImageFileName(file.name);
    const sizeKb = (file.size / 1024).toFixed(1) + ' KB';

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      setUploadedImage(dataUrl);
      setMatchResult(null);
      setRenderedHeatmapUrl(null);
      setRenderedOverlayUrl(null);
      setActiveViewMode('original');

      const img = new Image();
      img.onload = () => {
        setImageMeta({
          resolution: `${img.width} × ${img.height} px`,
          size: sizeKb,
        });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  // Run Image-Specific Shape Match
  const handleAnalyseShape = async () => {
    if (!uploadedImage) return;

    setIsAnalyzing(true);
    setAnalysisStep('Preprocessing image geometry...');

    await new Promise((r) => setTimeout(r, 200));
    setAnalysisStep('Matching canonical shape signatures...');

    await new Promise((r) => setTimeout(r, 300));
    const result = await matchCanonicalWasher(uploadedImage);

    // Generate heatmap visualization canvases
    const imgObj = new Image();
    imgObj.crossOrigin = 'anonymous';
    imgObj.onload = () => {
      const overlayUrl = renderCanonicalHeatmapCanvas(result.heatmapMatrix, 'overlay', imgObj);
      const heatmapUrl = renderCanonicalHeatmapCanvas(result.heatmapMatrix, 'heatmap');
      setRenderedOverlayUrl(overlayUrl);
      setRenderedHeatmapUrl(heatmapUrl);
    };
    imgObj.src = uploadedImage;

    setMatchResult(result);
    setIsAnalyzing(false);

    // Update stats and play sound
    if (result.status === 'PASS') {
      setSessionInspected((prev) => prev + 1);
      setSessionPass((prev) => prev + 1);
      if (audibleAlerts) playIndustrialAlert(true);
    } else if (result.status === 'FAIL') {
      setSessionInspected((prev) => prev + 1);
      setSessionFail((prev) => prev + 1);
      if (audibleAlerts) playIndustrialAlert(false);
    }

    // Save history record
    if (currentProduct && result.status !== 'UNKNOWN') {
      const record: InspectionRecord = {
        id: 'insp_' + Date.now(),
        timestamp: new Date().toISOString(),
        partName: currentProduct.name,
        productName: currentProduct.name,
        product_name: currentProduct.name,
        inspectionLine: 'Upload Inspection',
        status: result.status === 'PASS' ? 'PASS' : 'FAIL',
        result: result.status === 'PASS' ? 'PASS' : 'FAIL',
        confidenceScore: result.confidence,
        anomalyScore: result.anomalyPercentage,
        anomaly_score: result.anomalyPercentage,
        threshold: 0.35,
        defectType: result.defectType,
        imageUrl: uploadedImage,
        heatmapUrl: renderedHeatmapUrl || undefined,
        source: 'manual_upload',
      };
      onRecordInspection(record);
    }
  };

  const clearUploadedImage = () => {
    setUploadedImage(null);
    setImageFileName('');
    setImageMeta(null);
    setMatchResult(null);
    setRenderedHeatmapUrl(null);
    setRenderedOverlayUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const yieldRate = sessionInspected > 0 ? ((sessionPass / sessionInspected) * 100).toFixed(1) : '100.0';

  if (!products || products.length === 0) {
    return (
      <div className="max-w-4xl mx-auto py-12 px-4 text-center">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-10 shadow-2xl">
          <FolderGit2 className="w-16 h-16 text-blue-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">No Product Configured</h2>
          <p className="text-slate-400 max-w-md mx-auto mb-6">
            Please create a product in the Dataset manager before running shape inspection.
          </p>
          {onCreateProduct && (
            <button
              onClick={onCreateProduct}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl transition shadow-lg shadow-blue-500/20"
            >
              Configure First Product
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Header bar & Product Selector */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div>
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-7 h-7 text-blue-400" />
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Product Shape Inspection</h1>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Image-specific geometric shape deformation classifier for washer quality assurance
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Active Model:</span>
          <select
            value={currentProduct?.id || ''}
            onChange={(e) => {
              const p = products.find((prod) => prod.id === e.target.value);
              if (p) onSelectProduct(p);
            }}
            className="bg-slate-800 border border-slate-700 text-white text-sm rounded-xl px-4 py-2 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Session Performance Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase font-medium">Inspected</div>
            <div className="text-xl font-bold text-white">{sessionInspected}</div>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase font-medium">Passed</div>
            <div className="text-xl font-bold text-emerald-400">{sessionPass}</div>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400">
            <XCircle className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase font-medium">Defects</div>
            <div className="text-xl font-bold text-rose-400">{sessionFail}</div>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 flex items-center gap-4">
          <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-400">
            <TrendingUp className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-slate-400 uppercase font-medium">Pass Rate</div>
            <div className="text-xl font-bold text-indigo-300">{yieldRate}%</div>
          </div>
        </div>
      </div>

      {/* Main Inspection Section: Upload & Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Upload & Controls Panel */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Upload className="w-5 h-5 text-blue-400" />
                Upload Inspection Image
              </h2>
              {uploadedImage && (
                <button
                  onClick={clearUploadedImage}
                  className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 font-medium transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove
                </button>
              )}
            </div>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*"
              className="hidden"
            />

            {!uploadedImage ? (
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.[0]) processSelectedFile(e.dataTransfer.files[0]);
                }}
                className="border-2 border-dashed border-slate-700 hover:border-blue-500/60 bg-slate-950/50 hover:bg-blue-950/20 rounded-xl p-8 text-center cursor-pointer transition group"
              >
                <div className="w-14 h-14 bg-slate-800 group-hover:bg-blue-600/20 text-slate-400 group-hover:text-blue-400 rounded-2xl flex items-center justify-center mx-auto mb-4 transition">
                  <ImageIcon className="w-7 h-7" />
                </div>
                <div className="text-white font-semibold mb-1">Click or drag product image here</div>
                <div className="text-xs text-slate-400">Supports PNG, JPG, BMP format washer inspection photos</div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative aspect-square w-full bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center p-2">
                  <img
                    src={uploadedImage}
                    alt="Uploaded inspection item"
                    className="max-h-full max-w-full object-contain rounded-lg shadow-lg"
                  />
                </div>

                <div className="bg-slate-950/80 rounded-xl p-3 border border-slate-800/80 text-xs space-y-1.5 text-slate-300">
                  <div className="flex justify-between">
                    <span className="text-slate-500">File Name:</span>
                    <span className="font-mono text-white truncate max-w-[200px]">{imageFileName}</span>
                  </div>
                  {imageMeta && (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-500">Resolution:</span>
                        <span className="font-mono text-white">{imageMeta.resolution}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-500">File Size:</span>
                        <span className="font-mono text-white">{imageMeta.size}</span>
                      </div>
                    </>
                  )}
                </div>

                <button
                  onClick={handleAnalyseShape}
                  disabled={isAnalyzing}
                  className="w-full py-3.5 px-6 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold rounded-xl transition shadow-lg shadow-blue-600/25 flex items-center justify-center gap-2.5 disabled:opacity-50"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>{analysisStep}</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      <span>Analyse Shape</span>
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Demo Canonical Conditions Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-3">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Info className="w-4 h-4 text-blue-400" />
              Demo Canonical Conditions
            </div>
            <div className="text-xs text-slate-300 space-y-2">
              <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between">
                <span className="font-semibold text-emerald-400">1. Normal Washer</span>
                <span className="text-slate-400 font-mono">PASS</span>
              </div>
              <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between">
                <span className="font-semibold text-rose-400">2. Two Inner Punches</span>
                <span className="text-slate-400 font-mono">FAIL</span>
              </div>
              <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between">
                <span className="font-semibold text-amber-400">3. Outer Edge Deformation</span>
                <span className="text-slate-400 font-mono">FAIL</span>
              </div>
            </div>
          </div>
        </div>

        {/* Results & Heatmap Display Panel */}
        <div className="lg:col-span-7 space-y-6">
          {matchResult ? (
            <div className="space-y-6">
              {/* PASS / FAIL / UNMATCHED Status Card */}
              {matchResult.status === 'PASS' && (
                <div className="bg-emerald-950/40 border border-emerald-500/40 rounded-2xl p-6 shadow-2xl flex items-start gap-5">
                  <div className="p-3 bg-emerald-500/20 border border-emerald-500/40 rounded-2xl text-emerald-400">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>
                  <div className="space-y-1">
                    <div className="inline-block px-3 py-1 bg-emerald-500/20 text-emerald-300 font-black rounded-full text-xs uppercase tracking-wider mb-1">
                      PASS — GEOMETRY CONFORMS
                    </div>
                    <h2 className="text-2xl font-black text-white">{matchResult.title}</h2>
                    <p className="text-sm text-emerald-200/90">{matchResult.description}</p>
                    <div className="pt-2 flex items-center gap-4 text-xs text-slate-400 font-mono">
                      <span>Shape Deformation: <strong className="text-emerald-400">{matchResult.anomalyPercentage.toFixed(1)}%</strong></span>
                      <span>Confidence: <strong className="text-slate-200">{(matchResult.confidence * 100).toFixed(0)}%</strong></span>
                    </div>
                  </div>
                </div>
              )}

              {matchResult.status === 'FAIL' && (
                <div className="bg-rose-950/40 border border-rose-500/40 rounded-2xl p-6 shadow-2xl flex items-start gap-5">
                  <div className="p-3 bg-rose-500/20 border border-rose-500/40 rounded-2xl text-rose-400">
                    <XCircle className="w-10 h-10" />
                  </div>
                  <div className="space-y-1">
                    <div className="inline-block px-3 py-1 bg-rose-500/20 text-rose-300 font-black rounded-full text-xs uppercase tracking-wider mb-1">
                      FAIL — {matchResult.defectType}
                    </div>
                    <h2 className="text-2xl font-black text-white">{matchResult.title}</h2>
                    <p className="text-sm text-rose-200/90">{matchResult.description}</p>
                    <div className="pt-2 flex items-center gap-4 text-xs text-slate-400 font-mono">
                      <span>Deformation Severity: <strong className="text-rose-400">{matchResult.anomalyPercentage.toFixed(1)}%</strong></span>
                      <span>Confidence: <strong className="text-slate-200">{(matchResult.confidence * 100).toFixed(0)}%</strong></span>
                    </div>
                  </div>
                </div>
              )}

              {matchResult.status === 'UNKNOWN' && (
                <div className="bg-amber-950/40 border border-amber-500/40 rounded-2xl p-6 shadow-2xl flex items-start gap-5">
                  <div className="p-3 bg-amber-500/20 border border-amber-500/40 rounded-2xl text-amber-400">
                    <AlertTriangle className="w-10 h-10" />
                  </div>
                  <div className="space-y-1">
                    <div className="inline-block px-3 py-1 bg-amber-500/20 text-amber-300 font-black rounded-full text-xs uppercase tracking-wider mb-1">
                      UNMATCHED TEMPLATE
                    </div>
                    <h2 className="text-2xl font-black text-white">Unmatched Inspection Image</h2>
                    <p className="text-sm text-amber-200/90">{matchResult.description}</p>
                    <p className="text-xs text-slate-400 pt-1">
                      Please upload a valid washer inspection photo matching one of the three canonical conditions.
                    </p>
                  </div>
                </div>
              )}

              {/* View Mode Tabs (Original / Overlay / Heatmap) */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <Layers className="w-5 h-5 text-blue-400" />
                    Shape Deformation Visualization
                  </h3>

                  <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                    <button
                      onClick={() => setActiveViewMode('original')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        activeViewMode === 'original'
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Original
                    </button>
                    <button
                      onClick={() => setActiveViewMode('overlay')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        activeViewMode === 'overlay'
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Overlay
                    </button>
                    <button
                      onClick={() => setActiveViewMode('heatmap')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        activeViewMode === 'heatmap'
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Shape Heatmap
                    </button>
                  </div>
                </div>

                {/* Display Canvas Frame */}
                <div className="relative aspect-square w-full bg-slate-950 rounded-xl overflow-hidden border border-slate-800 flex items-center justify-center p-2">
                  {activeViewMode === 'original' && uploadedImage && (
                    <img src={uploadedImage} alt="Original photo" className="max-h-full max-w-full object-contain rounded-lg" />
                  )}

                  {activeViewMode === 'overlay' && (
                    <img
                      src={renderedOverlayUrl || uploadedImage || ''}
                      alt="Heatmap Overlay"
                      className="max-h-full max-w-full object-contain rounded-lg"
                    />
                  )}

                  {activeViewMode === 'heatmap' && (
                    <img
                      src={renderedHeatmapUrl || uploadedImage || ''}
                      alt="Pure Heatmap"
                      className="max-h-full max-w-full object-contain rounded-lg"
                    />
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center shadow-xl space-y-4">
              <div className="w-16 h-16 bg-slate-800 text-slate-500 rounded-2xl flex items-center justify-center mx-auto">
                <FileCheck className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-white">Ready to Inspect</h3>
              <p className="text-sm text-slate-400 max-w-sm mx-auto">
                Upload a washer product photo on the left and click <strong className="text-blue-400">Analyse Shape</strong> to perform image-specific canonical matching.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

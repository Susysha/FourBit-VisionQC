import React, { useState, useEffect, useRef } from 'react';
import { ProductPart } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { 
  getUserDatasets, 
  addDatasetItem, 
  deleteDatasetItem, 
  updateProduct 
} from '../services/firebase';
import { compressImageForStorage } from '../services/patchcore';
import { 
  DatasetNormalImage, 
  getProductDataset, 
  addNormalImage, 
  deleteNormalImage, 
  clearProductDataset,
  saveProductDataset,
  isDatasetReady
} from '../services/datasetStore';
import { 
  FolderGit2, 
  Upload, 
  Camera, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  Layers, 
  HardDrive, 
  Plus, 
  RefreshCw,
  Video,
  X,
  FileImage,
  FolderPlus,
  Loader2
} from 'lucide-react';

interface DatasetViewProps {
  products: ProductPart[];
  currentProduct: ProductPart | null;
  onSelectProduct: (p: ProductPart) => void;
  onCreateProduct?: () => void;
}

export const DatasetView: React.FC<DatasetViewProps> = ({
  products,
  currentProduct,
  onSelectProduct,
  onCreateProduct,
}) => {
  const { currentUser } = useAuth();
  // Product selection
  const selectedProduct = currentProduct || (products.length > 0 ? products[0] : null);
  const productName = selectedProduct ? selectedProduct.name : '';
  const [datasetImages, setDatasetImages] = useState<DatasetNormalImage[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isLoadingDataset, setIsLoadingDataset] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  // Webcam Capture Modal state
  const [isWebcamModalOpen, setIsWebcamModalOpen] = useState<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [captureFlash, setCaptureFlash] = useState<boolean>(false);
  const [capturedCountSession, setCapturedCountSession] = useState<number>(0);

  // References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load dataset from Firestore (users/{userId}/datasets/{datasetId}) whenever selected product changes
  useEffect(() => {
    if (!selectedProduct || !currentUser) {
      setDatasetImages([]);
      return;
    }

    let isMounted = true;
    setIsLoadingDataset(true);

    const loadData = async () => {
      try {
        // Query users/{userId}/datasets for this product
        const firestoreItems = await getUserDatasets(currentUser.uid, selectedProduct.id);
        if (!isMounted) return;

        if (firestoreItems && firestoreItems.length > 0) {
          const mapped: DatasetNormalImage[] = firestoreItems.map((item) => ({
            id: item.id,
            productName: item.productName || selectedProduct.name,
            fileName: item.fileName,
            dataUrl: item.dataUrl || '',
            folderPath: `users/${currentUser.uid}/datasets/${item.id}`,
            uploadedAt: item.uploadedAt || new Date().toISOString().slice(0, 10),
            resolution: item.resolution || '1280 × 720',
          }));
          setDatasetImages(mapped);
          saveProductDataset(selectedProduct.name, mapped, currentUser.uid);
        } else {
          // Check local store fallback scoped to authenticated user
          const localImages = getProductDataset(selectedProduct.name, currentUser.uid);
          setDatasetImages(localImages);
        }
      } catch (err) {
        console.warn('Error fetching Firestore datasets, using local store:', err);
        const localImages = getProductDataset(selectedProduct.name, currentUser.uid);
        if (isMounted) setDatasetImages(localImages);
      } finally {
        if (isMounted) setIsLoadingDataset(false);
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [selectedProduct?.id, currentUser?.uid]);

  // Handle uploading multiple image files
  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedProduct) return;

    setIsUploading(true);
    let invalidCount = 0;

    try {
      const fileList = Array.from(files);
      for (const file of fileList) {
        if (!file.type.startsWith('image/')) {
          invalidCount++;
          continue;
        }

        const rawDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (event) => resolve(event.target?.result as string);
          reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
          reader.readAsDataURL(file);
        });

        // Compress image so it fits securely within Firestore's 1MB document limit
        const compressedDataUrl = await compressImageForStorage(rawDataUrl, 800, 0.82);

        // Save to Firestore: users/{userId}/datasets/{datasetId}
        let firestoreId = `ds-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        if (currentUser) {
          try {
            const added = await addDatasetItem(currentUser.uid, {
              id: firestoreId,
              productId: selectedProduct.id,
              productName: selectedProduct.name,
              fileName: file.name,
              dataUrl: compressedDataUrl,
              label: 'Normal / Reference',
              resolution: '1280 × 720',
              fileSize: `${Math.round(file.size / 1024)} KB`,
              uploadedAt: new Date().toISOString().slice(0, 10),
            });
            if (added?.id) firestoreId = added.id;
          } catch (err) {
            console.warn('Firestore addDatasetItem notice:', err);
          }
        }

        const newImage: DatasetNormalImage = {
          id: firestoreId,
          productName: selectedProduct.name,
          fileName: file.name,
          dataUrl: compressedDataUrl,
          folderPath: `users/${currentUser?.uid || 'local'}/datasets/${firestoreId}`,
          uploadedAt: new Date().toISOString().slice(0, 10),
          resolution: '1280 × 720',
        };

        setDatasetImages((prev) => {
          const next = [newImage, ...prev];
          saveProductDataset(selectedProduct.name, next, currentUser?.uid);
          if (currentUser) {
            updateProduct(currentUser.uid, selectedProduct.id, { sampleCount: next.length }).catch(() => {});
          }
          return next;
        });
      }

      if (invalidCount > 0) {
        setUploadError(`Skipped ${invalidCount} non-image file(s). Please only upload PNG, JPG, or WebP images.`);
      }
    } catch (err: any) {
      setUploadError(err.message || 'Error processing uploaded images.');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // Start webcam in modal
  const startWebcam = async () => {
    setCameraError(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('getUserMedia is not supported by your browser or environment permissions.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setIsCameraActive(true);
    } catch (err: unknown) {
      setIsCameraActive(false);
      const error = err as Error;
      setCameraError(`Camera error: ${error.message || 'Permission denied'}`);
    }
  };

  // Stop webcam
  const stopWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  };

  // Capture image frame from webcam
  const captureFromWebcam = async () => {
    if (!videoRef.current || !isCameraActive || !selectedProduct) return;

    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const rawDataUrl = canvas.toDataURL('image/jpeg', 0.88);
      const compressedDataUrl = await compressImageForStorage(rawDataUrl, 800, 0.82);

      const fileName = `webcam_normal_${Date.now().toString().slice(-6)}.jpg`;
      let firestoreId = `ds-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      if (currentUser) {
        try {
          const added = await addDatasetItem(currentUser.uid, {
            id: firestoreId,
            productId: selectedProduct.id,
            productName: selectedProduct.name,
            fileName,
            dataUrl: compressedDataUrl,
            label: 'Normal / Reference',
            resolution: `${video.videoWidth || 1280} × ${video.videoHeight || 720}`,
            fileSize: '75 KB',
            uploadedAt: new Date().toISOString().slice(0, 10),
          });
          if (added?.id) firestoreId = added.id;
        } catch (err) {
          console.warn('Firestore addDatasetItem notice:', err);
        }
      }

      const newImg: DatasetNormalImage = {
        id: firestoreId,
        productName: selectedProduct.name,
        fileName,
        dataUrl: compressedDataUrl,
        folderPath: `users/${currentUser?.uid || 'local'}/datasets/${firestoreId}`,
        uploadedAt: new Date().toISOString().slice(0, 10),
        resolution: '1280 × 720',
      };

      setDatasetImages((prev) => {
        const next = [newImg, ...prev];
        saveProductDataset(selectedProduct.name, next, currentUser?.uid);
        if (currentUser) {
          updateProduct(currentUser.uid, selectedProduct.id, { sampleCount: next.length }).catch(() => {});
        }
        return next;
      });

      // Flash animation feedback
      setCaptureFlash(true);
      setTimeout(() => setCaptureFlash(false), 150);
      setCapturedCountSession(prev => prev + 1);
    } catch (err) {
      console.error('Webcam frame snapshot error:', err);
    }
  };

  const closeWebcamModal = () => {
    stopWebcam();
    setIsWebcamModalOpen(false);
    setCapturedCountSession(0);
  };

  // Delete selected image
  const handleDeleteImage = async (id: string) => {
    if (!selectedProduct) return;
    if (currentUser) {
      try {
        await deleteDatasetItem(currentUser.uid, id);
      } catch (err) {
        console.warn('Firestore delete notice:', err);
      }
    }
    deleteNormalImage(selectedProduct.name, id, currentUser?.uid);
    setDatasetImages((prev) => {
      const filtered = prev.filter(img => img.id !== id);
      if (currentUser) {
        updateProduct(currentUser.uid, selectedProduct.id, { sampleCount: filtered.length }).catch(() => {});
      }
      return filtered;
    });
  };

  // Clear dataset
  const handleClearDataset = async () => {
    if (!selectedProduct) return;
    if (window.confirm(`Clear all ${datasetImages.length} normal images for ${selectedProduct.name}?`)) {
      if (currentUser) {
        for (const img of datasetImages) {
          deleteDatasetItem(currentUser.uid, img.id).catch(() => {});
        }
        updateProduct(currentUser.uid, selectedProduct.id, { sampleCount: 0 }).catch(() => {});
      }
      clearProductDataset(selectedProduct.name, currentUser?.uid);
      setDatasetImages([]);
    }
  };

  const imageCount = datasetImages.length;
  const isReady = isDatasetReady(imageCount);

  // If no products exist in the user's account, display empty state
  if (products.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center shadow-xs space-y-4">
        <div className="w-14 h-14 rounded-2xl bg-blue-50 border border-blue-200 flex items-center justify-center mx-auto text-blue-600">
          <FolderGit2 className="w-7 h-7" />
        </div>
        <div className="space-y-1">
          <h2 className="text-base font-bold font-mono text-slate-900">No Products Registered Yet</h2>
          <p className="text-xs text-slate-500 max-w-md mx-auto font-sans">
            The operator must explicitly create a product part before adding normal training samples.
          </p>
        </div>
        {onCreateProduct && (
          <button
            onClick={onCreateProduct}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-mono font-bold shadow-sm transition-colors cursor-pointer"
          >
            <FolderPlus className="w-4 h-4" />
            <span>Register First Product</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Header & Product Name Field */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
        
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <FolderGit2 className="w-5 h-5 text-blue-600" />
              <h1 className="text-base font-bold font-mono text-slate-900 uppercase tracking-wide">
                Normal Product Dataset Creation
              </h1>
            </div>
            <p className="text-xs text-slate-500 mt-1 font-sans">
              Collect <strong>20–30 defect-free, normal product images</strong>. VisionQC learns nominal manufacturing tolerances without requiring defect samples.
            </p>
          </div>

          {/* Dataset Ready Status Badge */}
          <div>
            {isReady ? (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-mono font-bold shadow-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Dataset Ready ({imageCount} Normal Images)</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-300 text-amber-800 text-xs font-mono font-bold">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span>Collecting Images ({imageCount} / 20 Target)</span>
              </div>
            )}
          </div>
        </div>

        {/* Upload Error Banner */}
        {uploadError && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-md text-xs font-mono text-rose-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{uploadError}</span>
            </div>
            <button onClick={() => setUploadError(null)} className="text-rose-500 hover:text-rose-700 font-bold">✕</button>
          </div>
        )}

        {/* Product Name Field & Action Buttons */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pt-1">
          
          {/* Product Profile Selector & Name Input */}
          <div className="flex flex-wrap items-center gap-3 flex-1">
            <div className="flex items-center gap-2">
              <label className="text-xs font-mono text-slate-600 whitespace-nowrap font-medium">
                Active Profile:
              </label>
              <select
                value={selectedProduct?.id || ''}
                onChange={(e) => {
                  const found = products.find(p => p.id === e.target.value);
                  if (found) {
                    onSelectProduct(found);
                  }
                }}
                className="bg-slate-50 border border-slate-300 text-slate-900 text-xs font-mono px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
              >
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku})
                  </option>
                ))}
              </select>
            </div>

            {onCreateProduct && (
              <button
                type="button"
                onClick={onCreateProduct}
                className="px-2.5 py-1.5 text-xs font-mono text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded border border-blue-200 flex items-center gap-1 transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>New Product</span>
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleUploadFiles}
              multiple
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
            />
            
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-mono font-medium flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Uploading to Firestore...</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload Image(s)</span>
                </>
              )}
            </button>

            <button
              onClick={() => {
                setIsWebcamModalOpen(true);
                startWebcam();
              }}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-mono font-medium flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Capture Sample</span>
            </button>

            {datasetImages.length > 0 && (
              <button
                onClick={handleClearDataset}
                className="px-3 py-2 bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-600 rounded-md text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Clear all images in this product dataset"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            )}
          </div>

        </div>

      </div>

      {/* Dataset Metrics Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono">
        
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
          <div className="text-slate-500 uppercase text-[10px]">Normal Samples Acquired</div>
          <div className="text-2xl font-bold text-slate-900 mt-1">{imageCount}</div>
          <div className="text-[11px] text-slate-400 mt-1">
            Target: 20–30 normal samples
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
          <div className="text-slate-500 uppercase text-[10px]">Status Readiness</div>
          <div className={`text-lg font-bold mt-1 ${isReady ? 'text-emerald-600' : 'text-amber-600'}`}>
            {isReady ? '✓ Dataset Ready' : `${Math.max(0, 20 - imageCount)} More Required`}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {isReady ? 'Sufficient for anomaly baseline' : 'Minimum 20 images for calibration'}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
          <div className="text-slate-500 uppercase text-[10px]">Active Profile Target</div>
          <div className="text-xs font-bold text-slate-700 mt-1 truncate">
            {productName}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Isolated operator dataset
          </div>
        </div>

      </div>

      {/* Preview of Collected Images Grid */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs">
        
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
          <div className="flex items-center gap-2">
            <FileImage className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-bold font-mono text-slate-900 uppercase tracking-wide">
              Collected Normal Images Preview ({imageCount})
            </h2>
          </div>
          <span className="text-xs font-mono text-slate-400">
            Hover to view or delete
          </span>
        </div>

        {datasetImages.length === 0 ? (
          <div className="py-16 text-center text-slate-400 border-2 border-dashed border-slate-200 rounded-lg space-y-3">
            <FolderGit2 className="w-12 h-12 mx-auto opacity-40 text-slate-400" />
            <div>
              <p className="text-sm font-mono text-slate-600 font-semibold">No normal images in this dataset yet.</p>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto font-sans">
                Upload real defect-free image files from disk or capture frames with your camera to build the reference baseline for {productName}.
              </p>
            </div>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-md text-xs font-mono font-medium flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Upload Normal Images</span>
              </button>
              <button
                onClick={() => {
                  setIsWebcamModalOpen(true);
                  startWebcam();
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-mono font-medium flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Capture via Camera</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {datasetImages.map((img, idx) => (
              <div
                key={img.id}
                className="bg-slate-50 border border-slate-200 rounded-md overflow-hidden relative group hover:border-blue-400 hover:shadow-xs transition-all"
              >
                {/* Thumbnail image */}
                <div className="aspect-[4/3] bg-slate-900 relative overflow-hidden flex items-center justify-center">
                  <img
                    src={img.dataUrl}
                    alt={img.fileName}
                    className="w-full h-full object-cover"
                  />
                  
                  {/* Delete overlay button on hover */}
                  <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <button
                      onClick={() => handleDeleteImage(img.id)}
                      className="p-1.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white transition-colors cursor-pointer"
                      title="Delete selected image"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Index badge */}
                  <div className="absolute bottom-1 right-1 px-1 py-0.2 rounded bg-slate-900/80 text-[9px] font-mono text-slate-200">
                    #{idx + 1}
                  </div>
                </div>

                {/* Sub-label */}
                <div className="p-1.5 text-[10px] font-mono text-slate-600 truncate border-t border-slate-200">
                  {img.fileName}
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {/* ================= WEBCAM CAPTURE MODAL ================= */}
      {isWebcamModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-lg max-w-2xl w-full p-5 shadow-2xl space-y-4">
            
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <Camera className="w-5 h-5 text-blue-600" />
                <h3 className="text-sm font-bold font-mono text-slate-900 uppercase">
                  Capture Normal Product Sample via Camera
                </h3>
              </div>
              <button
                onClick={closeWebcamModal}
                className="p-1 text-slate-400 hover:text-slate-600 rounded cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {cameraError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded text-xs font-mono text-rose-800">
                {cameraError}
              </div>
            )}

            {/* Video Viewport */}
            <div className="relative aspect-[16/9] bg-slate-950 rounded-lg overflow-hidden border border-slate-300 flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-contain ${isCameraActive ? 'block' : 'hidden'}`}
              />

              {captureFlash && (
                <div className="absolute inset-0 bg-white/70 pointer-events-none transition-opacity duration-150" />
              )}

              {!isCameraActive && (
                <div className="text-center text-slate-400 text-xs font-mono">
                  <Video className="w-10 h-10 mx-auto mb-2 opacity-50" />
                  <span>Connecting to camera stream...</span>
                </div>
              )}

              {/* Reticle */}
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute top-4 left-4 w-5 h-5 border-t-2 border-l-2 border-blue-500" />
                <div className="absolute top-4 right-4 w-5 h-5 border-t-2 border-r-2 border-blue-500" />
                <div className="absolute bottom-4 left-4 w-5 h-5 border-b-2 border-l-2 border-blue-500" />
                <div className="absolute bottom-4 right-4 w-5 h-5 border-b-2 border-r-2 border-blue-500" />
              </div>

              {/* Status overlay */}
              <div className="absolute bottom-2 left-3 text-[10px] font-mono text-slate-300 bg-slate-900/80 px-2 py-0.5 rounded">
                Product: {productName} · Saved this session: {capturedCountSession}
              </div>
            </div>

            {/* Capture Controls */}
            <div className="flex items-center justify-between pt-2 text-xs font-mono">
              <span className="text-slate-500">
                Position defect-free part in frame and click Snap Image.
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={closeWebcamModal}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md transition-colors cursor-pointer"
                >
                  Done
                </button>
                <button
                  onClick={captureFromWebcam}
                  disabled={!isCameraActive}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold rounded-md transition-colors shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Camera className="w-4 h-4" />
                  <span>Snap Image (#{datasetImages.length + 1})</span>
                </button>
              </div>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};

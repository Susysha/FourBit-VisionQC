export type NavSection = 'dashboard' | 'inspection' | 'dataset' | 'history' | 'settings';

export type QualityStatus = 'PASS' | 'FAIL';

export interface ProductPart {
  id: string;
  userId?: string;
  name: string;
  sku: string;
  category: string;
  nominalThreshold: number;
  sampleCount: number;
  activeLine: string;
  createdAt?: string;
}

export interface DefectRegion {
  x: number;
  y: number;
  width?: number;
  height?: number;
  gridX?: number;
  gridY?: number;
  confidence?: number;
  description?: string;
}

export interface InspectionRecord {
  id: string;
  userId?: string;
  timestamp: string;
  partId?: string;
  productId?: string;
  partName?: string;
  product_name: string; // for compatibility with existing components
  productName?: string;
  partSku?: string;
  status: QualityStatus;
  result: QualityStatus; // for compatibility with existing components
  confidenceScore: number;
  anomaly_score: number; // for compatibility with existing components
  anomalyScore: number;
  threshold: number;
  batchNumber?: string;
  operator?: string;
  inspectionLine?: string;
  defectType?: string;
  defectLocation?: string;
  suspectedDefectRegion?: DefectRegion;
  imageUrl?: string;
  image_path?: string; // for compatibility with existing components
  imageDataUrl?: string;
  heatmapUrl?: string;
  overlayUrl?: string;
  inferenceTimeMs?: number;
}

export interface DatasetItem {
  id: string;
  userId?: string;
  productId: string;
  productName: string;
  fileName: string;
  dataUrl?: string;
  label: 'Normal / Reference' | 'Known Defect';
  defectType?: string;
  resolution: string;
  uploadedAt: string;
  fileSize: string;
  thumbnailSvg?: string;
}

export interface SystemConfig {
  anomalyThreshold: number; // default 0.50: score < threshold -> PASS, score >= threshold -> FAIL
  cameraInterface: string;
  streamResolution: string;
  fpsTarget: number;
  backendEndpoint: string;
  storageRetentionDays: number;
  autoLogFailures: boolean;
  audibleAlerts: boolean;
  stationId: string;
  inspectorName: string;
}

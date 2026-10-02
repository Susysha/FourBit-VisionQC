import { ProductPart, InspectionRecord, DatasetItem, SystemConfig } from '../types';

// Empty state by default for every newly registered operator.
// All real products, inspections, and datasets are loaded from Firestore.
export const INITIAL_PRODUCTS: ProductPart[] = [];

export const INITIAL_INSPECTIONS: InspectionRecord[] = [];

export const INITIAL_DATASET: DatasetItem[] = [];

export const INITIAL_CONFIG: SystemConfig = {
  anomalyThreshold: 0.50, // Default 0.50: score < threshold -> PASS, score >= threshold -> FAIL
  cameraInterface: 'GigE Vision (Basler ace 2 Pro)',
  streamResolution: '1920 × 1080 @ 60 FPS',
  fpsTarget: 60,
  backendEndpoint: 'http://localhost:8000/api/v1/inference',
  storageRetentionDays: 90,
  autoLogFailures: true,
  audibleAlerts: true,
  stationId: 'STATION-QC-01',
  inspectorName: 'Operator',
};

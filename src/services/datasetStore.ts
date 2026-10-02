/**
 * Local Dataset Storage for VisionQC
 *
 * Manages collections of real NORMAL, defect-free product images.
 * All keys are strictly user-scoped: visionqc_dataset_${userId}_${productName}
 * VisionQC starts with an EMPTY state for every operator. No fake or synthetic samples are pre-seeded.
 */

export interface DatasetNormalImage {
  id: string;
  productName: string;
  fileName: string;
  dataUrl: string;
  folderPath: string; // e.g. "users/{userId}/datasets/{datasetId}"
  uploadedAt: string;
  resolution: string;
}

/**
 * Returns a user-scoped localStorage key
 */
function getStorageKey(productName: string, userId: string = 'global'): string {
  const safeUser = (userId || 'global').trim();
  const safeProduct = (productName || '').trim().toLowerCase();
  return `visionqc_dataset_${safeUser}_${safeProduct}`;
}

/**
 * Retrieves all normal product images for the given product scoped to the user.
 * Returns empty array if none have been uploaded yet.
 */
export function getProductDataset(productName: string, userId: string = 'global'): DatasetNormalImage[] {
  if (!productName) return [];
  const key = getStorageKey(productName, userId);
  const stored = localStorage.getItem(key);

  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {
      return [];
    }
  }

  // Returns empty array: NO fake or synthetic images
  return [];
}

/**
 * Saves normal dataset array for a product scoped to the user
 */
export function saveProductDataset(productName: string, images: DatasetNormalImage[], userId: string = 'global'): void {
  if (!productName) return;
  const key = getStorageKey(productName, userId);
  try {
    localStorage.setItem(key, JSON.stringify(images));
  } catch (err) {
    console.warn('Storage quota exceeded, storing in memory session only:', err);
  }
}

/**
 * Adds a new real normal image to product dataset scoped to user
 */
export function addNormalImage(
  productName: string,
  dataUrl: string,
  fileName?: string,
  userId: string = 'global'
): DatasetNormalImage {
  const current = getProductDataset(productName, userId);
  const nextNum = current.length + 1;
  const resolvedFileName = fileName || `normal_capture_${String(nextNum).padStart(3, '0')}.png`;

  const newImg: DatasetNormalImage = {
    id: `img-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    productName,
    fileName: resolvedFileName,
    dataUrl,
    folderPath: `users/${userId}/datasets/${productName}/normal/`,
    uploadedAt: new Date().toISOString().slice(0, 10),
    resolution: '1280 × 720',
  };

  const updated = [newImg, ...current];
  saveProductDataset(productName, updated, userId);
  return newImg;
}

/**
 * Deletes a single image from product dataset scoped to user
 */
export function deleteNormalImage(productName: string, id: string, userId: string = 'global'): void {
  const current = getProductDataset(productName, userId);
  const filtered = current.filter(img => img.id !== id);
  saveProductDataset(productName, filtered, userId);
}

/**
 * Clears all normal images for a product dataset scoped to user
 */
export function clearProductDataset(productName: string, userId: string = 'global'): void {
  saveProductDataset(productName, [], userId);
}

/**
 * Checks if product dataset has reached the minimum target (20 images)
 */
export function isDatasetReady(count: number): boolean {
  return count >= 20;
}

import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  sendPasswordResetEmail, 
  updateProfile,
  onAuthStateChanged,
  User as FirebaseUser,
  browserLocalPersistence,
  setPersistence
} from 'firebase/auth';
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc,
  updateDoc,
  getDocs,
  collection,
  deleteDoc,
  query,
  orderBy,
  onSnapshot,
  getDocFromServer,
  Unsubscribe
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { ProductPart, DatasetItem, InspectionRecord, QualityStatus } from '../types';

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Auth & Persistence
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn('Firebase persistence warning:', err);
});

// Initialize Firestore using the (default) database instance
export const db = (!firebaseConfig.firestoreDatabaseId || firebaseConfig.firestoreDatabaseId === '(default)')
  ? getFirestore(app)
  : getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Test connection on boot per Firebase skill guidelines
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'users', 'connection_probe'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('VisionQC: Firestore client is offline. Check Firebase configuration.');
    }
  }
}
testConnection();

// Skill-standardized Firestore Error Handling
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface UserProfile {
  userId: string;
  fullName: string;
  email: string;
  createdAt: string;
}

/**
 * Creates a user profile in Firestore after registration
 */
export async function createUserProfile(profile: UserProfile): Promise<void> {
  const path = `users/${profile.userId}`;
  try {
    const userRef = doc(db, 'users', profile.userId);
    await setDoc(userRef, {
      userId: profile.userId,
      fullName: profile.fullName,
      email: profile.email,
      createdAt: profile.createdAt,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Retrieves the user profile from Firestore
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const path = `users/${userId}`;
  try {
    const userRef = doc(db, 'users', userId);
    const snap = await getDoc(userRef);
    if (!snap.exists()) {
      return null;
    }
    return snap.data() as UserProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

// -------------------------------------------------------------
// USER PRODUCTS COLLECTION: users/{userId}/products/{productId}
// -------------------------------------------------------------

export async function getUserProducts(userId: string): Promise<ProductPart[]> {
  const path = `users/${userId}/products`;
  try {
    const productsRef = collection(db, 'users', userId, 'products');
    const q = query(productsRef, orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    const list: ProductPart[] = [];
    snap.forEach((d) => {
      list.push(d.data() as ProductPart);
    });
    return list;
  } catch (error) {
    // If orderBy index is building or fails, fallback to simple getDocs
    try {
      const productsRef = collection(db, 'users', userId, 'products');
      const snap = await getDocs(productsRef);
      const list: ProductPart[] = [];
      snap.forEach((d) => {
        list.push(d.data() as ProductPart);
      });
      return list;
    } catch (fallbackError) {
      handleFirestoreError(fallbackError, OperationType.LIST, path);
    }
  }
}

export async function createProduct(
  userId: string, 
  productData: Omit<ProductPart, 'id' | 'userId'> & { id?: string }
): Promise<ProductPart> {
  const productId = productData.id || `part-${Date.now()}`;
  const path = `users/${userId}/products/${productId}`;
  const newProduct: ProductPart = {
    id: productId,
    userId,
    name: productData.name,
    sku: productData.sku,
    category: productData.category || 'General Components',
    nominalThreshold: productData.nominalThreshold ?? 0.85,
    sampleCount: productData.sampleCount ?? 0,
    activeLine: productData.activeLine || 'Line 01 - Optical Bench',
    createdAt: new Date().toISOString(),
  };

  try {
    const docRef = doc(db, 'users', userId, 'products', productId);
    await setDoc(docRef, newProduct);
    return newProduct;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteProduct(userId: string, productId: string): Promise<void> {
  const path = `users/${userId}/products/${productId}`;
  try {
    const docRef = doc(db, 'users', userId, 'products', productId);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function updateProduct(
  userId: string, 
  productId: string, 
  updates: Partial<ProductPart>
): Promise<void> {
  const path = `users/${userId}/products/${productId}`;
  try {
    const docRef = doc(db, 'users', userId, 'products', productId);
    await updateDoc(docRef, updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeToUserProducts(
  userId: string, 
  onUpdate: (products: ProductPart[]) => void
): Unsubscribe {
  const productsRef = collection(db, 'users', userId, 'products');
  return onSnapshot(productsRef, (snap) => {
    const list: ProductPart[] = [];
    snap.forEach((d) => {
      list.push(d.data() as ProductPart);
    });
    onUpdate(list);
  }, (err) => {
    console.warn('Real-time products subscription notice:', err);
  });
}

// -------------------------------------------------------------
// USER DATASETS COLLECTION: users/{userId}/datasets/{datasetId}
// -------------------------------------------------------------

export async function getUserDatasets(userId: string, productId?: string): Promise<DatasetItem[]> {
  const path = `users/${userId}/datasets`;
  try {
    const datasetsRef = collection(db, 'users', userId, 'datasets');
    const snap = await getDocs(datasetsRef);
    let list: DatasetItem[] = [];
    snap.forEach((d) => {
      list.push(d.data() as DatasetItem);
    });
    if (productId) {
      list = list.filter((item) => item.productId === productId);
    }
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function addDatasetItem(
  userId: string, 
  itemData: Omit<DatasetItem, 'id' | 'userId'> & { id?: string }
): Promise<DatasetItem> {
  const itemId = itemData.id || `ds-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const path = `users/${userId}/datasets/${itemId}`;
  const newItem: DatasetItem = {
    id: itemId,
    userId,
    productId: itemData.productId,
    productName: itemData.productName,
    fileName: itemData.fileName,
    dataUrl: itemData.dataUrl || '',
    label: itemData.label || 'Normal / Reference',
    defectType: itemData.defectType || '',
    resolution: itemData.resolution || '1920 × 1080',
    fileSize: itemData.fileSize || '1.5 MB',
    uploadedAt: itemData.uploadedAt || new Date().toISOString().slice(0, 10),
  };

  try {
    const docRef = doc(db, 'users', userId, 'datasets', itemId);
    await setDoc(docRef, newItem);
    return newItem;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteDatasetItem(userId: string, itemId: string): Promise<void> {
  const path = `users/${userId}/datasets/${itemId}`;
  try {
    const docRef = doc(db, 'users', userId, 'datasets', itemId);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeToUserDatasets(
  userId: string, 
  onUpdate: (datasets: DatasetItem[]) => void
): Unsubscribe {
  const datasetsRef = collection(db, 'users', userId, 'datasets');
  return onSnapshot(datasetsRef, (snap) => {
    const list: DatasetItem[] = [];
    snap.forEach((d) => {
      list.push(d.data() as DatasetItem);
    });
    onUpdate(list);
  }, (err) => {
    console.warn('Real-time datasets subscription notice:', err);
  });
}

// -------------------------------------------------------------------
// USER INSPECTIONS COLLECTION: users/{userId}/inspections/{inspectionId}
// -------------------------------------------------------------------

export async function getUserInspections(userId: string): Promise<InspectionRecord[]> {
  const path = `users/${userId}/inspections`;
  try {
    const inspectionsRef = collection(db, 'users', userId, 'inspections');
    const q = query(inspectionsRef, orderBy('timestamp', 'desc'));
    const snap = await getDocs(q);
    const list: InspectionRecord[] = [];
    snap.forEach((d) => {
      const data = d.data();
      list.push({
        id: data.id || d.id,
        userId: data.userId || userId,
        timestamp: data.timestamp || '',
        productId: data.productId || data.partId || '',
        partId: data.partId || data.productId || '',
        partName: data.partName || data.productName || data.product_name || '',
        product_name: data.product_name || data.productName || data.partName || 'Unknown Part',
        productName: data.productName || data.product_name || data.partName || 'Unknown Part',
        partSku: data.partSku || '',
        status: data.status || data.result || 'PASS',
        result: data.result || data.status || 'PASS',
        confidenceScore: data.confidenceScore ?? (1 - (data.anomalyScore ?? 0)),
        anomaly_score: data.anomaly_score ?? data.anomalyScore ?? 0,
        anomalyScore: data.anomalyScore ?? data.anomaly_score ?? 0,
        threshold: data.threshold ?? 0.50,
        batchNumber: data.batchNumber || '',
        operator: data.operator || '',
        inspectionLine: data.inspectionLine || '',
        defectType: data.defectType || '',
        defectLocation: data.defectLocation || '',
        suspectedDefectRegion: data.suspectedDefectRegion,
        imageUrl: data.imageUrl || data.imageDataUrl || data.image_path || '',
        image_path: data.image_path || data.imageUrl || data.imageDataUrl || '',
        imageDataUrl: data.imageDataUrl || data.imageUrl || '',
        heatmapUrl: data.heatmapUrl || '',
        overlayUrl: data.overlayUrl || '',
        inferenceTimeMs: data.inferenceTimeMs,
      });
    });
    return list;
  } catch (error) {
    // If composite index is building or orderBy fails, fallback
    try {
      const inspectionsRef = collection(db, 'users', userId, 'inspections');
      const snap = await getDocs(inspectionsRef);
      const list: InspectionRecord[] = [];
      snap.forEach((d) => {
        const data = d.data();
        list.push({
          id: data.id || d.id,
          userId: data.userId || userId,
          timestamp: data.timestamp || '',
          productId: data.productId || data.partId || '',
          partId: data.partId || data.productId || '',
          partName: data.partName || data.productName || data.product_name || '',
          product_name: data.product_name || data.productName || data.partName || 'Unknown Part',
          productName: data.productName || data.product_name || data.partName || 'Unknown Part',
          partSku: data.partSku || '',
          status: data.status || data.result || 'PASS',
          result: data.result || data.status || 'PASS',
          confidenceScore: data.confidenceScore ?? (1 - (data.anomalyScore ?? 0)),
          anomaly_score: data.anomaly_score ?? data.anomalyScore ?? 0,
          anomalyScore: data.anomalyScore ?? data.anomaly_score ?? 0,
          threshold: data.threshold ?? 0.50,
          batchNumber: data.batchNumber || '',
          operator: data.operator || '',
          inspectionLine: data.inspectionLine || '',
          defectType: data.defectType || '',
          defectLocation: data.defectLocation || '',
          suspectedDefectRegion: data.suspectedDefectRegion,
          imageUrl: data.imageUrl || data.imageDataUrl || data.image_path || '',
          image_path: data.image_path || data.imageUrl || data.imageDataUrl || '',
          imageDataUrl: data.imageDataUrl || data.imageUrl || '',
          heatmapUrl: data.heatmapUrl || '',
          overlayUrl: data.overlayUrl || '',
          inferenceTimeMs: data.inferenceTimeMs,
        });
      });
      // Sort in memory by timestamp descending
      return list.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    } catch (fallbackErr) {
      handleFirestoreError(fallbackErr, OperationType.LIST, path);
    }
  }
}

export async function addInspectionRecord(
  userId: string,
  recordData: Partial<InspectionRecord> & { productName: string; status: QualityStatus; anomalyScore: number; threshold: number }
): Promise<InspectionRecord> {
  const inspectionId = recordData.id || `QC-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
  const path = `users/${userId}/inspections/${inspectionId}`;
  const timestamp = recordData.timestamp || new Date().toISOString().replace('T', ' ').slice(0, 19);

  const fullRecord: InspectionRecord = {
    id: inspectionId,
    userId,
    timestamp,
    productId: recordData.productId || recordData.partId || '',
    partId: recordData.partId || recordData.productId || '',
    partName: recordData.partName || recordData.productName,
    product_name: recordData.productName,
    productName: recordData.productName,
    partSku: recordData.partSku || '',
    status: recordData.status,
    result: recordData.status,
    confidenceScore: recordData.confidenceScore ?? (1 - recordData.anomalyScore),
    anomaly_score: recordData.anomalyScore,
    anomalyScore: recordData.anomalyScore,
    threshold: recordData.threshold,
    batchNumber: recordData.batchNumber || 'BATCH-01',
    operator: recordData.operator || auth.currentUser?.displayName || 'Operator',
    inspectionLine: recordData.inspectionLine || 'Line 01 - Optical Bench',
    defectType: recordData.defectType || (recordData.status === 'FAIL' ? 'Surface Anomaly' : 'Conformant'),
    defectLocation: recordData.defectLocation || (recordData.suspectedDefectRegion ? `(${recordData.suspectedDefectRegion.x}px, ${recordData.suspectedDefectRegion.y}px)` : ''),
    suspectedDefectRegion: recordData.suspectedDefectRegion,
    imageUrl: recordData.imageUrl || recordData.imageDataUrl || '',
    image_path: recordData.image_path || recordData.imageUrl || recordData.imageDataUrl || '',
    imageDataUrl: recordData.imageDataUrl || recordData.imageUrl || '',
    heatmapUrl: recordData.heatmapUrl || '',
    overlayUrl: recordData.overlayUrl || '',
    inferenceTimeMs: recordData.inferenceTimeMs,
    source: recordData.source || 'live_camera',
  };

  try {
    const docRef = doc(db, 'users', userId, 'inspections', inspectionId);
    await setDoc(docRef, fullRecord);
    return fullRecord;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeToUserInspections(
  userId: string, 
  onUpdate: (inspections: InspectionRecord[]) => void
): Unsubscribe {
  const inspectionsRef = collection(db, 'users', userId, 'inspections');
  return onSnapshot(inspectionsRef, (snap) => {
    const list: InspectionRecord[] = [];
    snap.forEach((d) => {
      const data = d.data();
      list.push({
        id: data.id || d.id,
        userId: data.userId || userId,
        timestamp: data.timestamp || '',
        productId: data.productId || data.partId || '',
        partId: data.partId || data.productId || '',
        partName: data.partName || data.productName || data.product_name || '',
        product_name: data.product_name || data.productName || data.partName || 'Unknown Part',
        productName: data.productName || data.product_name || data.partName || 'Unknown Part',
        partSku: data.partSku || '',
        status: data.status || data.result || 'PASS',
        result: data.result || data.status || 'PASS',
        confidenceScore: data.confidenceScore ?? (1 - (data.anomalyScore ?? 0)),
        anomaly_score: data.anomaly_score ?? data.anomalyScore ?? 0,
        anomalyScore: data.anomalyScore ?? data.anomaly_score ?? 0,
        threshold: data.threshold ?? 0.50,
        batchNumber: data.batchNumber || '',
        operator: data.operator || '',
        inspectionLine: data.inspectionLine || '',
        defectType: data.defectType || '',
        defectLocation: data.defectLocation || '',
        suspectedDefectRegion: data.suspectedDefectRegion,
        imageUrl: data.imageUrl || data.imageDataUrl || data.image_path || '',
        image_path: data.image_path || data.imageUrl || data.imageDataUrl || '',
        imageDataUrl: data.imageDataUrl || data.imageUrl || '',
        heatmapUrl: data.heatmapUrl || '',
        overlayUrl: data.overlayUrl || '',
        inferenceTimeMs: data.inferenceTimeMs,
      });
    });
    // Sort descending by timestamp
    list.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    onUpdate(list);
  }, (err) => {
    console.warn('Real-time inspections subscription notice:', err);
  });
}

/**
 * Map Firebase Auth error codes to user-friendly messages with explicit error codes
 */
export function getAuthErrorMessage(errorCode: string, rawMessage?: string): string {
  console.error('[VisionQC Auth Debug] Firebase error code:', errorCode, 'raw message:', rawMessage);
  
  switch (errorCode) {
    case 'auth/operation-not-allowed':
      return '[auth/operation-not-allowed] Email/Password sign-in is disabled in your Firebase project. Please enable "Email/Password" in Firebase Console > Authentication > Sign-in method.';
    case 'auth/email-already-in-use':
      return '[auth/email-already-in-use] This email address is already registered. Please sign in instead.';
    case 'auth/invalid-email':
      return '[auth/invalid-email] Invalid email address format. Please check the email and try again.';
    case 'auth/weak-password':
      return '[auth/weak-password] Password must be at least 6 characters long.';
    case 'auth/invalid-credential':
      return '[auth/invalid-credential] Invalid email or password. Please verify your credentials or create a new account.';
    case 'auth/user-not-found':
      return '[auth/user-not-found] No VisionQC account exists with this email address. Please create an account.';
    case 'auth/wrong-password':
      return '[auth/wrong-password] Incorrect password. Please try again or use "Forgot Password" to reset.';
    case 'auth/too-many-requests':
      return '[auth/too-many-requests] Access temporarily blocked due to repeated failed login attempts. Please wait a moment or reset your password.';
    case 'auth/network-request-failed':
      return '[auth/network-request-failed] Network request failed. Please verify your internet connection or check for CORS restrictions.';
    case 'auth/user-disabled':
      return '[auth/user-disabled] This user account has been disabled by an administrator.';
    case 'auth/api-key-not-valid':
    case 'auth/invalid-api-key':
      return `[${errorCode}] Invalid Firebase API key for project visionqc-c9d79. Please verify the Web App apiKey in Firebase Console.`;
    case 'auth/unauthorized-domain':
      return `[auth/unauthorized-domain] This domain is not authorized for OAuth operations in your Firebase project. Add it in Firebase Console > Authentication > Settings > Authorized domains.`;
    case 'auth/requires-recent-login':
      return '[auth/requires-recent-login] Please sign in again to complete this sensitive operation.';
    default:
      if (errorCode) {
        return `[${errorCode}] ${rawMessage || 'Authentication failed. Please check Firebase console settings.'}`;
      }
      return rawMessage || 'An unexpected authentication error occurred. Please try again.';
  }
}

export { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  sendPasswordResetEmail, 
  updateProfile,
  onAuthStateChanged 
};
export type { FirebaseUser };

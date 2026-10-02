import React, { useState, useEffect } from 'react';
import { 
  NavSection, 
  ProductPart, 
  InspectionRecord, 
  DatasetItem, 
  SystemConfig 
} from './types';
import { 
  INITIAL_CONFIG 
} from './utils/initialData';
import { 
  subscribeToUserProducts, 
  subscribeToUserInspections, 
  addInspectionRecord 
} from './services/firebase';
import { insertInspection, clearAllInspections } from './services/database';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LoginPage } from './components/LoginPage';
import { SignUpPage } from './components/SignUpPage';
import { ForgotPasswordModal } from './components/ForgotPasswordModal';
import { CreateProductModal } from './components/CreateProductModal';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { InspectionView } from './components/InspectionView';
import { DatasetView } from './components/DatasetView';
import { HistoryView } from './components/HistoryView';
import { SettingsView } from './components/SettingsView';
import { InspectionDetailModal } from './components/InspectionDetailModal';
import { ShieldCheck, Loader2 } from 'lucide-react';

function AuthenticatedVisionQCApp() {
  const { currentUser, loading } = useAuth();
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [showForgotPassword, setShowForgotPassword] = useState<boolean>(false);
  const [showCreateProductModal, setShowCreateProductModal] = useState<boolean>(false);

  const [currentSection, setCurrentSection] = useState<NavSection>('dashboard');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);

  // Core application data state - Starts EMPTY for every user
  const [products, setProducts] = useState<ProductPart[]>([]);
  const [currentProduct, setCurrentProduct] = useState<ProductPart | null>(null);
  const [inspections, setInspections] = useState<InspectionRecord[]>([]);
  const [config, setConfig] = useState<SystemConfig>(INITIAL_CONFIG);

  // Active detail modal
  const [selectedInspection, setSelectedInspection] = useState<InspectionRecord | null>(null);

  // Real-time Firestore sync with authenticated user's isolated data
  useEffect(() => {
    if (!currentUser) {
      setProducts([]);
      setCurrentProduct(null);
      setInspections([]);
      clearAllInspections().catch(() => {});
      return;
    }

    // 1. Subscribe to real products from users/{userId}/products
    const unsubProducts = subscribeToUserProducts(currentUser.uid, (realProducts) => {
      setProducts(realProducts);
      setCurrentProduct((prev) => {
        if (!prev && realProducts.length > 0) return realProducts[0];
        if (prev && !realProducts.find(p => p.id === prev.id)) {
          return realProducts.length > 0 ? realProducts[0] : null;
        }
        return prev;
      });
    });

    // 2. Subscribe to real inspections from users/{userId}/inspections
    const unsubInspections = subscribeToUserInspections(currentUser.uid, (realInspections) => {
      setInspections(realInspections);
      // Keep local SQLite sync clean with user's real inspections
      for (const rec of realInspections) {
        insertInspection({
          id: rec.id,
          timestamp: rec.timestamp,
          product_name: rec.product_name,
          anomaly_score: rec.anomaly_score ?? rec.anomalyScore,
          threshold: rec.threshold,
          result: rec.status,
          image_path: rec.image_path || rec.imageUrl || '',
        }).catch(() => {});
      }
    });

    return () => {
      unsubProducts();
      unsubInspections();
    };
  }, [currentUser]);

  // When user logs in, ensure they are on the Dashboard
  useEffect(() => {
    if (currentUser) {
      setCurrentSection('dashboard');
    }
  }, [currentUser]);

  // Handlers
  const handleRecordInspection = async (newRecord: InspectionRecord) => {
    if (!currentUser) return;

    try {
      // Save directly to user's Firestore collection: users/{userId}/inspections/{inspectionId}
      const saved = await addInspectionRecord(currentUser.uid, {
        id: newRecord.id,
        timestamp: newRecord.timestamp,
        productId: newRecord.productId || currentProduct?.id,
        partId: newRecord.partId || currentProduct?.id,
        productName: newRecord.product_name || currentProduct?.name || 'Inspected Component',
        partName: newRecord.partName || currentProduct?.name,
        partSku: newRecord.partSku || currentProduct?.sku,
        status: newRecord.status,
        result: newRecord.status,
        anomalyScore: newRecord.anomalyScore ?? newRecord.anomaly_score,
        anomaly_score: newRecord.anomaly_score ?? newRecord.anomalyScore,
        threshold: newRecord.threshold,
        batchNumber: newRecord.batchNumber || 'B-01',
        operator: newRecord.operator || currentUser.displayName || 'Operator',
        inspectionLine: newRecord.inspectionLine || currentProduct?.activeLine || 'Line 01 - Optical Bench',
        imageUrl: newRecord.imageUrl || newRecord.imageDataUrl,
        imageDataUrl: newRecord.imageDataUrl || newRecord.imageUrl,
        image_path: newRecord.image_path || 'Live Optical Frame',
        heatmapUrl: newRecord.heatmapUrl,
        overlayUrl: newRecord.overlayUrl,
        suspectedDefectRegion: newRecord.suspectedDefectRegion,
        defectLocation: newRecord.defectLocation,
        defectType: newRecord.defectType,
        inferenceTimeMs: newRecord.inferenceTimeMs,
      });

      // Also persist to SQLite
      await insertInspection({
        id: saved.id,
        timestamp: saved.timestamp,
        product_name: saved.product_name,
        anomaly_score: saved.anomaly_score,
        threshold: saved.threshold,
        result: saved.status,
        image_path: saved.image_path || 'Live Optical Frame',
      });

      setInspections((prev) => [saved, ...prev.filter(i => i.id !== saved.id)]);
    } catch (err) {
      console.error('Failed to record inspection in Firestore:', err);
    }
  };

  const handleProductCreated = (newProduct: ProductPart) => {
    setProducts((prev) => [newProduct, ...prev.filter(p => p.id !== newProduct.id)]);
    setCurrentProduct(newProduct);
  };

  const handleSaveConfig = (newConfig: SystemConfig) => {
    setConfig(newConfig);
  };

  const handleUpdateThreshold = (val: number) => {
    setConfig(prev => ({ ...prev, anomalyThreshold: val }));
  };

  // 1. Loading state while Firebase checks authentication
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-slate-900 relative overflow-hidden">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:3rem_3rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-60 pointer-events-none" />
        <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white shadow-xl shadow-blue-500/20 mb-6 border border-blue-500/30 animate-pulse">
          <ShieldCheck className="w-8 h-8" />
        </div>
        <div className="flex items-center gap-2 mb-2 font-mono">
          <span className="text-xl font-bold tracking-tight text-slate-900">Vision<span className="text-blue-600">QC</span></span>
          <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold border border-blue-200">PRO</span>
        </div>
        <div className="flex items-center gap-2.5 text-xs text-slate-500 font-mono mt-3">
          <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
          <span>Verifying secure operator session & credentials...</span>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated state: Protected pages barrier
  if (!currentUser) {
    return (
      <>
        {authMode === 'login' ? (
          <LoginPage
            onSwitchToSignUp={() => setAuthMode('signup')}
            onForgotPassword={() => setShowForgotPassword(true)}
          />
        ) : (
          <SignUpPage
            onSwitchToLogin={() => setAuthMode('login')}
          />
        )}

        {showForgotPassword && (
          <ForgotPasswordModal
            onClose={() => setShowForgotPassword(false)}
          />
        )}
      </>
    );
  }

  // 3. Authenticated state: Full access to all protected VisionQC pages
  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar Navigation with User profile and Logout */}
      <Sidebar
        currentSection={currentSection}
        onNavigate={setCurrentSection}
        mobileOpen={mobileSidebarOpen}
        onCloseMobile={() => setMobileSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          currentSection={currentSection}
          onOpenMobile={() => setMobileSidebarOpen(true)}
          totalInspections={inspections.length}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {currentSection === 'dashboard' && (
            <DashboardView
              products={products}
              inspections={inspections}
              onNavigate={setCurrentSection}
              onSelectInspectionRecord={setSelectedInspection}
              onCreateProduct={() => setShowCreateProductModal(true)}
            />
          )}

          {currentSection === 'inspection' && (
            <InspectionView
              products={products}
              currentProduct={currentProduct}
              threshold={config.anomalyThreshold}
              audibleAlerts={config.audibleAlerts}
              onUpdateThreshold={handleUpdateThreshold}
              onSelectProduct={setCurrentProduct}
              onRecordInspection={handleRecordInspection}
              onNavigate={setCurrentSection}
              onCreateProduct={() => setShowCreateProductModal(true)}
            />
          )}

          {currentSection === 'dataset' && (
            <DatasetView
              products={products}
              currentProduct={currentProduct}
              onSelectProduct={setCurrentProduct}
              onCreateProduct={() => setShowCreateProductModal(true)}
            />
          )}

          {currentSection === 'history' && (
            <HistoryView
              inspections={inspections}
              onSelectRecord={setSelectedInspection}
              onNavigate={setCurrentSection}
            />
          )}

          {currentSection === 'settings' && (
            <SettingsView
              config={config}
              onSaveConfig={handleSaveConfig}
            />
          )}
        </main>
      </div>

      {/* Inspection Detail Modal */}
      {selectedInspection && (
        <InspectionDetailModal
          record={selectedInspection}
          onClose={() => setSelectedInspection(null)}
        />
      )}

      {/* Register Product Modal */}
      {showCreateProductModal && (
        <CreateProductModal
          onClose={() => setShowCreateProductModal(false)}
          onProductCreated={handleProductCreated}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedVisionQCApp />
    </AuthProvider>
  );
}

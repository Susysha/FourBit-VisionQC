import React, { useState } from 'react';
import { ProductPart } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { createProduct } from '../services/firebase';
import { 
  FolderPlus, 
  X, 
  Layers, 
  Barcode, 
  Sliders, 
  Tag, 
  Workflow, 
  Loader2, 
  AlertCircle 
} from 'lucide-react';

interface CreateProductModalProps {
  onClose: () => void;
  onProductCreated: (newProduct: ProductPart) => void;
}

export const CreateProductModal: React.FC<CreateProductModalProps> = ({
  onClose,
  onProductCreated,
}) => {
  const { currentUser } = useAuth();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState('Machined Components');
  const [nominalThreshold, setNominalThreshold] = useState<number>(0.85);
  const [activeLine, setActiveLine] = useState('Line 01 - Optical Bench');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please provide a valid product name.');
      return;
    }
    if (!sku.trim()) {
      setError('Please specify a product SKU.');
      return;
    }
    if (!currentUser) {
      setError('You must be signed in to create a product.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const created = await createProduct(currentUser.uid, {
        name: name.trim(),
        sku: sku.trim(),
        category,
        nominalThreshold,
        sampleCount: 0,
        activeLine,
      });

      onProductCreated(created);
      onClose();
    } catch (err) {
      console.error('Failed to create product in Firestore:', err);
      setError('Failed to save product to Firestore. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div 
        className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
              <FolderPlus className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold font-mono text-slate-900">
                Register New Product Part
              </h3>
              <p className="text-xs text-slate-500 font-sans">
                Saved directly to your authenticated Firestore account
              </p>
            </div>
          </div>

          <button 
            type="button"
            onClick={onClose} 
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs font-mono text-rose-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Product Name */}
          <div>
            <label className="block text-xs font-mono font-medium text-slate-700 mb-1">
              Product / Part Name *
            </label>
            <div className="relative">
              <Layers className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Precision Steel Bearing 6204"
                className="w-full pl-9 pr-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>
          </div>

          {/* SKU & Category */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-mono font-medium text-slate-700 mb-1">
                Part SKU / Code *
              </label>
              <div className="relative">
                <Barcode className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="e.g. SKU-BRG-6204"
                  className="w-full pl-9 pr-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white uppercase"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-mono font-medium text-slate-700 mb-1">
                Category
              </label>
              <div className="relative">
                <Tag className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                >
                  <option value="Machined Components">Machined Components</option>
                  <option value="Electronics Assembly">Electronics Assembly</option>
                  <option value="Fasteners & Hardware">Fasteners & Hardware</option>
                  <option value="Injection Molded Plastics">Injection Molded Plastics</option>
                  <option value="Castings & Forgings">Castings & Forgings</option>
                  <option value="Custom Components">Custom Components</option>
                </select>
              </div>
            </div>
          </div>

          {/* Nominal Threshold Slider */}
          <div>
            <div className="flex items-center justify-between text-xs font-mono text-slate-700 mb-1">
              <span className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 text-slate-400" />
                Nominal Anomaly Threshold:
              </span>
              <span className="font-bold text-blue-600">{nominalThreshold.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.10"
              max="0.95"
              step="0.01"
              value={nominalThreshold}
              onChange={(e) => setNominalThreshold(parseFloat(e.target.value))}
              className="w-full accent-blue-600 cursor-pointer h-1.5 bg-slate-200 rounded-lg appearance-none"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-400 mt-1">
              <span>Strict (0.10)</span>
              <span>Default (0.85)</span>
              <span>Permissive (0.95)</span>
            </div>
          </div>

          {/* Active Line */}
          <div>
            <label className="block text-xs font-mono font-medium text-slate-700 mb-1">
              Target Inspection Line
            </label>
            <div className="relative">
              <Workflow className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={activeLine}
                onChange={(e) => setActiveLine(e.target.value)}
                placeholder="e.g. Line 01 - Optical Bench"
                className="w-full pl-9 pr-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-mono text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-mono font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm flex items-center gap-1.5 disabled:opacity-50 transition-colors"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Registering...</span>
                </>
              ) : (
                <>
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>Create Product</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

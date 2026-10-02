import React, { useState } from 'react';
import { InspectionRecord } from '../types';
import { PartSvgRenderer } from '../utils/partSvgRenderer';
import { CheckCircle2, XCircle, Clock, AlertCircle, X, ShieldCheck, Layers, Flame, Image as ImageIcon } from 'lucide-react';

interface InspectionDetailModalProps {
  record: InspectionRecord | null;
  onClose: () => void;
}

export const InspectionDetailModal: React.FC<InspectionDetailModalProps> = ({
  record,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'image' | 'overlay' | 'heatmap'>('overlay');

  if (!record) return null;

  const isPass = record.status === 'PASS';
  const name = (record.product_name || '').toLowerCase();
  const svgType = name.includes('bearing')
    ? (isPass ? 'bearing-pass' : 'bearing-fail')
    : name.includes('pcb') || name.includes('board')
    ? (isPass ? 'pcb-pass' : 'pcb-fail')
    : (isPass ? 'bolt-pass' : 'bolt-fail');

  const hasImage = !!(record.imageUrl || record.imageDataUrl);
  const hasHeatmap = !!record.heatmapUrl;
  const hasOverlay = !!record.overlayUrl;
  const score = (record.anomaly_score ?? record.anomalyScore ?? 0);

  // Determine which image URL to display based on active tab
  let displayImage = record.imageUrl || record.imageDataUrl;
  if (activeTab === 'overlay' && hasOverlay) {
    displayImage = record.overlayUrl;
  } else if (activeTab === 'heatmap' && hasHeatmap) {
    displayImage = record.heatmapUrl;
  }

  return (
    <div 
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn"
      onClick={onClose}
    >
      <div 
        className="bg-white border border-slate-200 rounded-xl max-w-2xl w-full p-6 shadow-2xl space-y-5 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <span className={`
              px-2.5 py-1 rounded text-xs font-mono font-bold border tracking-wider
              ${isPass 
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                : 'bg-rose-50 text-rose-700 border-rose-200'}
            `}>
              {record.status}
            </span>
            <div>
              <h3 className="text-base font-bold font-mono text-slate-900">
                {record.product_name}
              </h3>
              <div className="text-xs text-slate-500 font-mono">
                Record ID: {record.id} · Cloud Firestore
              </div>
            </div>
          </div>

          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* View Tab Selector if Heatmap / Overlay Available */}
        {(hasOverlay || hasHeatmap) && (
          <div className="flex items-center justify-between bg-slate-100 p-1 rounded-lg text-xs font-mono">
            <div className="flex items-center gap-1">
              {hasOverlay && (
                <button
                  type="button"
                  onClick={() => setActiveTab('overlay')}
                  className={`px-3 py-1.5 rounded-md font-semibold transition-colors flex items-center gap-1.5 ${
                    activeTab === 'overlay' ? 'bg-white text-blue-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5 text-blue-600" />
                  <span>Blended Overlay</span>
                </button>
              )}
              {hasHeatmap && (
                <button
                  type="button"
                  onClick={() => setActiveTab('heatmap')}
                  className={`px-3 py-1.5 rounded-md font-semibold transition-colors flex items-center gap-1.5 ${
                    activeTab === 'heatmap' ? 'bg-white text-rose-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Flame className="w-3.5 h-3.5 text-rose-600" />
                  <span>Anomaly Heatmap</span>
                </button>
              )}
              {hasImage && (
                <button
                  type="button"
                  onClick={() => setActiveTab('image')}
                  className={`px-3 py-1.5 rounded-md font-semibold transition-colors flex items-center gap-1.5 ${
                    activeTab === 'image' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5 text-slate-500" />
                  <span>Original Capture</span>
                </button>
              )}
            </div>

            {record.inferenceTimeMs && (
              <span className="text-[10px] text-slate-400 px-2">
                Latency: {record.inferenceTimeMs}ms
              </span>
            )}
          </div>
        )}

        {/* Part Capture View */}
        <div className="aspect-[16/9] bg-slate-950 rounded-lg overflow-hidden border border-slate-200 relative flex items-center justify-center">
          {displayImage ? (
            <img
              src={displayImage}
              alt={record.product_name}
              className="w-full h-full object-contain"
            />
          ) : (
            <PartSvgRenderer type={svgType} />
          )}
        </div>

        {/* Quality Diagnostics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
          <div className="bg-slate-50 p-3 rounded-md border border-slate-200">
            <div className="text-[10px] text-slate-400 uppercase">Anomaly Score</div>
            <div className={`text-lg font-bold mt-0.5 ${isPass ? 'text-emerald-600' : 'text-rose-600'}`}>
              {score.toFixed(2)}
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-md border border-slate-200">
            <div className="text-[10px] text-slate-400 uppercase">Decision Threshold</div>
            <div className="text-lg font-bold text-slate-700 mt-0.5">
              {record.threshold.toFixed(2)}
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-md border border-slate-200">
            <div className="text-[10px] text-slate-400 uppercase">Quality Outcome</div>
            <div className={`text-xs font-bold mt-1 ${isPass ? 'text-emerald-700' : 'text-rose-700'}`}>
              {isPass ? 'CONFORMANT' : 'DEFECT / REJECT'}
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-md border border-slate-200">
            <div className="text-[10px] text-slate-400 uppercase">Batch Number</div>
            <div className="text-[11px] font-mono text-slate-600 mt-1 truncate">
              {record.batchNumber || 'N/A'}
            </div>
          </div>
        </div>

        {/* Defect Diagnostics Description */}
        {!isPass ? (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-md text-xs font-mono text-rose-800 space-y-1">
            <div className="font-bold flex items-center justify-between text-rose-900">
              <span className="flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-rose-600" />
                <span>Surface Anomaly Detected ({score.toFixed(2)} ≥ {record.threshold.toFixed(2)})</span>
              </span>
              {record.defectLocation && (
                <span className="text-[11px] bg-rose-100 text-rose-800 px-2 py-0.5 rounded font-bold">
                  Location: {record.defectLocation}
                </span>
              )}
            </div>
            <div className="text-rose-700 text-[11px]">
              {record.defectType || 'PatchCore feature distance exceeded tolerance limits.'}
              {record.suspectedDefectRegion?.description && (
                <span className="ml-2 font-semibold">({record.suspectedDefectRegion.description})</span>
              )}
            </div>
          </div>
        ) : (
          <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-md text-xs font-mono text-emerald-800 space-y-1">
            <div className="font-bold flex items-center gap-1.5 text-emerald-900">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Conforming Part ({score.toFixed(2)} &lt; {record.threshold.toFixed(2)})</span>
            </div>
            <div className="text-emerald-700 text-[11px]">
              All optical features within nominal tolerance established by the reference model.
            </div>
          </div>
        )}

        {/* Audit Metadata */}
        <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs font-mono text-slate-500">
          <span>Inspection Line: {record.inspectionLine || 'Station QC-01'}</span>
          <span>Logged at {record.timestamp}</span>
        </div>

      </div>
    </div>
  );
};

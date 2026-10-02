import React, { useState } from 'react';
import { SystemConfig } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { 
  Settings as SettingsIcon, 
  Sliders, 
  Camera, 
  Server, 
  HardDrive, 
  CheckCircle2, 
  Save,
  Cpu,
  ShieldAlert,
  User,
  LogOut,
  Calendar,
  KeyRound
} from 'lucide-react';

interface SettingsViewProps {
  config: SystemConfig;
  onSaveConfig: (newConfig: SystemConfig) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  config,
  onSaveConfig,
}) => {
  const { currentUser, userProfile, logout } = useAuth();
  const [formData, setFormData] = useState<SystemConfig>(config);
  const [savedSuccess, setSavedSuccess] = useState<boolean>(false);

  const displayName = userProfile?.fullName || currentUser?.displayName || 'Operator';
  const displayEmail = userProfile?.email || currentUser?.email || 'Unknown';
  const createdDate = userProfile?.createdAt 
    ? new Date(userProfile.createdAt).toLocaleDateString(undefined, { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      })
    : 'Active';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveConfig(formData);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
        <div>
          <h2 className="text-base font-bold font-mono text-slate-900 uppercase tracking-wide">
            VisionQC System & Hardware Settings
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure optical cameras, quality tolerance thresholds, and operator identity.
          </p>
        </div>

        <button
          onClick={handleSubmit}
          className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs font-bold rounded-md transition-colors shadow-xs cursor-pointer"
        >
          <Save className="w-4 h-4" />
          <span>Save Changes</span>
        </button>
      </div>

      {savedSuccess && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs font-mono text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>System configuration saved successfully.</span>
        </div>
      )}

      {/* Operator Account & Profile Section */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-slate-900 uppercase">
            <User className="w-4 h-4 text-blue-600" />
            <span>Active Operator Profile</span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Authenticated
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-xs font-mono">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Operator Name</div>
            <div className="font-bold text-slate-900 text-sm">{displayName}</div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Registered Email</div>
            <div className="font-semibold text-slate-800 truncate" title={displayEmail}>{displayEmail}</div>
          </div>

          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
            <div className="text-[11px] text-slate-400 uppercase tracking-wider mb-1">Registered Since</div>
            <div className="font-semibold text-slate-800 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              <span>{createdDate}</span>
            </div>
          </div>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
          <div className="text-slate-500 flex items-center gap-2">
            <KeyRound className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px]">User UID: <span className="text-slate-700 font-mono">{currentUser?.uid || 'N/A'}</span></span>
          </div>

          <button
            type="button"
            onClick={() => logout()}
            className="px-3.5 py-1.5 border border-rose-200 hover:bg-rose-50 text-rose-700 rounded-md font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign Out Operator</span>
          </button>
        </div>
      </div>

      {/* Settings Grid */}
      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* Section 1: Quality Thresholds */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-200 text-xs font-mono font-bold text-slate-900 uppercase">
            <Sliders className="w-4 h-4 text-blue-600" />
            <span>Inspection Decision Threshold</span>
          </div>

          <div className="space-y-4 text-xs font-mono">
            <div>
              <div className="flex justify-between text-slate-700 mb-1">
                <span>Anomaly Threshold:</span>
                <strong className="text-blue-700 text-base">{formData.anomalyThreshold.toFixed(2)}</strong>
              </div>
              <input
                type="range"
                min="0.10"
                max="0.90"
                step="0.01"
                value={formData.anomalyThreshold}
                onChange={(e) => setFormData({ ...formData, anomalyThreshold: parseFloat(e.target.value) })}
                className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
              />
              <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                <span>0.10 (Strict)</span>
                <span className="font-semibold text-slate-600">0.50 (Standard Factory Default)</span>
                <span>0.90 (Permissive)</span>
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-600 leading-relaxed font-sans">
              <strong>Decision Logic: </strong>
              <code className="text-emerald-700 bg-white px-1 py-0.5 rounded border border-slate-200">Anomaly score &lt; {formData.anomalyThreshold.toFixed(2)} → PASS</code>
              {' '}and{' '}
              <code className="text-rose-700 bg-white px-1 py-0.5 rounded border border-slate-200">Anomaly score ≥ {formData.anomalyThreshold.toFixed(2)} → FAIL</code>.
            </div>

            <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-slate-800 font-semibold">Audible Alert on Defective Unit</div>
                <div className="text-[11px] text-slate-500">Play factory alert chime when defect threshold is breached.</div>
              </div>
              <input
                type="checkbox"
                checked={formData.audibleAlerts}
                onChange={(e) => setFormData({ ...formData, audibleAlerts: e.target.checked })}
                className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-0"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Industrial Camera Optics */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-200 text-xs font-mono font-bold text-slate-900 uppercase">
            <Camera className="w-4 h-4 text-blue-600" />
            <span>Optical Sensor & Camera Interface</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
            <div>
              <label className="text-slate-600 block mb-1">Camera Interface Type</label>
              <select
                value={formData.cameraInterface}
                onChange={(e) => setFormData({ ...formData, cameraInterface: e.target.value })}
                className="w-full bg-slate-50 border border-slate-300 text-slate-800 px-3 py-2 rounded-md focus:border-blue-500 focus:outline-none"
              >
                <option value="GigE Vision (Basler ace 2 Pro)">GigE Vision (Basler ace 2 Pro)</option>
                <option value="USB3 Vision (FLIR Blackfly S)">USB3 Vision (FLIR Blackfly S)</option>
                <option value="RTSP Industrial Stream (GenICam)">RTSP Industrial Stream (GenICam)</option>
                <option value="Manual Image Ingestion / File System">Manual Image Ingestion / File System</option>
              </select>
            </div>

            <div>
              <label className="text-slate-600 block mb-1">Acquisition Resolution & Rate</label>
              <select
                value={formData.streamResolution}
                onChange={(e) => setFormData({ ...formData, streamResolution: e.target.value })}
                className="w-full bg-slate-50 border border-slate-300 text-slate-800 px-3 py-2 rounded-md focus:border-blue-500 focus:outline-none"
              >
                <option value="1920 × 1080 @ 60 FPS">1920 × 1080 @ 60 FPS (FHD Telecentric)</option>
                <option value="1280 × 720 @ 120 FPS">1280 × 720 @ 120 FPS (High-Speed Line)</option>
                <option value="2448 × 2048 @ 30 FPS">2448 × 2048 @ 30 FPS (5MP High-Precision)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 3: Model Backend Connector */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-200 text-xs font-mono font-bold text-slate-900 uppercase">
            <Server className="w-4 h-4 text-blue-600" />
            <span>Computer Vision Inference Server</span>
          </div>

          <div className="space-y-3 text-xs font-mono">
            <div>
              <label className="text-slate-600 block mb-1">Inference API Endpoint URL</label>
              <input
                type="text"
                value={formData.backendEndpoint}
                onChange={(e) => setFormData({ ...formData, backendEndpoint: e.target.value })}
                className="w-full bg-slate-50 border border-slate-300 text-slate-900 px-3 py-2 rounded-md focus:border-blue-500 focus:outline-none"
              />
              <p className="text-[11px] text-slate-400 mt-1 font-sans">
                Endpoint where optical inspection frames will be transmitted for model evaluation.
              </p>
            </div>

            <div className="p-3 bg-slate-50 rounded-md border border-slate-200 text-slate-600 flex items-center justify-between">
              <div>
                <span className="font-semibold text-slate-800">Connector State: </span>
                <span className="text-blue-700 font-semibold">Ready for Model Server</span>
              </div>
              <span className="text-[11px] text-slate-400">REST / OpenAPI Schema v1</span>
            </div>
          </div>
        </div>

        {/* Section 4: Station Info & Retention */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-200 text-xs font-mono font-bold text-slate-900 uppercase">
            <HardDrive className="w-4 h-4 text-blue-600" />
            <span>Station Identity & Data Retention</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
            <div>
              <label className="text-slate-600 block mb-1">Station Identifier</label>
              <input
                type="text"
                value={formData.stationId}
                onChange={(e) => setFormData({ ...formData, stationId: e.target.value })}
                className="w-full bg-slate-50 border border-slate-300 text-slate-900 px-3 py-2 rounded-md focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="text-slate-600 block mb-1">Active Inspector Badge</label>
              <input
                type="text"
                value={formData.inspectorName}
                onChange={(e) => setFormData({ ...formData, inspectorName: e.target.value })}
                className="w-full bg-slate-50 border border-slate-300 text-slate-900 px-3 py-2 rounded-md focus:border-blue-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

      </form>

    </div>
  );
};

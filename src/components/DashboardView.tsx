import React from 'react';
import { ProductPart, InspectionRecord, NavSection } from '../types';
import { PartSvgRenderer } from '../utils/partSvgRenderer';
import { 
  CheckCircle2, 
  XCircle, 
  ScanLine, 
  TrendingUp, 
  ArrowRight, 
  Calendar, 
  Layers, 
  BarChart3, 
  FolderPlus,
  Clock,
  ShieldCheck
} from 'lucide-react';

interface DashboardViewProps {
  products: ProductPart[];
  inspections: InspectionRecord[];
  onNavigate: (section: NavSection) => void;
  onSelectInspectionRecord: (record: InspectionRecord) => void;
  onCreateProduct?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  products,
  inspections,
  onNavigate,
  onSelectInspectionRecord,
  onCreateProduct,
}) => {
  // Real statistics derived purely from the authenticated user's actual Firestore data
  const total = inspections.length;
  const pass = inspections.filter((i) => i.status === 'PASS').length;
  const fail = inspections.filter((i) => i.status === 'FAIL').length;
  const rejectionRate = total > 0 ? (fail / total) * 100 : 0;

  // Real today's counts based on current date prefix
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayInspections = inspections.filter((i) => (i.timestamp || '').startsWith(todayStr));
  const todayTotal = todayInspections.length;
  const todayPass = todayInspections.filter((i) => i.status === 'PASS').length;
  const todayFail = todayInspections.filter((i) => i.status === 'FAIL').length;

  const recentInspections = inspections.slice(0, 6);

  const getSvgForPart = (productName: string, isPass: boolean) => {
    const p = (productName || '').toLowerCase();
    if (p.includes('bearing')) {
      return isPass ? 'bearing-pass' : 'bearing-fail';
    }
    if (p.includes('pcb') || p.includes('board')) {
      return isPass ? 'pcb-pass' : 'pcb-fail';
    }
    return isPass ? 'bolt-pass' : 'bolt-fail';
  };

  return (
    <div className="space-y-6">
      
      {/* 5 Real Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        
        {/* Total Inspections */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-mono text-slate-500 uppercase">
            <span>Total Inspections</span>
            <ScanLine className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-slate-900 tracking-tight tabular-nums">
            {total.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono">
            {total === 0 ? 'No inspections recorded' : 'Firestore Real Log'}
          </div>
        </div>

        {/* Total PASS */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-mono text-slate-500 uppercase">
            <span>Total PASS</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-emerald-600 tracking-tight tabular-nums">
            {pass.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-emerald-700 font-medium font-mono flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>{total > 0 ? ((pass / total) * 100).toFixed(1) : 0}% All-Time</span>
          </div>
        </div>

        {/* Total FAIL */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-mono text-slate-500 uppercase">
            <span>Total FAIL</span>
            <XCircle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-rose-600 tracking-tight tabular-nums">
            {fail.toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-rose-700 font-medium font-mono flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
            <span>Rejects Diverted</span>
          </div>
        </div>

        {/* Rejection Rate */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-mono text-slate-500 uppercase">
            <span>Rejection Rate</span>
            <TrendingUp className="w-4 h-4 text-rose-600" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-rose-600 tracking-tight tabular-nums">
            {rejectionRate.toFixed(2)}%
          </div>
          <div className="mt-1 text-[11px] text-slate-500 font-mono">
            {total === 0 ? 'No data yet' : 'Calculated from actual audits'}
          </div>
        </div>

        {/* Today's Inspections */}
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
          <div className="flex items-center justify-between text-xs font-mono text-slate-500 uppercase">
            <span>Today's Inspections</span>
            <Calendar className="w-4 h-4 text-blue-600" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-slate-900 tracking-tight tabular-nums">
            {todayTotal}
          </div>
          <div className="mt-1 text-[11px] text-blue-700 font-semibold font-mono">
            {todayPass} Pass · {todayFail} Fail
          </div>
        </div>

      </div>

      {/* Product Parts Status Overview Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-900 font-mono uppercase tracking-wide">
              Registered Products
            </h2>
            <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
              {products.length} {products.length === 1 ? 'part' : 'parts'}
            </span>
          </div>

          {onCreateProduct && (
            <button
              onClick={onCreateProduct}
              className="text-xs font-mono font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1.5 self-start sm:self-auto"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Register Product</span>
            </button>
          )}
        </div>

        {products.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
              <Layers className="w-5 h-5" />
            </div>
            <div className="text-xs font-mono font-bold text-slate-700">No products yet</div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto font-sans">
              Create an inspected product part before uploading training reference datasets or recording inspection outcomes.
            </p>
            {onCreateProduct && (
              <button
                onClick={onCreateProduct}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>Create First Product</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
            {products.map((p) => (
              <div 
                key={p.id}
                className="p-3 bg-slate-50 border border-slate-200 rounded-lg hover:border-slate-300 transition-colors"
              >
                <div className="text-xs font-mono font-bold text-slate-900 truncate">{p.name}</div>
                <div className="text-[11px] font-mono text-slate-500 mt-0.5">{p.sku}</div>
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-600 mt-2 pt-2 border-t border-slate-200">
                  <span>Threshold: <strong>{p.nominalThreshold.toFixed(2)}</strong></span>
                  <span className="text-blue-600">{p.category}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Main Grid: PASS vs FAIL Chart & Recent Inspection Results */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* PASS vs FAIL Distribution (5 Cols) */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h2 className="text-sm font-bold text-slate-900 font-mono uppercase tracking-wide">
                  PASS vs FAIL Distribution
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Actual inspection outcome breakdown
                </p>
              </div>
              <BarChart3 className="w-4 h-4 text-slate-400" />
            </div>

            {total === 0 ? (
              <div className="py-12 text-center space-y-2">
                <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                  <BarChart3 className="w-4 h-4" />
                </div>
                <div className="text-xs font-mono text-slate-600 font-medium">No inspections yet</div>
                <p className="text-xs text-slate-400 max-w-xs mx-auto">
                  Quality outcome statistics will calculate automatically as real parts are inspected.
                </p>
              </div>
            ) : (
              <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="flex items-center gap-2 font-semibold text-emerald-700">
                    <span className="w-3 h-3 rounded-xs bg-emerald-500" />
                    <span>PASS: {pass} units</span>
                  </span>
                  <span className="font-bold text-slate-900">
                    {total > 0 ? ((pass / total) * 100).toFixed(1) : '0.0'}%
                  </span>
                </div>

                {/* Progress split bar */}
                <div className="h-5 w-full bg-slate-200 rounded-md overflow-hidden flex border border-slate-300">
                  <div 
                    className="bg-emerald-500 h-full flex items-center justify-center text-[10px] font-mono text-white font-bold transition-all duration-300"
                    style={{ width: `${total > 0 ? (pass / total) * 100 : 0}%` }}
                  >
                    {total > 0 ? ((pass / total) * 100).toFixed(0) : 0}%
                  </div>
                  <div 
                    className="bg-rose-500 h-full flex items-center justify-center text-[10px] font-mono text-white font-bold transition-all duration-300"
                    style={{ width: `${total > 0 ? (fail / total) * 100 : 0}%` }}
                  >
                    {total > 0 ? ((fail / total) * 100).toFixed(0) : 0}%
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="flex items-center gap-2 font-semibold text-rose-700">
                    <span className="w-3 h-3 rounded-xs bg-rose-500" />
                    <span>FAIL: {fail} units</span>
                  </span>
                  <span className="font-bold text-slate-900">{rejectionRate.toFixed(1)}%</span>
                </div>
              </div>
            )}
          </div>

          <div className="mt-5 pt-3 border-t border-slate-200 text-xs font-mono text-slate-500 flex items-center justify-between">
            <span>Firestore Isolated Session</span>
            <span className={total > 0 ? "text-emerald-600 font-semibold" : "text-slate-400"}>
              {total > 0 ? "Quality Status: ACTIVE" : "Quality Status: READY"}
            </span>
          </div>
        </div>

        {/* Recent Inspection Results (7 Cols) */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 shadow-xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <div>
                <h2 className="text-sm font-bold text-slate-900 font-mono uppercase tracking-wide">
                  Recent Inspection Results
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Live verified outcomes from optical inspections
                </p>
              </div>

              <button
                onClick={() => onNavigate('inspection')}
                className="text-xs font-mono font-medium text-blue-600 hover:text-blue-700 flex items-center gap-1"
              >
                <span>Launch Camera</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* List of real results */}
            <div className="divide-y divide-slate-100 mt-1">
              {recentInspections.length === 0 ? (
                <div className="py-14 text-center space-y-2">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div className="text-xs font-mono font-bold text-slate-700">No inspections yet</div>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto font-sans">
                    Inspections will appear here in real time as visual quality checks are captured.
                  </p>
                  <button
                    onClick={() => onNavigate('inspection')}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium text-blue-600 hover:text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                  >
                    <span>Start First Inspection</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                recentInspections.map((item) => {
                  const isItemPass = item.status === 'PASS';
                  const svgType = getSvgForPart(item.product_name, isItemPass);

                  return (
                    <div
                      key={item.id}
                      onClick={() => onSelectInspectionRecord(item)}
                      className="py-2.5 px-2 flex items-center justify-between hover:bg-slate-50 rounded-md transition-colors cursor-pointer group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Part thumbnail */}
                        <div className="w-10 h-10 rounded border border-slate-200 overflow-hidden bg-slate-50 shrink-0">
                          <PartSvgRenderer type={svgType} />
                        </div>

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-slate-900 truncate">
                              {item.product_name}
                            </span>
                            <span className="font-mono text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200">
                              {item.id}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 font-mono">
                            <span>{item.timestamp}</span>
                            <span>·</span>
                            <span>Score: <strong className={isItemPass ? 'text-emerald-600' : 'text-rose-600'}>{item.anomaly_score.toFixed(2)}</strong></span>
                          </div>
                        </div>
                      </div>

                      {/* Result badge & score */}
                      <div className="flex items-center gap-3 shrink-0">
                        <div className="text-right font-mono text-xs hidden sm:block">
                          <div className="text-[10px] text-slate-400">Threshold</div>
                          <div className="text-slate-700 font-semibold">
                            {item.threshold.toFixed(2)}
                          </div>
                        </div>

                        <span className={`
                          px-2.5 py-1 rounded text-xs font-mono font-bold border tracking-wider
                          ${isItemPass 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                            : 'bg-rose-50 text-rose-700 border-rose-200'}
                        `}>
                          {item.status}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-xs font-mono">
            <span className="text-slate-500">Auto-updating with each completed inspection</span>
            <button
              onClick={() => onNavigate('history')}
              className="text-blue-600 hover:text-blue-700 font-semibold"
            >
              View Full Audit Log →
            </button>
          </div>
        </div>

      </div>

    </div>
  );
};

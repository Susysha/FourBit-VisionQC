import React, { useState } from 'react';
import { InspectionRecord, NavSection } from '../types';
import { PartSvgRenderer } from '../utils/partSvgRenderer';
import { 
  History as HistoryIcon, 
  Search, 
  CheckCircle2, 
  XCircle, 
  ChevronRight, 
  ArrowUpDown, 
  Download, 
  Clock,
  ArrowRight
} from 'lucide-react';

interface HistoryViewProps {
  inspections: InspectionRecord[];
  onSelectRecord: (record: InspectionRecord) => void;
  onNavigate?: (section: NavSection) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  inspections,
  onSelectRecord,
  onNavigate,
}) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [resultFilter, setResultFilter] = useState<'ALL' | 'PASS' | 'FAIL'>('ALL');
  const [sortOrder, setSortOrder] = useState<'DESC' | 'ASC'>('DESC');

  // Filter and sort the user's real Firestore inspection records
  const filteredRecords = inspections.filter((record) => {
    const matchesFilter = resultFilter === 'ALL' || record.status === resultFilter;
    const matchesSearch = 
      !searchQuery.trim() ||
      record.product_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      record.id.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const sortedRecords = [...filteredRecords].sort((a, b) => {
    if (sortOrder === 'ASC') {
      return (a.timestamp || '').localeCompare(b.timestamp || '');
    }
    return (b.timestamp || '').localeCompare(a.timestamp || '');
  });

  const handleExportCsv = () => {
    if (sortedRecords.length === 0) return;

    const headers = ['ID', 'Date and Time', 'Product Name', 'Anomaly Score', 'Threshold', 'Result', 'Image Path'];
    const rows = sortedRecords.map(r => [
      r.id,
      `"${r.timestamp}"`,
      `"${r.product_name}"`,
      (r.anomaly_score ?? r.anomalyScore).toFixed(2),
      r.threshold.toFixed(2),
      r.status,
      `"${r.image_path || r.imageUrl || ''}"`
    ]);

    const content = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `visionqc_inspections_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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
      
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <HistoryIcon className="w-5 h-5 text-blue-600" />
            <h1 className="text-base font-bold font-mono text-slate-900 uppercase tracking-wide">
              Quality Inspection Audit Log
            </h1>
          </div>
          <p className="text-xs text-slate-500 mt-1 font-sans">
            Real optical quality inspection outcomes stored under your authenticated account.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {sortedRecords.length > 0 && (
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-mono font-semibold rounded-md transition-colors"
            >
              <Download className="w-4 h-4 text-blue-600" />
              <span>Export CSV</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter, Search & Sort Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
        
        {/* Search */}
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by product name or ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-50 border border-slate-300 text-slate-900 pl-8 pr-3 py-1.5 rounded-md text-xs font-mono focus:border-blue-500 focus:outline-none placeholder:text-slate-400"
          />
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          
          {/* PASS / FAIL Filter */}
          <div className="flex items-center bg-slate-100 rounded-md p-0.5 border border-slate-200">
            {(['ALL', 'PASS', 'FAIL'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setResultFilter(filter)}
                className={`px-3 py-1 rounded text-xs transition-colors ${
                  resultFilter === filter
                    ? filter === 'PASS' 
                      ? 'bg-emerald-500 text-white font-bold'
                      : filter === 'FAIL'
                      ? 'bg-rose-600 text-white font-bold'
                      : 'bg-white text-slate-900 font-bold shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>

          {/* Sort by Date */}
          <button
            onClick={() => setSortOrder(prev => prev === 'DESC' ? 'ASC' : 'DESC')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 transition-colors"
          >
            <ArrowUpDown className="w-3.5 h-3.5 text-blue-600" />
            <span>Date: {sortOrder === 'DESC' ? 'Newest First' : 'Oldest First'}</span>
          </button>

        </div>

      </div>

      {/* Main Records Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs font-mono border-collapse">
            <thead>
              <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-600 uppercase text-[10px] tracking-wider">
                <th className="py-3 px-4">Inspection ID</th>
                <th className="py-3 px-3">Capture</th>
                <th className="py-3 px-4">Product Name</th>
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-3 text-right">Anomaly Score</th>
                <th className="py-3 px-3 text-right">Threshold</th>
                <th className="py-3 px-3 text-center">Result</th>
                <th className="py-3 px-4">Reference Source</th>
                <th className="py-3 px-3 text-center">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {inspections.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center">
                    <div className="space-y-2 max-w-sm mx-auto">
                      <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                        <Clock className="w-5 h-5" />
                      </div>
                      <div className="font-bold text-slate-700 text-xs">No inspections yet</div>
                      <p className="text-slate-400 text-xs font-sans">
                        Inspection records will appear here as visual quality checks are performed in the Inspection chamber.
                      </p>
                      {onNavigate && (
                        <button
                          onClick={() => onNavigate('inspection')}
                          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-colors"
                        >
                          <span>Launch Inspection Chamber</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : sortedRecords.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    No inspection records matched the current filter or search criteria.
                  </td>
                </tr>
              ) : (
                sortedRecords.map((item) => {
                  const isPass = item.status === 'PASS';
                  const isInvalid = item.status === 'INVALID';
                  const svgType = getSvgForPart(item.product_name, isPass);
                  const hasImage = !!(item.imageUrl || item.imageDataUrl);

                  return (
                    <tr
                      key={item.id}
                      onClick={() => onSelectRecord(item)}
                      className="hover:bg-slate-50 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 font-bold text-slate-900 whitespace-nowrap">
                        {item.id}
                      </td>

                      <td className="py-2.5 px-3">
                        <div className="w-10 h-8 rounded border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center">
                          {hasImage ? (
                            <img
                              src={item.imageUrl || item.imageDataUrl}
                              alt={item.product_name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <PartSvgRenderer type={svgType} />
                          )}
                        </div>
                      </td>

                      <td className="py-3 px-4 text-slate-800 font-semibold max-w-[220px] truncate">
                        {item.product_name}
                      </td>

                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        {item.timestamp}
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums">
                        <span className={`font-bold ${
                          isPass 
                            ? 'text-emerald-600' 
                            : isInvalid 
                            ? 'text-amber-600' 
                            : 'text-rose-600'
                        }`}>
                          {(item.anomaly_score ?? item.anomalyScore).toFixed(2)}
                        </span>
                      </td>

                      <td className="py-3 px-3 text-right tabular-nums text-slate-500">
                        {item.threshold.toFixed(2)}
                      </td>

                      <td className="py-3 px-3 text-center whitespace-nowrap">
                        <span className={`
                          px-2.5 py-0.5 rounded text-[11px] font-bold border tracking-wider
                          ${isPass 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                            : isInvalid
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-rose-50 text-rose-700 border-rose-200'}
                        `}>
                          {item.status}
                        </span>
                      </td>

                      <td className="py-3 px-4 text-slate-500 max-w-[200px] truncate font-mono text-[11px]">
                        {item.image_path || item.imageUrl || 'Live Camera Capture'}
                      </td>

                      <td className="py-3 px-3 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectRecord(item);
                          }}
                          className="p-1 text-slate-400 hover:text-blue-600 rounded transition-colors"
                          title="View inspection details"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs font-mono text-slate-500">
          <span>Showing {sortedRecords.length} of {inspections.length} inspection records</span>
          <span>Storage: Isolated Cloud Firestore</span>
        </div>
      </div>

    </div>
  );
};

import React from 'react';
import { NavSection } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { Menu, Clock, CheckCircle2, User, LogOut } from 'lucide-react';

interface HeaderProps {
  currentSection: NavSection;
  onOpenMobile: () => void;
  totalInspections: number;
}

export const Header: React.FC<HeaderProps> = ({
  currentSection,
  onOpenMobile,
  totalInspections,
}) => {
  const { currentUser, userProfile, logout } = useAuth();
  const getSectionTitle = (s: NavSection) => {
    switch (s) {
      case 'dashboard': return 'Quality Overview Dashboard';
      case 'inspection': return 'Optical Inspection Station';
      case 'dataset': return 'Sample Dataset Repository';
      case 'history': return 'Quality Audit History';
      case 'settings': return 'System & Hardware Configuration';
    }
  };

  const displayName = userProfile?.fullName || currentUser?.displayName || 'Operator';
  const displayEmail = userProfile?.email || currentUser?.email || '';

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30">
      
      {/* Left: Mobile hamburger + Breadcrumbs */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobile}
          className="lg:hidden p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100"
          aria-label="Open navigation"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
            <span>VisionQC</span>
            <span>/</span>
            <span className="capitalize text-blue-600 font-semibold">{currentSection}</span>
          </div>
          <h1 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
            {getSectionTitle(currentSection)}
          </h1>
        </div>
      </div>

      {/* Right: Operational telemetry & User profile */}
      <div className="flex items-center gap-2.5 sm:gap-3">
        
        <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-slate-50 border border-slate-200 rounded-md text-xs font-mono text-slate-600">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>Shift 2 · Line 01</span>
        </div>

        <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 border border-blue-200 rounded-md text-xs font-mono text-blue-700">
          <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
          <span className="font-semibold">{totalInspections} Units</span>
        </div>

        {/* User Pill with Logout */}
        <div className="flex items-center gap-2 pl-2 sm:pl-3 border-l border-slate-200">
          <div className="hidden sm:flex flex-col text-right">
            <span className="text-xs font-bold text-slate-800 leading-tight">
              {displayName}
            </span>
            <span className="text-[10px] font-mono text-slate-400 leading-tight">
              {displayEmail}
            </span>
          </div>

          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs font-mono border border-blue-200">
            {displayName[0]?.toUpperCase() || <User className="w-4 h-4" />}
          </div>

          <button
            onClick={handleLogout}
            title="Sign out of VisionQC"
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer"
            aria-label="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

      </div>

    </header>
  );
};


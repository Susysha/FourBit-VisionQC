import React from 'react';
import { NavSection } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { 
  LayoutDashboard, 
  ScanLine, 
  FolderGit2, 
  History, 
  Settings as SettingsIcon,
  ShieldCheck, 
  LogOut,
  User,
  ChevronRight
} from 'lucide-react';

interface SidebarProps {
  currentSection: NavSection;
  onNavigate: (section: NavSection) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentSection,
  onNavigate,
  mobileOpen,
  onCloseMobile,
}) => {
  const { currentUser, userProfile, logout } = useAuth();
  const navItems = [
    { id: 'dashboard' as NavSection, label: 'Dashboard', icon: LayoutDashboard, desc: 'Quality overview' },
    { id: 'inspection' as NavSection, label: 'Inspection', icon: ScanLine, desc: 'Optical analysis station' },
    { id: 'dataset' as NavSection, label: 'Dataset', icon: FolderGit2, desc: 'Reference & defect samples' },
    { id: 'history' as NavSection, label: 'History', icon: History, desc: 'Audit log & reports' },
    { id: 'settings' as NavSection, label: 'Settings', icon: SettingsIcon, desc: 'Tolerances & hardware' },
  ];

  const displayName = userProfile?.fullName || currentUser?.displayName || 'Operator';
  const displayEmail = userProfile?.email || currentUser?.email || 'No email';
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  const handleLogout = async () => {
    try {
      await logout();
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Main Sidebar */}
      <aside className={`
        fixed top-0 bottom-0 left-0 z-50 w-64 bg-white border-r border-slate-200 flex flex-col justify-between
        transition-transform duration-200 ease-in-out
        lg:static lg:translate-x-0
        ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex-1 overflow-y-auto">
          {/* Brand Header */}
          <div className="h-16 px-6 border-b border-slate-200 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-500/30">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-base tracking-tight text-slate-900 font-mono">Vision<span className="text-blue-600">QC</span></span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold border border-blue-200">PRO</span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">AI Visual Quality Control</p>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1.5">
            <div className="px-3 pb-2 text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400">
              Station Navigation
            </div>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onNavigate(item.id);
                    onCloseMobile();
                  }}
                  className={`
                    w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-left text-xs font-medium transition-all group
                    ${isActive 
                      ? 'bg-blue-50 text-blue-700 font-semibold border border-blue-200 shadow-xs' 
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-transparent'}
                  `}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 transition-colors ${isActive ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'}`} />
                    <div>
                      <div className="text-xs">{item.label}</div>
                      <div className={`text-[10px] ${isActive ? 'text-blue-500' : 'text-slate-400'}`}>{item.desc}</div>
                    </div>
                  </div>
                  {isActive && <ChevronRight className="w-3.5 h-3.5 text-blue-600" />}
                </button>
              );
            })}
          </nav>
        </div>

        {/* User Profile & Industrial Node Footer */}
        <div className="border-t border-slate-200 bg-slate-50/70 p-3 space-y-3">
          {/* Authenticated User Card */}
          <div className="p-2.5 bg-white border border-slate-200 rounded-lg shadow-xs">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-mono text-xs font-bold flex items-center justify-center shrink-0">
                  {initials || <User className="w-4 h-4" />}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-900 truncate">
                    {displayName}
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 truncate" title={displayEmail}>
                    {displayEmail}
                  </div>
                </div>
              </div>
              <button
                onClick={handleLogout}
                title="Sign out of VisionQC"
                className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors cursor-pointer shrink-0"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Node telemetry */}
          <div className="px-1 flex items-center justify-between text-[11px] font-mono text-slate-500">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-semibold text-slate-700">QC-01</span>
            </div>
            <button
              onClick={handleLogout}
              className="text-[10px] font-mono text-slate-400 hover:text-rose-600 underline cursor-pointer"
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};


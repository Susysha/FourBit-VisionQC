import React from 'react';

interface PartSvgProps {
  type: 'bearing-pass' | 'bearing-fail' | 'pcb-pass' | 'pcb-fail' | 'bolt-pass' | 'bolt-fail' | 'plastic-pass' | 'plastic-fail';
  className?: string;
}

export const PartSvgRenderer: React.FC<PartSvgProps> = ({ type, className = 'w-full h-full' }) => {
  if (type.startsWith('bearing')) {
    const isFail = type === 'bearing-fail';
    return (
      <svg viewBox="0 0 400 300" className={className} xmlns="http://www.w3.org/2000/svg">
        <rect width="400" height="300" fill="#f1f5f9" />
        {/* Reticle grid */}
        <line x1="200" y1="20" x2="200" y2="280" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3" />
        <line x1="20" y1="150" x2="380" y2="150" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3" />
        {/* Outer race */}
        <circle cx="200" cy="150" r="110" fill="#e2e8f0" stroke="#475569" strokeWidth="3" />
        <circle cx="200" cy="150" r="95" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1.5" />
        <circle cx="200" cy="150" r="75" fill="#e2e8f0" stroke="#64748b" strokeWidth="2" />
        {/* Raceway groove */}
        <circle cx="200" cy="150" r="60" fill="none" stroke="#cbd5e1" strokeWidth="28" />
        {/* 8 Steel balls */}
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
          const rad = (deg * Math.PI) / 180;
          const cx = 200 + 60 * Math.cos(rad);
          const cy = 150 + 60 * Math.sin(rad);
          return (
            <circle key={deg} cx={cx} cy={cy} r="11" fill="#94a3b8" stroke="#334155" strokeWidth="1.5" />
          );
        })}
        {/* Inner race bore */}
        <circle cx="200" cy="150" r="42" fill="#cbd5e1" stroke="#475569" strokeWidth="2" />
        <circle cx="200" cy="150" r="28" fill="#f1f5f9" stroke="#64748b" strokeWidth="2" />
        {/* Markings */}
        <text x="200" y="148" fontFamily="JetBrains Mono" fontSize="9" fill="#475569" textAnchor="middle" fontWeight="bold">6204-2RS</text>
        <text x="200" y="160" fontFamily="JetBrains Mono" fontSize="8" fill="#64748b" textAnchor="middle">ISO 9001</text>

        {isFail && (
          <g>
            {/* Defect surface spall mark on outer race */}
            <path d="M 265 85 Q 275 75 285 82 Q 280 92 268 90 Z" fill="#ef4444" stroke="#b91c1c" strokeWidth="1.5" />
            <circle cx="275" cy="84" r="14" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3 2" />
            <text x="296" y="80" fontFamily="JetBrains Mono" fontSize="8" fill="#b91c1c" fontWeight="bold">SURFACE GOUGE</text>
          </g>
        )}
      </svg>
    );
  }

  if (type.startsWith('pcb')) {
    const isFail = type === 'pcb-fail';
    return (
      <svg viewBox="0 0 400 300" className={className} xmlns="http://www.w3.org/2000/svg">
        <rect width="400" height="300" fill="#f8fafc" />
        {/* PCB Board */}
        <rect x="50" y="30" width="300" height="240" rx="6" fill="#065f46" stroke="#047857" strokeWidth="2" />
        {/* Traces */}
        <path d="M 80 60 L 150 60 L 170 90 L 170 130" stroke="#10b981" strokeWidth="2" fill="none" opacity="0.8" />
        <path d="M 80 80 L 130 80 L 150 110 L 150 130" stroke="#10b981" strokeWidth="1.5" fill="none" opacity="0.8" />
        <path d="M 230 130 L 230 90 L 310 90" stroke="#10b981" strokeWidth="2" fill="none" opacity="0.8" />
        <path d="M 250 130 L 250 70 L 320 70" stroke="#10b981" strokeWidth="1.5" fill="none" opacity="0.8" />
        {/* IC Package */}
        <rect x="150" y="120" width="100" height="80" rx="3" fill="#1e293b" stroke="#334155" strokeWidth="1.5" />
        <circle cx="160" cy="130" r="3" fill="#64748b" />
        <text x="200" y="165" fontFamily="JetBrains Mono" fontSize="9" fill="#cbd5e1" textAnchor="middle" fontWeight="bold">ARM-CORTEX</text>
        {/* Pins */}
        <g fill="#94a3b8">
          <rect x="125" y="130" width="25" height="4" />
          <rect x="125" y="142" width="25" height="4" />
          <rect x="125" y="154" width="25" height="4" />
          <rect x="125" y="166" width="25" height="4" />
          <rect x="125" y="178" width="25" height="4" />

          <rect x="250" y="130" width="25" height="4" />
          <rect x="250" y="142" width="25" height="4" />
          <rect x="250" y="154" width="25" height="4" />
          <rect x="250" y="166" width="25" height="4" />
          <rect x="250" y="178" width="25" height="4" />
        </g>
        {isFail && (
          <g>
            {/* Solder Bridge Defect on East Pins */}
            <ellipse cx="260" cy="148" rx="8" ry="10" fill="#ef4444" stroke="#b91c1c" strokeWidth="1.5" />
            <circle cx="260" cy="148" r="16" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3 2" />
            <text x="282" y="152" fontFamily="JetBrains Mono" fontSize="8" fill="#b91c1c" fontWeight="bold">SHORT BRIDGE</text>
          </g>
        )}
      </svg>
    );
  }

  // Fastener Bolt
  const isBoltFail = type === 'bolt-fail';
  return (
    <svg viewBox="0 0 400 300" className={className} xmlns="http://www.w3.org/2000/svg">
      <rect width="400" height="300" fill="#f8fafc" />
      {/* Bolt Hex Head */}
      <polygon points="120,90 160,60 240,60 280,90 240,120 160,120" fill="#94a3b8" stroke="#475569" strokeWidth="2" />
      <ellipse cx="200" cy="120" rx="75" ry="18" fill="#cbd5e1" stroke="#64748b" strokeWidth="2" />
      {/* Shaft */}
      <rect x="170" y="130" width="60" height="130" fill="#cbd5e1" stroke="#475569" strokeWidth="2" />
      {/* Threads */}
      {[145, 160, 175, 190, 205, 220, 235].map((y) => (
        <line key={y} x1="168" y1={y} x2="232" y2={y + 6} stroke="#475569" strokeWidth="3" />
      ))}
      <text x="200" y="85" fontFamily="JetBrains Mono" fontSize="8" fill="#334155" textAnchor="middle" fontWeight="bold">8.8 M6</text>
      {isBoltFail && (
        <g>
          <path d="M 160 186 L 176 192 L 166 200 Z" fill="#ef4444" stroke="#b91c1c" strokeWidth="1.5" />
          <circle cx="168" cy="192" r="12" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="3 2" />
          <text x="185" y="196" fontFamily="JetBrains Mono" fontSize="8" fill="#b91c1c" fontWeight="bold">PITCH BURR</text>
        </g>
      )}
    </svg>
  );
};

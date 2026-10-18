import React from 'react';

interface AppLogoProps {
  variant?: 'full' | 'compact' | 'icon-only' | 'official' | 'monochrome';
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  subtitle?: string;
}

export const AppLogo: React.FC<AppLogoProps> = ({
  variant = 'compact',
  size = 'md',
  className = '',
  subtitle
}) => {
  // Dimension sizing map
  const sizeMap = {
    sm: { icon: 'w-7 h-7', text: 'text-sm', badge: 'text-[9px]', sub: 'text-[9px]' },
    md: { icon: 'w-9 h-9', text: 'text-base', badge: 'text-[10px]', sub: 'text-[10px]' },
    lg: { icon: 'w-12 h-12', text: 'text-xl', badge: 'text-xs', sub: 'text-xs' },
    xl: { icon: 'w-16 h-16', text: 'text-2xl', badge: 'text-xs', sub: 'text-xs' }
  };

  const sz = sizeMap[size];

  // Official monochrome/gold emblem for printed Berita Acara
  if (variant === 'official') {
    return (
      <div className={`flex items-center gap-3 ${className}`}>
        <svg viewBox="0 0 100 100" className="w-14 h-14 text-slate-900" fill="currentColor">
          <circle cx="50" cy="50" r="46" fill="none" stroke="currentColor" strokeWidth="2.5" />
          <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="3 2" />
          {/* Caduceus / Health cross + Shield */}
          <path d="M50 16 L76 28 V52 C76 68 64 80 50 86 C36 80 24 68 24 52 V28 Z" fill="none" stroke="currentColor" strokeWidth="2" />
          {/* Medical Plus */}
          <path d="M43 45 H57 V57 H43 Z" fill="currentColor" opacity="0.15" />
          <path d="M48 37 H52 V65 H48 Z" fill="currentColor" />
          <path d="M36 49 H64 V53 H36 Z" fill="currentColor" />
          {/* Star ornaments */}
          <polygon points="50,22 52,26 56,26 53,28 54,32 50,30 46,32 47,28 44,26 48,26" fill="currentColor" />
        </svg>
        <div className="text-left font-serif">
          <div className="font-black text-sm tracking-widest text-slate-900 uppercase">
            SIPKP PULSE
          </div>
          <div className="text-[10px] text-slate-700 font-bold uppercase tracking-wider">
            Integrasi Layanan Primer (ILP)
          </div>
          <div className="text-[9px] text-slate-500 italic">
            Standar Akreditasi & Mutu Faskes
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {/* Sleek Vector Brandmark Symbol */}
      <div className={`relative ${sz.icon} flex-shrink-0 group`}>
        {/* Ambient Glow */}
        <div className="absolute -inset-1 bg-gradient-to-tr from-emerald-500 via-teal-400 to-cyan-500 rounded-2xl opacity-75 blur-md group-hover:opacity-100 transition-opacity duration-500" />
        
        {/* Core Icon SVG Container */}
        <div className="relative w-full h-full rounded-xl bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950 p-1.5 shadow-lg border border-emerald-400/30 flex items-center justify-center overflow-hidden">
          {/* Subtle interior grid mesh */}
          <div className="absolute inset-0 bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:6px_6px] opacity-20" />
          
          <svg viewBox="0 0 48 48" fill="none" className="w-full h-full relative z-10">
            <defs>
              <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#34d399" />
                <stop offset="50%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
              <linearGradient id="shieldGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#064e3b" stopOpacity="0.8" />
                <stop offset="100%" stopColor="#022c22" stopOpacity="0.4" />
              </linearGradient>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="1.5" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Geometric Primary Shield of Quality & Protection */}
            <path
              d="M24 6 L38 12.5 C38 25 32 35 24 41 C16 35 10 25 10 12.5 Z"
              fill="url(#shieldGrad)"
              stroke="url(#brandGrad)"
              strokeWidth="2.2"
              strokeLinejoin="round"
            />

            {/* Dynamic Vitality Pulse Curve (ECG + ILP Loop) */}
            <path
              d="M13 24 H19 L21.5 17 L25.5 32 L28.5 21 L31 24 H35"
              stroke="#ffffff"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#glow)"
            />

            {/* Radiant Precision Sparkle Accent */}
            <circle cx="24" cy="6" r="2.2" fill="#34d399" />
            <circle cx="38" cy="12.5" r="1.8" fill="#38bdf8" />
            <circle cx="10" cy="12.5" r="1.8" fill="#38bdf8" />
          </svg>
        </div>
      </div>

      {/* Brand Typography */}
      {variant !== 'icon-only' && (
        <div className="flex flex-col text-left">
          <div className="flex items-center gap-1.5 leading-none">
            <span className={`font-black tracking-tight text-white ${sz.text}`}>
              SIPKP
            </span>
            <span className="font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 bg-clip-text text-transparent">
              PULSE
            </span>
            <span className={`font-mono font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 ${sz.badge}`}>
              ILP 2026
            </span>
          </div>

          {(variant === 'full' || subtitle) && (
            <p className={`text-slate-400 mt-1 font-medium tracking-tight ${sz.sub}`}>
              {subtitle || 'Platform Pengawasan Mutu & Kinerja Puskesmas Terpadu'}
            </p>
          )}

          {variant === 'compact' && !subtitle && (
            <span className="text-[10px] text-slate-400 font-medium tracking-tight mt-0.5">
              Integrasi Layanan Primer • Jatim Bridge
            </span>
          )}
        </div>
      )}
    </div>
  );
};

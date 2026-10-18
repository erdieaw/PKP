import React from 'react';
import { TargetPolarity } from '../../types/pkp';
import { TrendingUp, TrendingDown, Layers } from 'lucide-react';

interface PolarityBadgeProps {
  polarity: TargetPolarity;
  targetDisplay: string;
}

export const PolarityBadge: React.FC<PolarityBadgeProps> = ({ polarity, targetDisplay }) => {
  if (polarity === 'LOWER_IS_BETTER') {
    return (
      <span 
        title="Polaritas: Semakin kecil semakin bagus (Target batas maksimal)" 
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200"
      >
        <TrendingDown className="w-3.5 h-3.5 text-orange-600" />
        <span>{targetDisplay}</span>
      </span>
    );
  }

  if (polarity === 'TIERED_BRACKETS') {
    return (
      <span 
        title="Polaritas: Rubrik Penilaian Bertingkat (Threshold Khusus)" 
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200"
      >
        <Layers className="w-3.5 h-3.5 text-purple-600" />
        <span>{targetDisplay}</span>
      </span>
    );
  }

  // HIGHER_IS_BETTER (Default)
  return (
    <span 
      title="Polaritas: Semakin besar semakin bagus (Cakupan Minimal)" 
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200"
    >
      <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
      <span>{targetDisplay}</span>
    </span>
  );
};

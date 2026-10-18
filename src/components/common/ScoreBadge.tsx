import React from 'react';

interface ScoreBadgeProps {
  score: number;
  size?: 'sm' | 'md' | 'lg';
}

export const ScoreBadge: React.FC<ScoreBadgeProps> = ({ score, size = 'sm' }) => {
  const isBaik = score >= 91;
  const isCukup = score >= 81 && score < 91;

  let colorClasses = 'bg-rose-50 text-rose-700 border-rose-200';
  let dotColor = 'bg-rose-500';
  let label = 'Kurang';

  if (isBaik) {
    colorClasses = 'bg-emerald-50 text-emerald-700 border-emerald-200';
    dotColor = 'bg-emerald-500';
    label = 'Baik';
  } else if (isCukup) {
    colorClasses = 'bg-amber-50 text-amber-700 border-amber-200';
    dotColor = 'bg-amber-500';
    label = 'Cukup';
  }

  const sizeClasses = size === 'lg' 
    ? 'px-3 py-1.5 text-sm' 
    : size === 'md' 
      ? 'px-2.5 py-1 text-xs' 
      : 'px-2 py-0.5 text-xs';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md font-mono font-bold border ${colorClasses} ${sizeClasses}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <span>{score.toFixed(1)}%</span>
      <span className="text-[10px] font-sans font-normal opacity-75">({label})</span>
    </span>
  );
};


import React from 'react';

interface ProgressBarProps {
  progress: number;
  label: string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ progress, label }) => {
  return (
    <div className="w-full">
      <div className="flex justify-between items-end mb-2">
        <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">{label}</span>
        <span className="font-mono-stats text-sm font-bold text-[#0B5FFF]">{Math.round(progress)}%</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
        <div 
          className="h-full rounded-full transition-all duration-500 ease-out animate-flow" 
          style={{ width: `${progress}%` }}
        ></div>
      </div>
    </div>
  );
};

export default ProgressBar;

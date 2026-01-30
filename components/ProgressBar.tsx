
import React from 'react';

interface ProgressBarProps {
  progress: number;
  label: string;
  speed?: number; // KB/s
  eta?: number; // seconds
  remainingKb?: number;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ progress, label, speed, eta, remainingKb }) => {
  const formatETA = (s: number) => {
    if (s <= 0) return '0s';
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <div className="w-full">
      <div className="flex justify-between items-end mb-3">
        <div className="flex flex-col">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 leading-none mb-1">{label}</span>
          {speed !== undefined && (
            <div className="flex gap-3 text-[10px] font-mono font-bold text-sync-blue">
              <span>{speed.toFixed(1)} KB/s</span>
              {remainingKb !== undefined && <span className="text-slate-300">|</span>}
              {remainingKb !== undefined && <span>{remainingKb.toFixed(0)} KB left</span>}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end">
          <span className="font-mono text-lg font-black text-slate-900 leading-none">{Math.round(progress)}%</span>
          {eta !== undefined && eta > 0 && (
            <span className="text-[9px] font-black uppercase text-slate-400 mt-1">ETA: {formatETA(eta)}</span>
          )}
        </div>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
        <div 
          className="h-full rounded-full transition-all duration-300 ease-out animate-flow-gradient" 
          style={{ width: `${progress}%` }}
        ></div>
      </div>
    </div>
  );
};

export default ProgressBar;

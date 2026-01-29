
import React from 'react';

interface ProgressBarProps {
  progress: number;
  label: string;
}

const ProgressBar: React.FC<ProgressBarProps> = ({ progress, label }) => {
  return (
    <div className="w-full">
      <div className="flex justify-between mb-1">
        <span className="text-sm font-medium text-blue-700">{label}</span>
        <span className="text-sm font-medium text-blue-700">{Math.round(progress)}%</span>
      </div>
      <div className="w-full bg-blue-100 rounded-full h-2.5">
        <div 
          className="bg-blue-600 h-2.5 rounded-full transition-all duration-300 ease-out" 
          style={{ width: `${progress}%` }}
        ></div>
      </div>
    </div>
  );
};

export default ProgressBar;

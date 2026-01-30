
import React from 'react';
import { NetworkStatus } from '../types';

interface NetworkStatusBadgeProps {
  status: NetworkStatus;
  effectiveType?: string;
  signalStrength: number;
  isMetered: boolean;
}

const NetworkStatusBadge: React.FC<NetworkStatusBadgeProps> = ({ status, effectiveType, signalStrength, isMetered }) => {
  const getLabel = () => {
    switch (status) {
      case NetworkStatus.ONLINE: return isMetered ? 'Cellular' : 'Wi-Fi';
      case NetworkStatus.WEAK: return 'Weak Signal';
      case NetworkStatus.OFFLINE: return 'Offline';
    }
  };

  const getPillStyles = () => {
    switch (status) {
      case NetworkStatus.ONLINE:
        return 'bg-white border-slate-200 shadow-sm shadow-blue-50';
      case NetworkStatus.WEAK:
        return 'bg-amber-50 border-amber-200 text-amber-700';
      case NetworkStatus.OFFLINE:
        return 'bg-rose-50 border-rose-200 text-rose-700';
    }
  };

  return (
    <div className={`flex items-center gap-3 px-4 py-2 rounded-full text-[11px] font-black uppercase tracking-widest border transition-all duration-500 ${getPillStyles()}`}>
      {/* Signal Strength Bars */}
      <div className="flex items-end gap-[2px] h-3 w-4">
        {[1, 2, 3, 4].map((bar) => {
          const isActive = status !== NetworkStatus.OFFLINE && signalStrength >= (bar * 25);
          return (
            <div 
              key={bar}
              className={`w-1 rounded-t-sm transition-all duration-300 ${isActive ? (status === NetworkStatus.WEAK ? 'bg-amber-400' : 'bg-sync-blue') : 'bg-slate-200'}`}
              style={{ height: `${bar * 25}%` }}
            />
          );
        })}
      </div>

      <div className="flex flex-col leading-none">
        <span className={status === NetworkStatus.ONLINE ? 'text-slate-900' : ''}>{getLabel()}</span>
        <span className="text-[8px] opacity-60 font-bold mt-0.5">{effectiveType}</span>
      </div>
    </div>
  );
};

export default NetworkStatusBadge;

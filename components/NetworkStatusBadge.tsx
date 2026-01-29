
import React from 'react';
import { NetworkStatus } from '../types';

interface NetworkStatusBadgeProps {
  status: NetworkStatus;
  effectiveType?: string;
}

const NetworkStatusBadge: React.FC<NetworkStatusBadgeProps> = ({ status, effectiveType }) => {
  const getLabel = () => {
    switch (status) {
      case NetworkStatus.ONLINE: return 'Strong';
      case NetworkStatus.WEAK: return `Weak (${effectiveType})`;
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
    <div className={`flex items-center gap-2.5 px-3.5 py-1.5 rounded-full text-[11px] font-black uppercase tracking-widest border transition-all duration-500 ${getPillStyles()}`}>
      <div className="relative flex items-center justify-center">
        {status === NetworkStatus.ONLINE && (
          <>
            <div className="absolute w-3 h-3 bg-blue-400/30 rounded-full animate-ping"></div>
            <div className="w-1.5 h-1.5 bg-[#0B5FFF] rounded-full"></div>
          </>
        )}
        {status === NetworkStatus.WEAK && (
          <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"></div>
        )}
        {status === NetworkStatus.OFFLINE && (
          <div className="w-1.5 h-1.5 bg-rose-500 rounded-full"></div>
        )}
      </div>
      <span className={status === NetworkStatus.ONLINE ? 'text-slate-600' : ''}>{getLabel()}</span>
    </div>
  );
};

export default NetworkStatusBadge;

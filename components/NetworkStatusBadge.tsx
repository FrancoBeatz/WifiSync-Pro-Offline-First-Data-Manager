
import React from 'react';
import { NetworkStatus } from '../types';

interface NetworkStatusBadgeProps {
  status: NetworkStatus;
  effectiveType?: string;
}

const NetworkStatusBadge: React.FC<NetworkStatusBadgeProps> = ({ status, effectiveType }) => {
  const getStyles = () => {
    switch (status) {
      case NetworkStatus.ONLINE:
        return 'bg-green-100 text-green-800 border-green-200';
      case NetworkStatus.WEAK:
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case NetworkStatus.OFFLINE:
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getLabel = () => {
    switch (status) {
      case NetworkStatus.ONLINE: return 'Online (Strong)';
      case NetworkStatus.WEAK: return `Weak Signal (${effectiveType?.toUpperCase()})`;
      case NetworkStatus.OFFLINE: return 'Offline';
    }
  };

  const getIcon = () => {
    switch (status) {
      case NetworkStatus.ONLINE:
        return (
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
          </svg>
        );
      case NetworkStatus.WEAK:
        return (
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case NetworkStatus.OFFLINE:
        return (
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-1.414m-1.414-1.414a5 5 0 010-7.072m0 0l2.829 2.829m-4.243 2.829L3 21M6.343 6.343l2.829 2.828m0-2.828L6.343 9.172" />
          </svg>
        );
    }
  };

  return (
    <div className={`flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${getStyles()}`}>
      {getIcon()}
      {getLabel()}
    </div>
  );
};

export default NetworkStatusBadge;

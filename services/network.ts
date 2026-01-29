
import { NetworkQuality, NetworkStatus, NetworkInfo } from '../types';

export const getNetworkQuality = async (): Promise<NetworkQuality> => {
  const isOnline = navigator.onLine;
  const connection = (navigator as any).connection as NetworkInfo;
  
  let status = NetworkStatus.ONLINE;
  let speed = 10; // Default fallback
  let isMetered = false;

  if (!isOnline) {
    status = NetworkStatus.OFFLINE;
    speed = 0;
  } else if (connection) {
    isMetered = connection.saveData;
    const type = connection.effectiveType;
    if (type === 'slow-2g' || type === '2g') {
      status = NetworkStatus.WEAK;
      speed = 0.5;
    } else if (type === '3g') {
      status = NetworkStatus.WEAK;
      speed = 2;
    } else {
      speed = 25; // Estimate for 4G/Wifi
    }
  }

  // Optional: Real ping test
  try {
    if (isOnline) {
      const start = Date.now();
      await fetch('https://www.google.com/favicon.ico', { mode: 'no-cors', cache: 'no-store' });
      const duration = Date.now() - start;
      if (duration > 1000) status = NetworkStatus.WEAK;
    }
  } catch (e) {}

  return {
    status,
    effectiveType: connection?.effectiveType || 'unknown',
    estimatedSpeedMbps: speed,
    isMetered
  };
};

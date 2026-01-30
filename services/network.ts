
import { NetworkQuality, NetworkStatus, NetworkInfo } from '../types';

export const getNetworkQuality = async (): Promise<NetworkQuality> => {
  const isOnline = navigator.onLine;
  const connection = (navigator as any).connection as NetworkInfo;
  
  let status = NetworkStatus.ONLINE;
  let speed = 10; // Default fallback
  let isMetered = false;
  let signalStrength = 100; // Default 100%

  if (!isOnline) {
    status = NetworkStatus.OFFLINE;
    speed = 0;
    signalStrength = 0;
  } else if (connection) {
    isMetered = connection.saveData;
    const type = connection.effectiveType;
    if (type === 'slow-2g' || type === '2g') {
      status = NetworkStatus.WEAK;
      speed = 0.5;
      signalStrength = Math.random() * 20 + 5;
    } else if (type === '3g') {
      status = NetworkStatus.WEAK;
      speed = 2;
      signalStrength = Math.random() * 30 + 30;
    } else {
      speed = 25; // Estimate for 4G/Wifi
      signalStrength = Math.random() * 20 + 80;
    }
  }

  // Ping test simulation for accuracy
  try {
    if (isOnline) {
      const start = Date.now();
      // Using a reliable public endpoint for ping test
      await fetch('https://www.google.com/favicon.ico', { mode: 'no-cors', cache: 'no-store' });
      const duration = Date.now() - start;
      if (duration > 800) {
        status = NetworkStatus.WEAK;
        signalStrength -= 30;
      }
    }
  } catch (e) {}

  return {
    status,
    effectiveType: connection?.effectiveType || (isOnline ? 'broadband' : 'offline'),
    estimatedSpeedMbps: speed,
    isMetered,
    signalStrength: Math.max(0, Math.min(100, signalStrength))
  };
};

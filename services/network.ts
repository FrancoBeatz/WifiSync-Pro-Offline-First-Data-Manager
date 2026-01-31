
import { NetworkQuality, NetworkStatus, NetworkInfo } from '../types';

export const getNetworkQuality = async (): Promise<NetworkQuality> => {
  const isOnline = navigator.onLine;
  const connection = (navigator as any).connection as NetworkInfo;
  
  let status = NetworkStatus.ONLINE;
  let speed = 25; // Default fallback for wifi
  let isMetered = false;
  let signalStrength = 100;

  if (!isOnline) {
    return {
      status: NetworkStatus.OFFLINE,
      effectiveType: 'none',
      estimatedSpeedMbps: 0,
      isMetered: false,
      signalStrength: 0
    };
  }

  if (connection) {
    isMetered = connection.saveData;
    const type = connection.effectiveType;
    if (type === 'slow-2g' || type === '2g') {
      status = NetworkStatus.WEAK;
      speed = 0.5;
      signalStrength = 20;
    } else if (type === '3g') {
      status = NetworkStatus.WEAK;
      speed = 2;
      signalStrength = 45;
    } else {
      speed = 50; // Broadband
      signalStrength = 95;
    }
  }

  // Active check
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    const start = Date.now();
    // Using a reliable pixel fetch to check true connectivity latency
    await fetch('https://www.google.com/favicon.ico', { 
      mode: 'no-cors', 
      cache: 'no-store',
      signal: controller.signal 
    });
    clearTimeout(timeoutId);
    
    const duration = Date.now() - start;
    if (duration > 1200) {
      status = NetworkStatus.WEAK;
      signalStrength = Math.min(signalStrength, 30);
    }
  } catch (e) {
    // If fetch fails explicitly while navigator.onLine is true, it's a weak/captive portal situation
    status = NetworkStatus.WEAK;
    signalStrength = 10;
  }

  return {
    status,
    effectiveType: connection?.effectiveType || 'broadband',
    estimatedSpeedMbps: speed,
    isMetered,
    signalStrength
  };
};

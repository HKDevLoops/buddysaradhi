import { useState, useEffect } from 'react';

export function useWebGLAvailable() {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  
  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      setIsAvailable(!!gl);
    } catch (e) {
      setIsAvailable(false);
    }
  }, []);
  
  return isAvailable;
}

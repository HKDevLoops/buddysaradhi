import { useState, useEffect } from 'react';

function checkWebGL(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch (e) {
    return false;
  }
}

export function useWebGLAvailable(): boolean | null {
  // Tri-state: null = probing (SSR), true/false = after mount. Prevents hydration mismatch.
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    // Intentional post-mount measurement — same pattern as web fix for 20_3D_Product_Page §4
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsAvailable(checkWebGL());
  }, []);

  return isAvailable;
}

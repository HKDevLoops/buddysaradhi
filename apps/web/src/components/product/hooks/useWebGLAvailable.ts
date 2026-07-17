import { useEffect, useState } from "react";

export type WebGLState = boolean | null;

export function useWebGLAvailable(): WebGLState {
  const [available, setAvailable] = useState<WebGLState>(null);

  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const ctx =
        canvas.getContext("webgl2") || canvas.getContext("webgl");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAvailable(!!ctx);
    } catch {
      setAvailable(false);
    }
  }, []);

  return available;
}

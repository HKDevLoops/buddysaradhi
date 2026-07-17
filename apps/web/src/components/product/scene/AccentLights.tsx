import React from "react";
import { Float, ContactShadows } from "@react-three/drei";
import { useReducedMotion } from "../hooks/useReducedMotion";

export function AccentLights() {
  const reducedMotion = useReducedMotion();
  
  return (
    <>
      {/* Abyss ambient */}
      <ambientLight intensity={0.15} color="#0a0a1a" />           
      
      {/* key, upper-left (neumo-light tint) */}
      <directionalLight position={[3, 5, 4]} intensity={0.6} color="#1a1a3a" /> 
      
      {/* fill, cool (abyss tint) */}
      <directionalLight position={[-3, -2, 2]} intensity={0.2} color="#0a0a1a" />
      
      {/* the bioluminescent orbiters (accents, <8% of frame energy) */}
      {reducedMotion ? (
        <group>
          <pointLight position={[2, 1, 2]} intensity={8} color="#00FF9D" distance={6} />
          <pointLight position={[-2, 1, 2]} intensity={6} color="#00F0FF" distance={6} />
          <pointLight position={[0, -1.5, 2]} intensity={4} color="#FFB300" distance={6} />
        </group>
      ) : (
        <Float speed={1.2} rotationIntensity={0.4} floatIntensity={1.2}>
          <pointLight position={[2, 1, 2]} intensity={8} color="#00FF9D" distance={6} />
          <pointLight position={[-2, 1, 2]} intensity={6} color="#00F0FF" distance={6} />
          <pointLight position={[0, -1.5, 2]} intensity={4} color="#FFB300" distance={6} />
        </Float>
      )}

      <ContactShadows position={[0, -1.3, 0]} opacity={0.4} blur={2.5} far={4} />
    </>
  );
}

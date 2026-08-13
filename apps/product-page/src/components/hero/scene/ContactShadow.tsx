import React from 'react';
import { ContactShadows } from '@react-three/drei';

export function ContactShadow() {
  return (
    <ContactShadows position={[0, -1.3, 0]} opacity={0.4} blur={2.5} far={4} color="#0a0a1a" />
  );
}

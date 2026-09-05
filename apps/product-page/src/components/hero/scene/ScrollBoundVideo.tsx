// @ts-nocheck
import React, { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll } from '@react-three/drei';
import * as THREE from 'three';

export function ScrollBoundVideo({ url, startScroll = 0, endScroll = 1 }: { url: string; startScroll?: number; endScroll?: number }) {
  const [videoTexture, setVideoTexture] = useState<THREE.VideoTexture | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const textureRef = useRef<THREE.VideoTexture | null>(null);
  const scroll = useScroll();

  useEffect(() => {
    const video = document.createElement('video');
    video.src = url;
    if (url.startsWith('http') && url.includes('buddysaradhi')) video.crossOrigin = 'Anonymous';
    video.loop = false;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.load();
    const onLoaded = () => {
      const tex = new THREE.VideoTexture(video);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      textureRef.current = tex;
      setVideoTexture(tex);
      videoRef.current = video;
    };
    video.addEventListener('loadeddata', onLoaded);
    return () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (textureRef.current) {
        textureRef.current.dispose();
        textureRef.current = null;
      }
    };
  }, [url]);

  useFrame(() => {
    if (!scroll || !videoRef.current || videoRef.current.readyState < 2) return;
    const progress = Math.max(0, Math.min(1, (scroll.offset - startScroll) / (endScroll - startScroll)));
    const dur = videoRef.current.duration || 1;
    const targetTime = progress * 0.85 * dur;
    const clamped = Math.min(targetTime, Math.max(0, dur - 0.15));
    videoRef.current.currentTime = THREE.MathUtils.lerp(videoRef.current.currentTime, clamped, 0.1);
    if (textureRef.current) textureRef.current.needsUpdate = true;
  });

  if (!videoTexture) return null;
  return <meshBasicMaterial map={videoTexture} toneMapped={false} transparent opacity={0.92} />;
}

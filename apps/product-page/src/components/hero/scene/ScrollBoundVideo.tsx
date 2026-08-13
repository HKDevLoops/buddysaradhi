// @ts-nocheck
import React, { useEffect, useState, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useScroll } from '@react-three/drei';
import * as THREE from 'three';

export function ScrollBoundVideo({ 
  url, 
  startScroll = 0, 
  endScroll = 1 
}: { 
  url: string, 
  startScroll?: number, 
  endScroll?: number 
}) {
  const [videoTexture, setVideoTexture] = useState<THREE.VideoTexture | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scroll = useScroll();

  useEffect(() => {
    const video = document.createElement('video');
    video.src = url;
    video.crossOrigin = 'Anonymous';
    video.loop = false;
    video.muted = true;
    video.playsInline = true;
    
    // We don't call play(). We scrub it mathematically via scroll.
    video.load();

    const onLoaded = () => {
      const texture = new THREE.VideoTexture(video);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.colorSpace = THREE.SRGBColorSpace;
      setVideoTexture(texture);
      videoRef.current = video;
    };

    video.addEventListener('loadeddata', onLoaded);

    return () => {
      video.removeEventListener('loadeddata', onLoaded);
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [url]);

  useFrame(() => {
    if (videoRef.current && videoRef.current.readyState >= 2) {
      // 1. Calculate how far we are through this specific video's scroll zone
      const progress = Math.max(0, Math.min(1, (scroll.offset - startScroll) / (endScroll - startScroll)));
      
      // 2. Map that progress to the video's total duration (e.g. a 60s video)
      const targetTime = progress * videoRef.current.duration;
      
      // 3. Smoothly lerp the video playhead to the target time to prevent harsh skipping
      videoRef.current.currentTime = THREE.MathUtils.lerp(videoRef.current.currentTime, targetTime, 0.1);
    }
  });

  // If the video hasn't loaded (or doesn't exist), we return null so the fallback glass material shows instead.
  if (!videoTexture) return null;

  return (
    <meshBasicMaterial 
      map={videoTexture} 
      toneMapped={false} 
      transparent 
      opacity={0.9} 
    />
  );
}

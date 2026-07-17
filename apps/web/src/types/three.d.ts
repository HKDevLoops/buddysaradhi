import { ThreeElements } from '@react-three/fiber'

declare module 'react' {
  namespace JSX {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface IntrinsicElements extends ThreeElements {}
  }
}

declare global {
  namespace JSX {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface IntrinsicElements extends ThreeElements {}
  }
}

declare module 'maath/random/dist/maath-random.esm' {
  export function inSphere(buffer: Float32Array, options?: { radius?: number }): Float32Array;
}

"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/product/Skeleton";

export const Hero3D = dynamic(
  () => import("@/components/product/Hero3D").then((m) => m.Hero3D),
  {
    ssr: false,
    loading: () => <Skeleton />,
  }
);

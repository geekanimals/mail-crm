"use client";

// Screen size hook (inline styles can't use CSS media queries)
import { useSyncExternalStore } from "react";

const subscribe = (cb) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};

export function useScreen() {
  const width = useSyncExternalStore(subscribe, () => window.innerWidth, () => 1280);
  return {
    width,
    mobile: width < 640, // phones
    compact: width < 1024, // phones + tablets → slide-out menu
  };
}

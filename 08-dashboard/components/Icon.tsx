"use client";

import * as Lucide from "lucide-react";

type IconName = keyof typeof Lucide;

interface Props {
  name: IconName;
  className?: string;
  size?: number;
  strokeWidth?: number;
  "aria-hidden"?: boolean;
}

/**
 * Thin wrapper to keep the lucide stroke and sizing convention consistent
 * across the dashboard (stroke 1.5, sizes 16/20/24 only — see spec section 10.6).
 */
export function Icon({ name, className, size = 16, strokeWidth = 1.5, ...rest }: Props) {
  const Cmp = Lucide[name] as React.ComponentType<{
    className?: string;
    size?: number;
    strokeWidth?: number;
  }>;
  if (!Cmp) return null;
  return <Cmp className={className} size={size} strokeWidth={strokeWidth} {...rest} />;
}

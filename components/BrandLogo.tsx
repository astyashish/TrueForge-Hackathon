import { Zap } from "lucide-react";

/** Threshold brand mark for auth and landing surfaces. */
export function BrandLogo({
  size = 60,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center rounded-xl bg-main/10 ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <Zap
        size={size * 0.55}
        className="text-main"
        strokeWidth={2.5}
      />
    </div>
  );
}
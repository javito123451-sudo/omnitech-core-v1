import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

// To use a real avatar: set this to `${import.meta.env.BASE_URL}ava-avatar.png`
// and place the file in artifacts/omniflow/public/ava-avatar.png
export const AVA_AVATAR_URL = "";

interface AvaAvatarProps {
  size?: number;
  className?: string;
  breathing?: boolean;
}

export default function AvaAvatar({ size = 40, className, breathing = false }: AvaAvatarProps) {
  const content = (
    <div
      className={cn("relative rounded-full shrink-0 overflow-hidden", className)}
      style={{ width: size, height: size }}
    >
      {/* Glow layer */}
      <div
        className="absolute rounded-full bg-gradient-to-br from-blue-500/50 to-violet-600/50 blur-md pointer-events-none"
        style={{ inset: "-20%", zIndex: 0 }}
      />
      {/* Border ring */}
      <div className="absolute inset-0 rounded-full border border-white/20 z-20 pointer-events-none" />
      {/* Glass shimmer */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/10 to-transparent z-20 pointer-events-none" />
      {/* Avatar image or gradient fallback */}
      <div className="relative z-10 w-full h-full rounded-full overflow-hidden">
        {AVA_AVATAR_URL ? (
          <img
            src={AVA_AVATAR_URL}
            alt="Ava"
            className="w-full h-full object-cover"
            onError={e => {
              e.currentTarget.style.display = "none";
              e.currentTarget.nextElementSibling?.removeAttribute("style");
            }}
          />
        ) : null}
        <div
          className="w-full h-full rounded-full bg-gradient-to-br from-blue-500 via-violet-600 to-indigo-700 flex items-center justify-center"
          style={AVA_AVATAR_URL ? { display: "none" } : undefined}
        >
          <span
            className="font-bold text-white select-none leading-none"
            style={{ fontSize: Math.round(size * 0.38) }}
          >
            A
          </span>
        </div>
      </div>
    </div>
  );

  if (breathing) {
    return (
      <motion.div
        animate={{ scale: [1, 1.04, 1], opacity: [0.92, 1, 0.92] }}
        transition={{ repeat: Infinity, duration: 3.6, ease: "easeInOut" }}
        style={{ width: size, height: size, borderRadius: "50%" }}
      >
        {content}
      </motion.div>
    );
  }

  return content;
}

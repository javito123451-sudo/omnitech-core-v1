import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useAva } from "./AvaContext";
import AvaAvatar from "./AvaAvatar";

export default function AvaFloatingButton() {
  const { isOpen, toggle } = useAva();

  return (
    <motion.button
      onClick={toggle}
      className="fixed bottom-6 right-6 z-[9999] rounded-full group focus:outline-none"
      style={{ width: 64, height: 64 }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.92 }}
      aria-label={isOpen ? "Cerrar Ava" : "Abrir Ava"}
    >
      {/* Outer glow */}
      <div
        className="absolute inset-0 rounded-full transition-all duration-500 pointer-events-none"
        style={{
          background: isOpen
            ? "rgba(30,30,60,0.8)"
            : "radial-gradient(circle, rgba(59,130,246,0.35) 0%, rgba(139,92,246,0.20) 60%, transparent 100%)",
          filter: "blur(12px)",
          transform: "scale(1.5)",
        }}
      />

      <AnimatePresence mode="wait" initial={false}>
        {isOpen ? (
          <motion.div
            key="close"
            initial={{ scale: 0.5, opacity: 0, rotate: -90 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.5, opacity: 0, rotate: 90 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute inset-0 rounded-full flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, #1e2035 0%, #16192d 100%)",
              border: "1px solid rgba(255,255,255,0.15)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(59,130,246,0.1)",
            }}
          >
            <X className="w-6 h-6 text-slate-300" />
          </motion.div>
        ) : (
          <motion.div
            key="avatar"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute inset-0"
            style={{
              filter: "drop-shadow(0 8px 24px rgba(59,130,246,0.4)) drop-shadow(0 2px 8px rgba(0,0,0,0.5))",
            }}
          >
            <AvaAvatar size={64} breathing={true} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

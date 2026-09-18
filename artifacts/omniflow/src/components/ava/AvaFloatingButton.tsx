import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, type PanInfo } from "framer-motion";
import { X } from "lucide-react";
import { useAva } from "./AvaContext";
import AvaAvatar from "./AvaAvatar";

const SIZE = 64;
const MARGIN = 12;
const STORAGE_KEY = "ava.floatingButton.position.v1";

interface Pos { top: number; left: number }

function defaultPos(): Pos {
  return {
    top:  window.innerHeight - SIZE - 24,
    left: window.innerWidth  - SIZE - 24,
  };
}

function clamp(pos: Pos): Pos {
  const maxTop  = Math.max(MARGIN, window.innerHeight - SIZE - MARGIN);
  const maxLeft = Math.max(MARGIN, window.innerWidth  - SIZE - MARGIN);
  return {
    top:  Math.min(Math.max(pos.top, MARGIN), maxTop),
    left: Math.min(Math.max(pos.left, MARGIN), maxLeft),
  };
}

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return clamp(JSON.parse(raw));
  } catch { /* private mode / blocked storage — fall back to default */ }
  return clamp(defaultPos());
}

function savePos(pos: Pos) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch { /* non-critical */ }
}

export default function AvaFloatingButton() {
  const { isOpen, toggle } = useAva();
  const [pos, setPos]   = useState<Pos>(loadPos);
  const [dragging, setDragging] = useState(false);
  const draggedRef = useRef(false);

  // Never let a resize (rotating a phone, resizing the window) leave Ava
  // stranded off-screen.
  useEffect(() => {
    const onResize = () => setPos(p => clamp(p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const handleDragEnd = (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const next = clamp({
      top:  pos.top  + info.offset.y,
      left: pos.left + info.offset.x,
    });
    setPos(next);
    savePos(next);
    setDragging(false);
    // Swallow the click that would otherwise fire right after a drag.
    setTimeout(() => { draggedRef.current = false; }, 0);
  };

  return (
    <motion.button
      onClick={() => { if (!draggedRef.current) toggle(); }}
      drag
      dragMomentum={false}
      dragElastic={0}
      onDragStart={() => { draggedRef.current = true; setDragging(true); }}
      onDragEnd={handleDragEnd}
      className="fixed z-[9999] rounded-full group focus:outline-none touch-none"
      style={{ width: SIZE, height: SIZE, top: pos.top, left: pos.left }}
      whileHover={{ scale: dragging ? 1 : 1.08 }}
      whileTap={{ scale: 0.92 }}
      aria-label={isOpen ? "Cerrar Ava" : "Abrir Ava (arrastrable)"}
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

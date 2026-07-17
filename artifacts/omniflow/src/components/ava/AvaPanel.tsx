import { AnimatePresence, motion } from "framer-motion";
import { useAva } from "./AvaContext";
import AvaHeader from "./AvaHeader";
import AvaQuickActions from "./AvaQuickActions";
import AvaChat from "./AvaChat";

export default function AvaPanel() {
  const { isOpen, close, pendingMessage, clearPendingMessage, injectMessage, moduleLabel } = useAva();

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <motion.div
            key="ava-backdrop"
            className="fixed inset-0 z-[9990] bg-black/50 backdrop-blur-sm md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={close}
          />

          {/* Side panel */}
          <motion.div
            key="ava-panel"
            className="fixed right-0 top-0 bottom-0 z-[9990] flex flex-col w-full md:w-[420px] overflow-hidden"
            style={{
              background: "linear-gradient(160deg, #0c0e1d 0%, #0f1122 50%, #0b0d1a 100%)",
              borderLeft: "1px solid rgba(255,255,255,0.07)",
              boxShadow: "-8px 0 40px rgba(0,0,0,0.6), -1px 0 0 rgba(59,130,246,0.06)",
            }}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 340, damping: 38 }}
          >
            {/* Ambient top glow */}
            <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-primary/[0.06] blur-3xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full bg-violet-600/[0.05] blur-3xl pointer-events-none" />

            <div className="relative z-10 flex flex-col h-full">
              <AvaHeader />
              <AvaQuickActions onAction={injectMessage} />
              <AvaChat
                pendingMessage={pendingMessage}
                onClearPending={clearPendingMessage}
                moduleLabel={moduleLabel}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

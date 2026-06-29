/**
 * PortalDropdownMenu
 *
 * Menú desplegable que se renderiza VIA PORTAL en document.body
 * para evitar que quede recortado por contenedores con overflow:hidden.
 *
 * Usado como reemplazo de dropdowns inline en tablas y contenedores restringidos.
 */

import { useState, useRef, useEffect, ReactNode, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

interface PortalDropdownProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  gap?: number;
  className?: string;
  closeOnItemClick?: boolean;
}

export function PortalDropdown({
  trigger,
  children,
  align = "right",
  gap = 4,
  className,
  closeOnItemClick = true,
}: PortalDropdownProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>({
    top: 0,
  });

  const measure = useCallback(() => {
    const btn = triggerRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
    setPos({
      top: rect.bottom + scrollY + gap,
      ...(align === "left"
        ? { left: rect.left + scrollX }
        : { right: window.innerWidth - rect.right - scrollX }),
    });
  }, [align, gap]);

  useEffect(() => {
    if (!open) return;
    measure();
    const onResize = () => measure();
    const onScroll = () => measure();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, measure]);

  // Cerrar al presionar Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const handleItemClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!closeOnItemClick) return;
    // Solo cerrar si el click fue en un botón directo (no en un contenedor intermedio)
    const target = e.target as HTMLElement;
    if (target.closest("button, a, [role='menuitem']")) {
      setOpen(false);
    }
  };

  return (
    <div ref={triggerRef} className="relative inline-block">
      <div onClick={() => { measure(); setOpen(v => !v); }} style={{ cursor: "pointer" }}>
        {trigger}
      </div>
      {open && (
        <>
          {/* Backdrop para cerrar al hacer click fuera */}
          {createPortal(
            <div
              className="fixed inset-0 z-[100]"
              onClick={() => setOpen(false)}
            />,
            document.body
          )}
          {/* Menú posicionado */}
          {createPortal(
            <div
              ref={menuRef}
              className={cn(
                "fixed z-[110] bg-[#0d0e1e] border border-white/10 rounded-xl shadow-2xl min-w-[200px] overflow-hidden",
                className
              )}
              style={{
                top: pos.top,
                ...(pos.left !== undefined ? { left: pos.left } : {}),
                ...(pos.right !== undefined ? { right: pos.right } : {}),
              }}
              onClick={handleItemClick}
            >
              {children}
            </div>,
            document.body
          )}
        </>
      )}
    </div>
  );
}

/**
 * Item de menú para usar dentro de PortalDropdown.
 */
export function PortalDropdownItem({
  icon,
  label,
  onClick,
  variant = "default",
}: {
  icon?: ReactNode;
  label: string;
  onClick: () => void;
  variant?: "default" | "warning" | "danger";
}) {
  const variantClasses = {
    default: "text-slate-300 hover:bg-white/5 hover:text-white",
    warning: "text-amber-400 hover:bg-amber-500/10",
    danger: "text-red-400 hover:bg-red-500/10",
  };
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2 text-xs flex items-center gap-2 transition-all",
        variantClasses[variant]
      )}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {label}
    </button>
  );
}

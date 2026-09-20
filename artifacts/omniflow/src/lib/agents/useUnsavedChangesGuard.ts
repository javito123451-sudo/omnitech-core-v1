import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Evita perder cambios sin guardar al abandonar la pantalla.
 *  - Cerrar/recargar la pestaña: aviso nativo del navegador (beforeunload).
 *  - Pulsar un enlace de la app (menú, «Agentes», etc.): se intercepta el clic, se pide confirmación y, si el usuario
 *    confirma, se repite el clic para que navegue el router de siempre.
 * wouter no tiene un «bloqueador» de navegación, y el botón Atrás del navegador solo queda cubierto por el aviso
 * nativo al salir de la app (limitación conocida).
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const [pending, setPending] = useState<HTMLAnchorElement | null>(null);
  const bypass = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (bypass.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(anchor);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  const stay = useCallback(() => setPending(null), []);
  const leave = useCallback(() => {
    const anchor = pending;
    setPending(null);
    if (!anchor) return;
    bypass.current = true;
    try { anchor.click(); } finally { bypass.current = false; }
  }, [pending]);

  return { confirmingLeave: pending !== null, stay, leave };
}

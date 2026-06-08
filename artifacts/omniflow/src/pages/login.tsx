import { useState } from "react";
import { useLocation } from "wouter";
import { Hexagon, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Login() {
  const [, setLocation] = useLocation();
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setTimeout(() => setLocation("/dashboard"), 800);
  };

  return (
    <div
      className="min-h-dvh w-full flex flex-col md:flex-row bg-background text-foreground overflow-x-hidden"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {/* ── Brand panel ── */}
      <div className="relative flex flex-col justify-between md:w-1/2 px-6 py-5 md:p-12 border-b md:border-b-0 md:border-r border-border bg-card overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent opacity-50" />

        {/* Logo */}
        <div className="relative z-10 flex items-center gap-2">
          <Hexagon className="w-6 h-6 md:w-8 md:h-8 text-primary fill-primary/20" />
          <span className="text-xl md:text-2xl font-bold tracking-tight">OMNIFLOW</span>
        </div>

        {/* Tagline */}
        <div className="relative z-10 py-5 md:py-0">
          <motion.h1
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            className="text-2xl md:text-5xl font-bold leading-tight mb-2 md:mb-6"
          >
            Centro de mando para equipos{" "}
            <span className="text-primary drop-shadow-[0_0_15px_rgba(59,130,246,0.5)]">
              de alto rendimiento.
            </span>
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="text-sm md:text-lg text-muted-foreground"
          >
            Todo a la vista. Sin fricción. Cada acción con confianza.
          </motion.p>
        </div>

        <div className="relative z-10 text-xs text-muted-foreground hidden md:block">
          &copy; {new Date().getFullYear()} OmniTech Core. Todos los derechos reservados.
        </div>
      </div>

      {/* ── Sign-in form ── */}
      <div className="flex-1 flex items-center justify-center px-6 py-8 md:p-8">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-1">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Bienvenido de vuelta</h2>
            <p className="text-muted-foreground text-sm">Ingresa tus credenciales para continuar</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm font-medium">Correo electrónico</Label>
                <Input
                  id="email"
                  placeholder="agente@omniflow.com"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  className="bg-background/50 focus-visible:ring-primary h-12 text-base"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm font-medium">Contraseña</Label>
                  <a href="#" className="text-xs font-medium text-primary hover:underline touch-manipulation py-1">
                    ¿Olvidaste tu contraseña?
                  </a>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="bg-background/50 focus-visible:ring-primary h-12 text-base"
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-12 text-sm font-semibold shadow-[0_4px_20px_rgba(59,130,246,0.3)] touch-manipulation"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                  Autenticando...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  Iniciar sesión <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} OmniTech Core
          </p>
        </div>
      </div>
    </div>
  );
}

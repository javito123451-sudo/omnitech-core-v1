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
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-background text-foreground">
      {/* Brand panel — full width on mobile (compact), half on desktop */}
      <div className="relative flex flex-col justify-between md:w-1/2 p-6 md:p-12 border-b md:border-b-0 md:border-r border-border bg-card overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_var(--tw-gradient-stops))] from-primary/20 via-transparent to-transparent opacity-50" />

        <div className="relative z-10 flex items-center gap-2">
          <Hexagon className="w-6 h-6 md:w-8 md:h-8 text-primary fill-primary/20" />
          <span className="text-xl md:text-2xl font-bold tracking-tight">OMNIFLOW</span>
        </div>

        <div className="relative z-10 py-6 md:py-0">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-2xl md:text-5xl font-bold leading-tight mb-3 md:mb-6"
          >
            Mission control for{" "}
            <span className="text-primary drop-shadow-[0_0_15px_rgba(59,130,246,0.5)]">
              high-performance
            </span>{" "}
            teams.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-sm md:text-lg text-muted-foreground"
          >
            Everything at a glance. Zero friction. Every action confident.
          </motion.p>
        </div>

        <div className="relative z-10 text-xs text-muted-foreground hidden md:block">
          &copy; {new Date().getFullYear()} Omniflow CRM. All rights reserved.
        </div>
      </div>

      {/* Sign-in form */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-8">
        <div className="w-full max-w-sm space-y-6 md:space-y-8">
          <div className="text-center space-y-1">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Welcome back</h2>
            <p className="text-muted-foreground text-sm">Enter your credentials to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm">Email</Label>
                <Input
                  id="email"
                  placeholder="agent@omniflow.com"
                  type="email"
                  required
                  autoComplete="email"
                  className="bg-background/50 focus-visible:ring-primary h-10"
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password" className="text-sm">Password</Label>
                  <a href="#" className="text-xs font-medium text-primary hover:underline">
                    Forgot password?
                  </a>
                </div>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                  className="bg-background/50 focus-visible:ring-primary h-10"
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-10"
              disabled={isLoading}
            >
              {isLoading ? "Authenticating..." : (
                <span className="flex items-center gap-2">
                  Sign In <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </Button>
          </form>

          <p className="text-center text-xs text-muted-foreground md:hidden">
            &copy; {new Date().getFullYear()} Omniflow CRM
          </p>
        </div>
      </div>
    </div>
  );
}

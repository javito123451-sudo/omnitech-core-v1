import { useClerk } from "@clerk/react";
import { ShieldOff, LogOut } from "lucide-react";

export default function NoAccess() {
  const { signOut } = useClerk();

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="w-full max-w-md text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-destructive/10 border border-destructive/20 mb-6">
          <ShieldOff className="w-8 h-8 text-destructive" />
        </div>

        <h1 className="text-2xl font-bold text-foreground mb-3">
          Sin acceso
        </h1>

        <p className="text-muted-foreground text-sm leading-relaxed mb-8">
          No tienes un workspace asignado.
          <br />
          Contacta con tu administrador para recibir una invitación.
        </p>

        <button
          onClick={() => signOut({ redirectUrl: "/sign-in" })}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-muted hover:bg-muted/80 text-foreground text-sm font-medium transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Cerrar sesión
        </button>
      </div>
    </div>
  );
}

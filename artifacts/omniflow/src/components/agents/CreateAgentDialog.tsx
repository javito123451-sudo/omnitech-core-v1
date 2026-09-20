import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ApiErrorAlert } from "@/components/agents/ApiErrorAlert";
import { useCreateAgent } from "@/lib/agents/hooks";

/**
 * Crear agente (POST /api/agents). Solo `name` es obligatorio; description y avatarUrl son opcionales y `config`
 * no se envía: el backend crea la versión 1 (borrador) con la configuración por defecto. Solo se muestra a quien
 * tiene agents.write (lo decide la página).
 */
export function CreateAgentDialog({ variant = "default" }: { variant?: "default" | "outline" }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const create = useCreateAgent();

  const trimmed = name.trim();

  function reset() {
    setName(""); setDescription(""); setAvatarUrl(""); create.reset();
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!trimmed || create.isPending) return;
    create.mutate(
      { name: trimmed, description: description.trim() || null, avatarUrl: avatarUrl.trim() || null },
      {
        onSuccess: (created) => {
          toast({ title: "Agente creado", description: `«${created.agent.name}» se ha creado como borrador.` });
          setOpen(false);
          reset();
          navigate(`/agents/${created.agent.id}`);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant={variant} data-testid="create-agent-button">
          <Plus className="h-4 w-4 mr-1.5" /> Crear agente
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Crear agente</DialogTitle>
            <DialogDescription>
              Se creará como borrador con la configuración por defecto. Podrás editarla y publicarla más adelante.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="agent-name">Nombre</Label>
            <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Asistente de ventas" autoFocus required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-description">Descripción (opcional)</Label>
            <Textarea id="agent-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-avatar">URL del avatar (opcional)</Label>
            <Input id="agent-avatar" type="url" value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://…" />
          </div>

          {create.isError && <ApiErrorAlert error={create.error} />}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={!trimmed || create.isPending}>
              {create.isPending ? "Creando…" : "Crear agente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

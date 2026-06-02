import { useListClients } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Clients() {
  const { data: clients, isLoading } = useListClients();

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'active': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'lead': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'inactive': return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
      case 'churned': return 'bg-red-500/10 text-red-400 border-red-500/20';
      default: return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  return (
    <div className="space-y-6 h-full flex flex-col animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Clients</h1>
          <p className="text-muted-foreground mt-1">Manage your pipeline and customer relationships.</p>
        </div>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
          <Plus className="w-4 h-4 mr-2" /> New Client
        </Button>
      </div>

      <Card className="bg-card border-border flex-1 flex flex-col overflow-hidden">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="relative w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Search clients..." className="pl-9 bg-background/50 border-border" />
            </div>
            <Button variant="outline" size="sm" className="border-border text-muted-foreground">
              <Filter className="w-4 h-4 mr-2" /> Filter
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto p-0">
          <Table>
            <TableHeader className="bg-background/50 sticky top-0 z-10">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-muted-foreground">Name</TableHead>
                <TableHead className="text-muted-foreground">Company</TableHead>
                <TableHead className="text-muted-foreground">Status</TableHead>
                <TableHead className="text-muted-foreground">Value</TableHead>
                <TableHead className="text-muted-foreground text-right">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading clients...</TableCell>
                </TableRow>
              ) : clients?.map((client) => (
                <TableRow key={client.id} className="border-border hover:bg-white/5 cursor-pointer transition-colors group">
                  <TableCell className="font-medium text-white group-hover:text-primary transition-colors">
                    {client.name}
                    <div className="text-xs text-muted-foreground font-normal mt-0.5">{client.email}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{client.company || '-'}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={getStatusColor(client.status)}>
                      {client.status.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-white font-medium">
                    {client.value ? `$${client.value.toLocaleString()}` : '-'}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {new Date(client.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && !clients?.length && (
                 <TableRow>
                 <TableCell colSpan={5} className="text-center py-16 text-muted-foreground">
                   No clients found. Add one to get started.
                 </TableCell>
               </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

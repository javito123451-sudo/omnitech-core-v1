import { useState } from "react";
import { useListAppointments } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar as CalendarDayPicker } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Plus, Clock, User, CalendarDays } from "lucide-react";
import { format } from "date-fns";

export default function Calendar() {
  const [date, setDate] = useState<Date | undefined>(new Date());
  const { data: appointments, isLoading } = useListAppointments();

  const dayAppointments = appointments?.filter((app) => {
    if (!date) return false;
    const appDate = new Date(app.startTime);
    return (
      appDate.getDate() === date.getDate() &&
      appDate.getMonth() === date.getMonth() &&
      appDate.getFullYear() === date.getFullYear()
    );
  });

  return (
    <div className="space-y-4 h-full flex flex-col animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div className="min-w-0">
          <h1 className="text-xl md:text-3xl font-bold tracking-tight text-white">Calendar</h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-0.5 hidden sm:block">Manage your schedule and appointments.</p>
        </div>
        <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0">
          <Plus className="w-4 h-4 mr-1 md:mr-2" />
          <span className="hidden sm:inline">New </span>Appt
        </Button>
      </div>

      {/* Layout: stacks on mobile, side-by-side on md+ */}
      <div className="flex flex-col md:grid md:grid-cols-3 gap-4 flex-1 overflow-hidden">
        {/* Calendar picker */}
        <Card className="bg-card border-border md:h-max shrink-0">
          <CardContent className="p-2 md:p-3 flex justify-center">
            <CalendarDayPicker
              mode="single"
              selected={date}
              onSelect={setDate}
              className="bg-transparent text-white scale-90 md:scale-100 origin-top"
            />
          </CardContent>
        </Card>

        {/* Appointments list */}
        <Card className="md:col-span-2 bg-card border-border flex flex-col flex-1 overflow-hidden">
          <CardHeader className="border-b border-border pb-3 pt-3 px-4 shrink-0">
            <CardTitle className="text-sm md:text-base flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-primary shrink-0" />
              {date ? format(date, "MMMM d, yyyy") : "Select a date"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-0 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-border/50 animate-pulse rounded-lg" />
                ))}
              </div>
            ) : dayAppointments && dayAppointments.length > 0 ? (
              <div className="divide-y divide-border">
                {dayAppointments.map((app) => (
                  <div
                    key={app.id}
                    className="p-4 hover:bg-white/5 transition-colors cursor-pointer border-l-2 border-transparent hover:border-primary"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <div className="min-w-0">
                        <h4 className="text-white font-medium text-sm md:text-base truncate">{app.title}</h4>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {format(new Date(app.startTime), "h:mm a")} – {format(new Date(app.endTime), "h:mm a")}
                          </span>
                          {app.clientName && (
                            <span className="flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {app.clientName}
                            </span>
                          )}
                        </div>
                        {app.description && (
                          <p className="mt-1.5 text-xs text-slate-400 line-clamp-2">{app.description}</p>
                        )}
                      </div>
                      <div className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-secondary text-secondary-foreground border border-border shrink-0">
                        {app.status.replace("_", " ").toUpperCase()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-48 md:h-64 text-muted-foreground">
                <CalendarDays className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm">No appointments for this day.</p>
                <Button variant="link" className="text-primary mt-1 text-sm h-auto p-0">
                  Schedule one now
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

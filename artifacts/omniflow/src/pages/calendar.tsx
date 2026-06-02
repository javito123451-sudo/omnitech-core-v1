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

  const dayAppointments = appointments?.filter(app => {
    if (!date) return false;
    const appDate = new Date(app.startTime);
    return appDate.getDate() === date.getDate() && 
           appDate.getMonth() === date.getMonth() && 
           appDate.getFullYear() === date.getFullYear();
  });

  return (
    <div className="space-y-6 h-full flex flex-col animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Calendar</h1>
          <p className="text-muted-foreground mt-1">Manage your schedule and appointments.</p>
        </div>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="w-4 h-4 mr-2" /> New Appointment
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1">
        <Card className="bg-card border-border h-max">
          <CardContent className="p-4">
            <CalendarDayPicker
              mode="single"
              selected={date}
              onSelect={setDate}
              className="bg-transparent text-white mx-auto"
            />
          </CardContent>
        </Card>

        <Card className="md:col-span-2 bg-card border-border flex flex-col">
          <CardHeader className="border-b border-border pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-primary" />
              Schedule for {date ? format(date, 'MMMM d, yyyy') : 'Select a date'}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 p-0 overflow-auto">
            {isLoading ? (
              <div className="p-6 space-y-4">
                {[1,2,3].map(i => <div key={i} className="h-20 bg-border/50 animate-pulse rounded-lg" />)}
              </div>
            ) : dayAppointments && dayAppointments.length > 0 ? (
              <div className="divide-y divide-border">
                {dayAppointments.map(app => (
                  <div key={app.id} className="p-6 hover:bg-white/5 transition-colors group cursor-pointer border-l-2 border-transparent hover:border-primary">
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="text-white font-medium text-lg">{app.title}</h4>
                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-4 h-4" />
                            {format(new Date(app.startTime), 'h:mm a')} - {format(new Date(app.endTime), 'h:mm a')}
                          </span>
                          {app.clientName && (
                            <span className="flex items-center gap-1">
                              <User className="w-4 h-4" />
                              {app.clientName}
                            </span>
                          )}
                        </div>
                        {app.description && (
                          <p className="mt-3 text-sm text-slate-400">{app.description}</p>
                        )}
                      </div>
                      <div className="px-3 py-1 rounded-full text-xs font-medium bg-secondary text-secondary-foreground border border-border">
                        {app.status.replace('_', ' ').toUpperCase()}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
                <CalendarDays className="w-12 h-12 mb-4 opacity-20" />
                <p>No appointments scheduled for this day.</p>
                <Button variant="link" className="text-primary mt-2">Schedule one now</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

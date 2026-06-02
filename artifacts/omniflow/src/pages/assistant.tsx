import { useState } from "react";
import { useListConversations, useListMessages, useSendMessage, useGenerateAiReply } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Sparkles, Send, Search, ArrowLeft } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export default function Assistant() {
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const [showChat, setShowChat] = useState(false);
  const { data: conversations, isLoading: loadingConversations } = useListConversations();

  const handleSelectConversation = (clientId: number) => {
    setSelectedClientId(clientId);
    setShowChat(true);
  };

  return (
    <div className="h-[calc(100dvh-7rem)] md:h-[calc(100dvh-4rem)] animate-in fade-in duration-500 flex flex-col">
      <div className="mb-3 md:mb-4 shrink-0">
        <h1 className="text-xl md:text-3xl font-bold tracking-tight text-white">Asistente IA</h1>
        <p className="text-muted-foreground text-xs md:text-sm mt-0.5">Conversaciones impulsadas por inteligencia artificial.</p>
      </div>

      <div className="flex gap-4 flex-1 overflow-hidden">
        {/* Conversation list */}
        <Card className={cn(
          "bg-card border-border flex flex-col overflow-hidden transition-all duration-200",
          "w-full md:w-72 md:shrink-0",
          showChat ? "hidden md:flex" : "flex"
        )}>
          <div className="p-3 border-b border-border shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input placeholder="Buscar mensajes..." className="pl-9 bg-background/50 border-border text-sm h-9" />
            </div>
          </div>
          <ScrollArea className="flex-1">
            {loadingConversations ? (
              <div className="p-3 space-y-2">
                {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 bg-border/50 animate-pulse rounded-lg" />)}
              </div>
            ) : (
              <div className="p-2 space-y-0.5">
                {conversations?.map((conv) => (
                  <div
                    key={conv.clientId}
                    onClick={() => handleSelectConversation(conv.clientId)}
                    className={cn(
                      "p-3 rounded-lg cursor-pointer transition-all flex items-center gap-3",
                      selectedClientId === conv.clientId
                        ? "bg-primary/20 border border-primary/30"
                        : "hover:bg-white/5 border border-transparent"
                    )}
                  >
                    <Avatar className="h-9 w-9 border border-border shrink-0">
                      <AvatarFallback className="bg-background text-primary text-xs">
                        {conv.clientName.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline mb-0.5">
                        <span className="font-medium text-white text-sm truncate">{conv.clientName}</span>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap ml-2">
                          {new Date(conv.lastMessageAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{conv.lastMessage}</p>
                    </div>
                    {conv.unreadCount > 0 && (
                      <div className="w-4 h-4 rounded-full bg-primary flex items-center justify-center text-[9px] font-bold text-primary-foreground shrink-0">
                        {conv.unreadCount}
                      </div>
                    )}
                  </div>
                ))}
                {!conversations?.length && (
                  <div className="py-8 text-center text-xs text-muted-foreground">Sin conversaciones aún</div>
                )}
              </div>
            )}
          </ScrollArea>
        </Card>

        {/* Chat thread */}
        <Card className={cn(
          "bg-card border-border flex-col overflow-hidden flex-1",
          showChat ? "flex" : "hidden md:flex"
        )}>
          {selectedClientId ? (
            <ChatThread
              clientId={selectedClientId}
              clientName={conversations?.find((c) => c.clientId === selectedClientId)?.clientName}
              onBack={() => setShowChat(false)}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
              <MessageSquare className="w-10 h-10 mb-3 opacity-20" />
              <p className="text-sm">Selecciona una conversación</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function ChatThread({ clientId, clientName, onBack }: { clientId: number; clientName?: string; onBack: () => void }) {
  const { data: messages, isLoading } = useListMessages({ clientId }, { query: { enabled: !!clientId } });
  const sendMessage = useSendMessage();
  const generateReply = useGenerateAiReply();
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage.mutate({ data: { clientId, content: input, isAi: false } }, { onSuccess: () => setInput("") });
  };

  const handleAiReply = () => {
    generateReply.mutate(
      { data: { clientId, lastMessage: messages?.[messages.length - 1]?.content || "" } },
      { onSuccess: (res) => setInput(res.reply) }
    );
  };

  return (
    <>
      <div className="p-3 border-b border-border bg-background/50 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="md:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="bg-primary/20 text-primary text-xs">
              {(clientName ?? "C").substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <h3 className="font-bold text-white text-sm">{clientName ?? "Cliente"}</h3>
            <p className="text-[10px] text-green-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block animate-pulse" /> En línea
            </p>
          </div>
        </div>
        <Button
          variant="outline" size="sm" onClick={handleAiReply} disabled={generateReply.isPending}
          className="border-primary/50 text-primary hover:bg-primary/10 text-xs h-8 px-2 md:px-3"
        >
          <Sparkles className="w-3 h-3 mr-1" />
          <span>{generateReply.isPending ? "Generando..." : "Respuesta IA"}</span>
        </Button>
      </div>

      <ScrollArea className="flex-1 p-3 md:p-4">
        {isLoading ? (
          <div className="space-y-3">
            <div className="h-10 w-2/3 bg-border/50 animate-pulse rounded-xl" />
            <div className="h-10 w-1/2 bg-border/50 animate-pulse rounded-xl ml-auto" />
          </div>
        ) : (
          <div className="space-y-3">
            {messages?.map((msg) => {
              const isInbound = msg.direction === "inbound";
              return (
                <div key={msg.id} className={cn("flex w-full", isInbound ? "justify-start" : "justify-end")}>
                  <div className={cn(
                    "max-w-[80%] md:max-w-[70%] rounded-2xl px-3 py-2 relative",
                    isInbound ? "bg-secondary text-secondary-foreground rounded-tl-sm" : "bg-primary text-primary-foreground rounded-tr-sm"
                  )}>
                    {msg.isAi && !isInbound && <Sparkles className="w-2.5 h-2.5 absolute -top-1 -right-1 text-yellow-400" />}
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                    <span className="text-[10px] opacity-50 mt-1 block text-right">
                      {new Date(msg.createdAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                </div>
              );
            })}
            {!messages?.length && (
              <div className="text-center text-xs text-muted-foreground py-8">Inicia la conversación.</div>
            )}
          </div>
        )}
      </ScrollArea>

      <div className="p-3 border-t border-border bg-background/50 shrink-0">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2">
          <Input
            value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="Escribe un mensaje..." className="flex-1 bg-background border-border text-sm h-9"
          />
          <Button type="submit" size="sm" disabled={!input.trim() || sendMessage.isPending} className="bg-primary hover:bg-primary/90 h-9 w-9 p-0">
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </>
  );
}

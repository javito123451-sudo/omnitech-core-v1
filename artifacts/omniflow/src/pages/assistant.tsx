import { useState } from "react";
import { useListConversations, useListMessages, useSendMessage, useGenerateAiReply } from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageSquare, Sparkles, Send, Bot, User, Search } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export default function Assistant() {
  const [selectedClientId, setSelectedClientId] = useState<number | null>(null);
  const { data: conversations, isLoading: loadingConversations } = useListConversations();
  
  return (
    <div className="flex h-[calc(100vh-6rem)] gap-6 animate-in fade-in duration-500">
      <Card className="w-1/3 bg-card border-border flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border">
          <h2 className="text-xl font-bold text-white mb-4">Conversations</h2>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Search messages..." className="pl-9 bg-background/50 border-border" />
          </div>
        </div>
        <ScrollArea className="flex-1">
          {loadingConversations ? (
            <div className="p-4 space-y-4">
              {[1,2,3].map(i => <div key={i} className="h-16 bg-border/50 animate-pulse rounded-lg" />)}
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {conversations?.map((conv) => (
                <div 
                  key={conv.clientId}
                  onClick={() => setSelectedClientId(conv.clientId)}
                  className={cn(
                    "p-3 rounded-lg cursor-pointer transition-all flex items-center gap-3",
                    selectedClientId === conv.clientId 
                      ? "bg-primary/20 border border-primary/30" 
                      : "hover:bg-white/5 border border-transparent"
                  )}
                >
                  <Avatar className="h-10 w-10 border border-border">
                    <AvatarFallback className="bg-background text-primary">
                      {conv.clientName.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="font-medium text-white truncate">{conv.clientName}</span>
                      <span className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                        {new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground truncate">{conv.lastMessage}</p>
                  </div>
                  {conv.unreadCount > 0 && (
                    <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground">
                      {conv.unreadCount}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </Card>

      <Card className="flex-1 bg-card border-border flex flex-col overflow-hidden relative">
        {selectedClientId ? (
          <ChatThread clientId={selectedClientId} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
            <MessageSquare className="w-12 h-12 mb-4 opacity-20" />
            <p>Select a conversation to start messaging</p>
          </div>
        )}
      </Card>
    </div>
  );
}

function ChatThread({ clientId }: { clientId: number }) {
  const { data: messages, isLoading } = useListMessages({ clientId }, { query: { enabled: !!clientId } });
  const sendMessage = useSendMessage();
  const generateReply = useGenerateAiReply();
  const [input, setInput] = useState("");

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage.mutate({ data: { clientId, content: input, isAi: false } }, {
      onSuccess: () => setInput("")
    });
  };

  const handleAiReply = () => {
    generateReply.mutate({ data: { clientId, lastMessage: messages?.[messages.length-1]?.content || "" } }, {
      onSuccess: (res) => setInput(res.reply)
    });
  };

  return (
    <>
      <div className="p-4 border-b border-border bg-background/50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary/20 text-primary">C</AvatarFallback>
          </Avatar>
          <div>
            <h3 className="font-bold text-white">Client Chat</h3>
            <p className="text-xs text-green-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-400 inline-block animate-pulse" /> Online
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleAiReply} disabled={generateReply.isPending} className="border-primary/50 text-primary hover:bg-primary/10">
          <Sparkles className="w-4 h-4 mr-2" />
          {generateReply.isPending ? "Generating..." : "Generate AI Reply"}
        </Button>
      </div>

      <ScrollArea className="flex-1 p-4">
        {isLoading ? (
          <div className="space-y-4">
            <div className="h-12 w-2/3 bg-border/50 animate-pulse rounded-lg" />
            <div className="h-12 w-1/2 bg-border/50 animate-pulse rounded-lg ml-auto" />
          </div>
        ) : (
          <div className="space-y-4">
            {messages?.map((msg) => {
              const isInbound = msg.direction === 'inbound';
              return (
                <div key={msg.id} className={cn("flex w-full", isInbound ? "justify-start" : "justify-end")}>
                  <div className={cn(
                    "max-w-[75%] rounded-2xl px-4 py-2 relative group",
                    isInbound 
                      ? "bg-secondary text-secondary-foreground rounded-tl-sm" 
                      : "bg-primary text-primary-foreground rounded-tr-sm"
                  )}>
                    {msg.isAi && !isInbound && (
                      <Sparkles className="w-3 h-3 absolute -top-1 -right-1 text-yellow-400" />
                    )}
                    <p className="text-sm">{msg.content}</p>
                    <span className="text-[10px] opacity-50 mt-1 block text-right">
                      {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <div className="p-4 border-t border-border bg-background/50">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex gap-2">
          <Input 
            value={input} 
            onChange={(e) => setInput(e.target.value)} 
            placeholder="Type a message..." 
            className="flex-1 bg-background border-border"
          />
          <Button type="submit" disabled={!input.trim() || sendMessage.isPending} className="bg-primary hover:bg-primary/90">
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </>
  );
}

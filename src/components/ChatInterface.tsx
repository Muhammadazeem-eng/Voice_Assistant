
import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Send, File } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import DocumentUpload from './DocumentUpload';
import { useRAGChat } from '@/hooks/useRAGChat';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  documentContext?: any[];
}

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (role: 'user' | 'assistant', content: string) => void;
  apiKey: string;
  transcriptionText: string;
}

export interface ChatInterfaceRef {
  sendMessage: (message: string) => void;
}

const ChatInterface = forwardRef<ChatInterfaceRef, ChatInterfaceProps>(({
  messages: externalMessages,
  onSendMessage,
  apiKey,
  transcriptionText
}, ref) => {
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  
  const { 
    documents, 
    setDocuments, 
    messages: ragMessages, 
    sendMessage: sendRAGMessage
  } = useRAGChat(apiKey);

  // Use RAG messages if available and documents exist, otherwise use external messages
  const displayMessages = documents.length > 0 ? ragMessages : externalMessages;

  // Expose sendMessage method to parent component
  useImperativeHandle(ref, () => ({
    sendMessage: (message: string) => {
      setInputText(message);
      setTimeout(() => handleSendMessage(message), 100);
    }
  }), []);

  useEffect(() => {
    // Auto-scroll to bottom when new messages arrive
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector('[data-radix-scroll-area-viewport]');
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [displayMessages]);

  const handleSendMessage = async (messageOverride?: string) => {
    const messageToSend = messageOverride || inputText.trim();
    if (!messageToSend) return;
    
    if (!apiKey) {
      toast({
        title: "API Key Required",
        description: "Please configure your OpenAI API key in the settings.",
        variant: "destructive"
      });
      return;
    }

    const userMessage = messageToSend;
    if (!messageOverride) {
      setInputText('');
    }
    setIsLoading(true);

    try {
      // Use RAG-enabled send message if we have documents
      if (documents.length > 0) {
        await sendRAGMessage(userMessage);
      } else {
        // Fallback to original chat logic
        onSendMessage('user', userMessage);

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-4-turbo-preview',
            messages: [
              {
                role: 'system',
                content: 'You are a helpful AI assistant for meeting transcription and analysis. You can help analyze transcriptions, answer questions about the content, and provide insights.'
              },
              ...externalMessages.map(msg => ({
                role: msg.role,
                content: msg.content
              })),
              {
                role: 'user',
                content: userMessage
              }
            ],
            max_tokens: 1000,
            temperature: 0.7
          })
        });
  
        if (!response.ok) {
          throw new Error(`API request failed: ${response.statusText}`);
        }
  
        const data = await response.json();
        const assistantMessage = data.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
        
        onSendMessage('assistant', assistantMessage);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
      if (messageOverride) {
        setInputText('');
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <Card className="bg-slate-900/50 border-slate-700 h-[600px] flex flex-col">
      <div className="p-4 border-b border-slate-700">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-slate-200">AI Chat Assistant</h4>
          <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
            {displayMessages.length} messages
          </Badge>
        </div>
      </div>

      <div className="border-b border-slate-700 p-4">
        <DocumentUpload
          documents={documents}
          onDocumentsChange={setDocuments}
          apiKey={apiKey}
        />
      </div>

      <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
        {displayMessages.length === 0 ? (
          <div className="text-slate-500 italic text-sm text-center py-8">
            <p>Start a conversation with the AI assistant.</p>
            <p className="mt-2">Ask questions about your transcription or upload documents to chat with them.</p>
            <p className="mt-2 text-xs">💡 Tip: Select text in the transcription to send it directly to the AI</p>
          </div>
        ) : (
          <div className="space-y-4">
            {displayMessages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-lg p-3 ${
                  message.role === 'user' 
                    ? 'bg-blue-600 text-white' 
                    : 'bg-slate-800 text-slate-200 border border-slate-700'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant={message.role === 'user' ? 'secondary' : 'outline'} className="text-xs">
                      {message.role === 'user' ? 'You' : 'AI'}
                    </Badge>
                    <span className="text-xs opacity-70">
                      {formatTime(message.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">
                    {message.content}
                  </p>
                  {message.documentContext && message.documentContext.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-slate-600">
                      <p className="text-xs text-slate-400 mb-1">Sources:</p>
                      <div className="flex flex-wrap gap-1">
                        {message.documentContext.map((doc, index) => (
                          <Badge key={index} variant="outline" className="text-xs">
                            <File className="w-3 h-3 mr-1" />
                            {doc.filename}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-slate-800 text-slate-200 border border-slate-700 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex space-x-1">
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                      <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    </div>
                    <span className="text-xs text-slate-400">AI is thinking...</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      <div className="p-4 border-t border-slate-700">
        <div className="flex gap-2">
          <Input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              documents.length > 0 
                ? "Ask about the transcription or your documents..."
                : "Ask about the transcription..."
            }
            className="bg-slate-800 border-slate-600 text-slate-50 flex-1"
            disabled={isLoading}
          />
          <Button 
            onClick={() => handleSendMessage()}
            disabled={!inputText.trim() || isLoading}
            className="bg-blue-600 hover:bg-blue-700"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
});

ChatInterface.displayName = 'ChatInterface';

export default ChatInterface;

import React, { useState, useRef, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Mic, MicOff, Monitor, Upload, Copy, Trash2, Send, Settings, Play, Square } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import AudioRecorder from '@/components/AudioRecorder';
import TranscriptionDisplay from '@/components/TranscriptionDisplay';
import ChatInterface from '@/components/ChatInterface';
import FileUpload from '@/components/FileUpload';
import ConfigPanel from '@/components/ConfigPanel';

const Index = () => {
  const [config, setConfig] = useState({
    openaiApiKey: localStorage.getItem('openai_api_key') || '',
    webhookUrl: localStorage.getItem('webhook_url') || ''
  });
  
  const [fullTranscription, setFullTranscription] = useState<string>('');
  
  const [chatMessages, setChatMessages] = useState<Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }>>([]);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordingMode, setRecordingMode] = useState<'microphone' | 'system' | null>(null);

  const recordingTimerRef = useRef<NodeJS.Timeout>();
  const chatInterfaceRef = useRef<{ sendMessage: (message: string) => void }>();

  useEffect(() => {
    if (isRecording) {
      recordingTimerRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
    } else {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      setRecordingTime(0);
    }

    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, [isRecording]);

  const updateConfig = (key: string, value: string) => {
    const newConfig = { ...config, [key]: value };
    setConfig(newConfig);
    localStorage.setItem(key === 'openaiApiKey' ? 'openai_api_key' : 'webhook_url', value);
  };

  const updateFullTranscription = (text: string) => {
    setFullTranscription(text);
  };

  const addChatMessage = (role: 'user' | 'assistant', content: string) => {
    const message = {
      id: Date.now().toString(),
      role,
      content,
      timestamp: new Date()
    };
    setChatMessages(prev => [...prev, message]);
  };

  const handleSendToChat = (selectedText: string) => {
    if (!config.openaiApiKey) {
      toast({
        title: "API Key Required",
        description: "Please configure your OpenAI API key to use the chat functionality.",
        variant: "destructive"
      });
      return;
    }

    // Send the selected text directly to the chat interface
    if (chatInterfaceRef.current) {
      chatInterfaceRef.current.sendMessage(selectedText);
    }

    toast({
      title: "Text sent to AI",
      description: "Selected transcription text has been sent to the AI assistant.",
    });
  };

  const clearTranscription = () => {
    setFullTranscription('');
    toast({
      title: "Transcription cleared",
      description: "All transcription data has been removed."
    });
  };

  const copyTranscription = () => {
    navigator.clipboard.writeText(fullTranscription);
    toast({
      title: "Copied to clipboard",
      description: "Full transcription has been copied."
    });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">AI Meeting Assistant</h1>
              <p className="text-muted-foreground">Real-time transcription with AI chat support</p>
            </div>
            <div className="flex items-center gap-4">
              {isRecording && (
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                  <span className="text-sm font-mono text-muted-foreground">
                    {formatTime(recordingTime)}
                  </span>
                  <Badge variant="destructive" className="text-xs">
                    {recordingMode === 'microphone' ? 'MIC' : 'SYSTEM'}
                  </Badge>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        <ConfigPanel 
          config={config}
          onConfigUpdate={updateConfig}
        />

        {/* Audio Controls */}
        <Card className="mb-6">
          <div className="p-6">
            <h3 className="text-lg font-semibold mb-4">Audio Input</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <AudioRecorder
                isRecording={isRecording && recordingMode === 'microphone'}
                onStartRecording={() => {
                  setIsRecording(true);
                  setRecordingMode('microphone');
                }}
                onStopRecording={() => {
                  setIsRecording(false);
                  setRecordingMode(null);
                }}
                onFullTranscription={updateFullTranscription}
                onAudioLevel={setAudioLevel}
                webhookUrl={config.webhookUrl}
                mode="microphone"
              />
              
              <AudioRecorder
                isRecording={isRecording && recordingMode === 'system'}
                onStartRecording={() => {
                  setIsRecording(true);
                  setRecordingMode('system');
                }}
                onStopRecording={() => {
                  setIsRecording(false);
                  setRecordingMode(null);
                }}
                onFullTranscription={updateFullTranscription}
                onAudioLevel={setAudioLevel}
                webhookUrl={config.webhookUrl}
                mode="system"
              />

              <FileUpload
                onFileProcessed={() => {}}
                webhookUrl={config.webhookUrl}
              />
            </div>

            {/* Audio Level Visualization */}
            {isRecording && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-sm text-muted-foreground">Audio Level:</span>
                  <div className="flex-1 bg-muted rounded-full h-2">
                    <div 
                      className="bg-gradient-to-r from-green-500 to-yellow-500 h-2 rounded-full transition-all duration-100"
                      style={{ width: `${audioLevel}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground w-10">{Math.round(audioLevel)}%</span>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Transcription Column */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Transcription</h2>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyTranscription}
                  disabled={!fullTranscription}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={clearTranscription}
                  disabled={!fullTranscription}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Clear
                </Button>
              </div>
            </div>
            
            <TranscriptionDisplay
              fullTranscription={fullTranscription}
              isRecording={isRecording}
              onSendToChat={handleSendToChat}
            />
          </div>

          {/* Chat Column */}
          <div className="space-y-4">
            <h2 className="text-xl font-semibold">AI Assistant</h2>
            <ChatInterface
              ref={chatInterfaceRef}
              messages={chatMessages}
              onSendMessage={addChatMessage}
              apiKey={config.openaiApiKey}
              transcriptionText={fullTranscription}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;


import React from 'react';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

interface TranscriptionChunk {
  id: string;
  text: string;
  timestamp: Date;
}

interface TranscriptionDisplayProps {
  chunks: TranscriptionChunk[];
  isRecording: boolean;
}

const TranscriptionDisplay: React.FC<TranscriptionDisplayProps> = ({ chunks, isRecording }) => {
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const fullTranscription = chunks.map(chunk => chunk.text).join(' ');

  return (
    <div className="space-y-4">
      {/* Full Transcription View */}
      <Card className="bg-slate-900/50 border-slate-700">
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-slate-200">Complete Transcription</h4>
            {isRecording && <Badge variant="destructive" className="text-xs">LIVE</Badge>}
          </div>
          <ScrollArea className="h-32">
            <div className="text-slate-300 text-sm leading-relaxed">
              {fullTranscription || (
                <span className="text-slate-500 italic">
                  {isRecording ? 'Listening for audio...' : 'No transcription yet. Start recording to see text appear here.'}
                </span>
              )}
              {isRecording && (
                <span className="inline-block w-2 h-4 bg-slate-400 ml-1 animate-pulse" />
              )}
            </div>
          </ScrollArea>
        </div>
      </Card>

      {/* Individual Chunks */}
      <Card className="bg-slate-900/50 border-slate-700">
        <div className="p-4">
          <h4 className="font-medium text-slate-200 mb-3">Transcription Chunks</h4>
          <ScrollArea className="h-64">
            {chunks.length === 0 ? (
              <div className="text-slate-500 italic text-sm text-center py-8">
                No chunks processed yet
              </div>
            ) : (
              <div className="space-y-3">
                {chunks.map((chunk, index) => (
                  <div key={chunk.id} className="group">
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="text-xs border-slate-600 text-slate-400 shrink-0">
                        #{index + 1}
                      </Badge>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-slate-500 font-mono">
                            {formatTime(chunk.timestamp)}
                          </span>
                        </div>
                        <p className="text-sm text-slate-300 leading-relaxed">
                          {chunk.text}
                        </p>
                      </div>
                    </div>
                    {index < chunks.length - 1 && <Separator className="mt-3 bg-slate-700" />}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </Card>
    </div>
  );
};

export default TranscriptionDisplay;

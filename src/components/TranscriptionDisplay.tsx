
import React from 'react';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';

interface TranscriptionDisplayProps {
  fullTranscription: string;
  isRecording: boolean;
}

const TranscriptionDisplay: React.FC<TranscriptionDisplayProps> = ({ 
  fullTranscription, 
  isRecording 
}) => {
  return (
    <Card className="bg-slate-900/50 border-slate-700">
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-medium text-slate-200">Live Transcription</h4>
          {isRecording && <Badge variant="destructive" className="text-xs">LIVE</Badge>}
        </div>
        <ScrollArea className="h-64">
          <div className="text-slate-300 text-sm leading-relaxed">
            {fullTranscription || (
              <span className="text-slate-500 italic">
                {isRecording ? 'Listening for audio...' : 'No transcription yet. Start recording to see text appear here.'}
              </span>
            )}
            {isRecording && fullTranscription && (
              <span className="inline-block w-2 h-4 bg-slate-400 ml-1 animate-pulse" />
            )}
          </div>
        </ScrollArea>
      </div>
    </Card>
  );
};

export default TranscriptionDisplay;

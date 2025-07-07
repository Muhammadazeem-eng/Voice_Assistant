
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Send, MessageSquare } from 'lucide-react';

interface TranscriptionDisplayProps {
  fullTranscription: string;
  isRecording: boolean;
  onSendToChat?: (selectedText: string) => void;
}

interface PopupPosition {
  top: number;
  left: number;
  visible: boolean;
}

const TranscriptionDisplay: React.FC<TranscriptionDisplayProps> = ({ 
  fullTranscription, 
  isRecording,
  onSendToChat
}) => {
  const [selectedText, setSelectedText] = useState('');
  const [popupPosition, setPopupPosition] = useState<PopupPosition>({
    top: 0,
    left: 0,
    visible: false
  });
  
  const transcriptionRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const handleTextSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      setPopupPosition(prev => ({ ...prev, visible: false }));
      setSelectedText('');
      return;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) {
      setPopupPosition(prev => ({ ...prev, visible: false }));
      setSelectedText('');
      return;
    }

    // Check if selection is within our transcription area
    const range = selection.getRangeAt(0);
    if (!transcriptionRef.current?.contains(range.commonAncestorContainer)) {
      setPopupPosition(prev => ({ ...prev, visible: false }));
      setSelectedText('');
      return;
    }

    console.log('Text selected:', selectedText); // Debug log
    setSelectedText(selectedText);

    // Calculate popup position
    const rect = range.getBoundingClientRect();
    const containerRect = transcriptionRef.current.getBoundingClientRect();
    
    // Position popup above the selected text
    const top = rect.top - containerRect.top - 50;
    const left = rect.left - containerRect.left + (rect.width / 2) - 60; // Center the popup

    setPopupPosition({
      top: Math.max(10, top), // Ensure it doesn't go above the container
      left: Math.max(10, Math.min(left, containerRect.width - 130)), // Keep within bounds
      visible: true
    });
  }, []);

  const handleSendToChat = useCallback(() => {
    if (selectedText.trim() && onSendToChat) {
      console.log('Sending selected text to chat:', selectedText); // Debug log
      
      // Send only the selected text with a simple prompt
      const prompt = `Please analyze this part of the transcription: "${selectedText}"`;
      onSendToChat(prompt);
      
      // Clear selection and hide popup
      window.getSelection()?.removeAllRanges();
      setPopupPosition(prev => ({ ...prev, visible: false }));
      setSelectedText('');
    }
  }, [selectedText, onSendToChat]);

  const handleClickOutside = useCallback((event: MouseEvent) => {
    if (
      popupRef.current && 
      !popupRef.current.contains(event.target as Node) &&
      transcriptionRef.current &&
      !transcriptionRef.current.contains(event.target as Node)
    ) {
      setPopupPosition(prev => ({ ...prev, visible: false }));
      setSelectedText('');
      window.getSelection()?.removeAllRanges();
    }
  }, []);

  useEffect(() => {
    document.addEventListener('mouseup', handleTextSelection);
    document.addEventListener('mousedown', handleClickOutside);
    
    return () => {
      document.removeEventListener('mouseup', handleTextSelection);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [handleTextSelection, handleClickOutside]);

  return (
    <div className="space-y-4 relative">
      {/* Complete Transcription View */}
      <Card className="bg-slate-900/50 border-slate-700 relative">
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-medium text-slate-200">Live Transcription</h4>
            <div className="flex items-center gap-2">
              {isRecording && <Badge variant="destructive" className="text-xs">LIVE</Badge>}
              {onSendToChat && (
                <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
                  <MessageSquare className="w-3 h-3 mr-1" />
                  Select text to send to AI
                </Badge>
              )}
            </div>
          </div>
          <ScrollArea className="h-64 relative">
            <div 
              ref={transcriptionRef}
              className="text-slate-300 text-sm leading-relaxed select-text cursor-text"
              style={{ userSelect: 'text' }}
            >
              {fullTranscription || (
                <span className="text-slate-500 italic">
                  {isRecording ? 'Listening for audio...' : 'No transcription yet. Start recording to see text appear here.'}
                </span>
              )}
              {isRecording && fullTranscription && (
                <span className="inline-block w-2 h-4 bg-slate-400 ml-1 animate-pulse" />
              )}
            </div>

            {/* Floating Send to AI Popup */}
            {popupPosition.visible && onSendToChat && selectedText.trim() && (
              <div
                ref={popupRef}
                className="absolute z-50 animate-in fade-in-0 scale-in-95 duration-200"
                style={{
                  top: `${popupPosition.top}px`,
                  left: `${popupPosition.left}px`,
                }}
              >
                <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-lg p-2">
                  <Button
                    size="sm"
                    onClick={handleSendToChat}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1 h-8"
                  >
                    <Send className="w-3 h-3" />
                    Send to AI
                  </Button>
                  <div className="text-xs text-slate-400 mt-1 max-w-32 truncate">
                    "{selectedText.length > 20 ? selectedText.substring(0, 20) + '...' : selectedText}"
                  </div>
                </div>
                {/* Arrow pointing down to selected text */}
                <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                  <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-slate-600"></div>
                </div>
              </div>
            )}
          </ScrollArea>
        </div>
      </Card>
    </div>
  );
};

export default TranscriptionDisplay;

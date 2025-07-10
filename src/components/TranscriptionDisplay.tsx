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
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const handleTextSelection = useCallback(() => {
    console.log('Text selection triggered');
    
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      console.log('No selection found');
      setPopupPosition(prev => ({ ...prev, visible: false }));
      setSelectedText('');
      return;
    }

    const selectedText = selection.toString().trim();
    console.log('Selected text:', selectedText);
    
    if (!selectedText || selectedText.length < 2) {
      console.log('Selected text too short or empty');
      setPopupPosition(prev => ({ ...prev, visible: false }));
      setSelectedText('');
      return;
    }

    // Check if selection is within our transcription area
    const selectionRange = selection.getRangeAt(0);
    const commonAncestor = selectionRange.commonAncestorContainer;
    const isWithinTranscription = transcriptionRef.current?.contains(commonAncestor) || 
                                 transcriptionRef.current?.contains(commonAncestor.parentElement);
    
    if (!isWithinTranscription) {
      console.log('Selection not within transcription area');
      setPopupPosition(prev => ({ ...prev, visible: false }));
      setSelectedText('');
      return;
    }

    console.log('Valid text selection found:', selectedText);
    setSelectedText(selectedText);

    // Get the scroll viewport element
    const scrollViewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (!scrollViewport || !transcriptionRef.current) {
      console.log('Missing scroll viewport or transcription ref');
      return;
    }

    try {
      // Get the bounding rectangles
      const selectionRect = selectionRange.getBoundingClientRect();
      const viewportRect = scrollViewport.getBoundingClientRect();
      
      // Calculate position relative to the viewport
      const relativeTop = selectionRect.top - viewportRect.top;
      const relativeLeft = selectionRect.left - viewportRect.left;
      
      // Position popup above the selected text
      let top = relativeTop - 60; // 60px above selection
      let left = relativeLeft + (selectionRect.width / 2) - 60; // Center horizontally
      
      // Boundary checking within viewport
      const viewportHeight = viewportRect.height;
      const viewportWidth = viewportRect.width;
      
      // If popup would go above viewport, position it below selection
      if (top < 10) {
        top = relativeTop + selectionRect.height + 10;
      }
      
      // If popup would go below viewport, position it above but within bounds
      if (top > viewportHeight - 80) {
        top = Math.max(10, viewportHeight - 80);
      }
      
      // Horizontal boundary checking
      if (left < 10) {
        left = 10;
      } else if (left > viewportWidth - 130) {
        left = Math.max(10, viewportWidth - 130);
      }

      console.log('Setting popup position:', { top, left, viewportHeight, viewportWidth });
      
      setPopupPosition({
        top,
        left,
        visible: true
      });
    } catch (error) {
      console.error('Error calculating popup position:', error);
      setPopupPosition(prev => ({ ...prev, visible: false }));
    }
  }, []);

  const handleSendToChat = useCallback((e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    console.log('Send to chat triggered with text:', selectedText);
    
    if (!selectedText.trim() || !onSendToChat) {
      console.log('No selected text or onSendToChat handler');
      return;
    }

    try {
      console.log('Sending selected text directly to chat');
      
      // Immediately clear selection and hide popup to prevent interference
      window.getSelection()?.removeAllRanges();
      setPopupPosition(prev => ({ ...prev, visible: false }));
      setSelectedText('');
      
      // Send only the selected text directly to chat
      onSendToChat(selectedText);
      
    } catch (error) {
      console.error('Error sending to chat:', error);
    }
  }, [selectedText, onSendToChat]);

  const handleClickOutside = useCallback((event: MouseEvent) => {
    const target = event.target as Node;
    
    // Don't close if clicking on the popup itself
    if (popupRef.current && popupRef.current.contains(target)) {
      return;
    }
    
    // Don't close if clicking within transcription area (allow text selection)
    if (transcriptionRef.current && transcriptionRef.current.contains(target)) {
      return;
    }
    
    // Close popup if clicking outside
    console.log('Click outside detected, hiding popup');
    setPopupPosition(prev => ({ ...prev, visible: false }));
    setSelectedText('');
    window.getSelection()?.removeAllRanges();
  }, []);

  useEffect(() => {
    // Use mouseup for better text selection detection
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
          <div className="relative">
            <ScrollArea className="h-64 max-h-[400px]" ref={scrollAreaRef}>
              <div 
                ref={transcriptionRef}
                className="text-slate-300 text-sm leading-relaxed select-text cursor-text pr-4 min-h-[200px] relative"
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
            </ScrollArea>

            {/* Floating Send to AI Popup - positioned relative to ScrollArea */}
            {popupPosition.visible && onSendToChat && selectedText.trim() && (
              <div
                ref={popupRef}
                className="absolute z-50 animate-in fade-in-0 scale-in-95 duration-200 pointer-events-auto"
                style={{
                  top: `${popupPosition.top}px`,
                  left: `${popupPosition.left}px`,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-3">
                  <Button
                    size="sm"
                    onClick={handleSendToChat}
                    className="bg-blue-600 hover:bg-blue-700 text-white text-xs gap-1 h-8 min-w-[100px]"
                  >
                    <Send className="w-3 h-3" />
                    Send to AI
                  </Button>
                  <div className="text-xs text-slate-400 mt-2 max-w-40 truncate">
                    "{selectedText.length > 25 ? selectedText.substring(0, 25) + '...' : selectedText}"
                  </div>
                </div>
                {/* Arrow pointing to selected text */}
                <div className="absolute top-full left-1/2 transform -translate-x-1/2">
                  <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-slate-600"></div>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default TranscriptionDisplay;

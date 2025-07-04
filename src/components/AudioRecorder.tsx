import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Monitor, MonitorOff, Info } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface AudioRecorderProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onAudioChunk: (text: string) => void;
  onFullTranscription: (text: string) => void;
  onAudioLevel: (level: number) => void;
  webhookUrl: string;
  mode: 'microphone' | 'system';
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({
  isRecording,
  onStartRecording,
  onStopRecording,
  onAudioChunk,
  onFullTranscription,
  onAudioLevel,
  webhookUrl,
  mode
}) => {
  const [hasPermission, setHasPermission] = useState(false);
  const [showSystemAudioInstructions, setShowSystemAudioInstructions] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIntervalRef = useRef<NodeJS.Timeout>();

  // Get the most compatible MIME type
  const getBestMimeType = () => {
    // Try the most widely supported formats first
    const types = [
      'audio/webm', // Basic webm without codec specification
      'audio/mp4',
      'audio/ogg',
      '' // Let browser choose default
    ];
    
    for (const type of types) {
      if (type === '' || MediaRecorder.isTypeSupported(type)) {
        console.log('Selected MIME type:', type || 'browser default');
        return type;
      }
    }
    
    console.log('Using browser default MIME type');
    return '';
  };

  const startRecording = async () => {
    try {
      let stream: MediaStream;
      
      if (mode === 'microphone') {
        // Simplified audio constraints for better compatibility
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: true // Use basic audio constraints first
        });
      } else {
        // Show instructions for system audio before attempting
        setShowSystemAudioInstructions(true);
        
        try {
          // Basic display media request
          stream = await navigator.mediaDevices.getDisplayMedia({ 
            audio: true,
            video: true // Required for getDisplayMedia
          });

          // Check if audio track is available
          const audioTracks = stream.getAudioTracks();
          if (audioTracks.length === 0) {
            // Stop video tracks since we don't need them
            stream.getVideoTracks().forEach(track => track.stop());
            throw new Error('No audio track available. Please make sure to check "Share audio" when sharing your screen.');
          }

          console.log('Audio tracks found:', audioTracks.length);
          
          // Stop video tracks to save bandwidth
          stream.getVideoTracks().forEach(track => track.stop());

          // Hide instructions once successful
          setShowSystemAudioInstructions(false);
          
          toast({
            title: "System audio connected",
            description: "Successfully capturing system audio from screen share"
          });

        } catch (screenShareError: any) {
          setShowSystemAudioInstructions(false);
          
          if (screenShareError.name === 'NotAllowedError') {
            toast({
              title: "Screen sharing cancelled",
              description: "System audio capture requires screen sharing permission",
              variant: "destructive"
            });
          } else if (screenShareError.message.includes('No audio track')) {
            toast({
              title: "No audio detected",
              description: "Please share your screen again and make sure to check 'Share audio'",
              variant: "destructive"
            });
          } else {
            toast({
              title: "System audio failed",
              description: screenShareError.message || "Unable to capture system audio",
              variant: "destructive"
            });
          }
          return;
        }
      }

      streamRef.current = stream;
      setHasPermission(true);

      // Set up audio analysis for level visualization
      try {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        analyserRef.current = audioContextRef.current.createAnalyser();
        const source = audioContextRef.current.createMediaStreamSource(stream);
        source.connect(analyserRef.current);
        
        analyserRef.current.fftSize = 256;
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const updateAudioLevel = () => {
          if (analyserRef.current && isRecording) {
            analyserRef.current.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / bufferLength;
            onAudioLevel((average / 255) * 100);
            requestAnimationFrame(updateAudioLevel);
          }
        };
        updateAudioLevel();
      } catch (audioContextError) {
        console.warn('Audio context setup failed:', audioContextError);
        // Continue without audio level visualization
      }

      // Try to create MediaRecorder with minimal options
      const mimeType = getBestMimeType();
      let mediaRecorder: MediaRecorder;

      try {
        // First try with MIME type
        if (mimeType) {
          mediaRecorder = new MediaRecorder(stream, { mimeType });
        } else {
          // Fallback to default configuration
          mediaRecorder = new MediaRecorder(stream);
        }
      } catch (mimeError) {
        console.warn('Failed to create MediaRecorder with MIME type, trying default:', mimeError);
        try {
          // Last resort - basic MediaRecorder
          mediaRecorder = new MediaRecorder(stream);
        } catch (basicError) {
          throw new Error('MediaRecorder is not supported in this browser configuration');
        }
      }

      mediaRecorderRef.current = mediaRecorder;
      console.log('MediaRecorder created successfully');

      const audioChunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (event) => {
        console.log('Data available, size:', event.data.size);
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log('MediaRecorder stopped, chunks:', audioChunks.length);
        if (audioChunks.length > 0) {
          const audioBlob = new Blob(audioChunks, { 
            type: mediaRecorder.mimeType || 'audio/webm' 
          });
          console.log('Created audio blob, size:', audioBlob.size);
          await sendAudioToWebhook(audioBlob);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        toast({
          title: "Recording error",
          description: "An error occurred during recording",
          variant: "destructive"
        });
      };

      // Try to start recording with error handling
      try {
        console.log('Starting MediaRecorder...');
        mediaRecorder.start(1000); // Record in 1-second chunks
      } catch (startError) {
        console.error('Failed to start MediaRecorder:', startError);
        throw new Error('Failed to start recording - browser may not support this audio format');
      }
      
      // Send chunks every 3 seconds
      chunkIntervalRef.current = setInterval(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          console.log('Requesting data from MediaRecorder');
          mediaRecorderRef.current.requestData();
        }
      }, 3000);

      onStartRecording();
      
      toast({
        title: `${mode === 'microphone' ? 'Microphone' : 'System audio'} recording started`,
        description: "Audio is being processed in real-time"
      });

    } catch (error) {
      console.error('Error starting recording:', error);
      setShowSystemAudioInstructions(false);
      
      let errorMessage = `Unable to start ${mode === 'microphone' ? 'microphone' : 'system audio'} recording.`;
      
      if (error instanceof Error) {
        console.error('Error details:', {
          name: error.name,
          message: error.message,
          stack: error.stack
        });
        
        if (error.name === 'NotAllowedError') {
          errorMessage = mode === 'microphone' 
            ? 'Microphone access denied. Please allow microphone permissions and try again.'
            : 'Screen sharing permission denied. System audio requires screen sharing.';
        } else if (error.name === 'NotFoundError') {
          errorMessage = mode === 'microphone'
            ? 'No microphone found. Please connect a microphone and try again.'
            : 'No audio source found in screen share.';
        } else if (error.name === 'NotSupportedError' || error.message.includes('not supported')) {
          errorMessage = 'Audio recording is not supported in this browser. Try using Chrome, Firefox, or Edge.';
        } else if (error.message.includes('MediaRecorder')) {
          errorMessage = 'Recording failed due to browser compatibility issues. Please try a different browser.';
        }
      }
      
      toast({
        title: "Recording failed",
        description: errorMessage,
        variant: "destructive"
      });
    }
  };

  const stopRecording = () => {
    console.log('Stopping recording...');
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        console.log('Stopping track:', track.kind);
        track.stop();
      });
    }
    
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }

    setShowSystemAudioInstructions(false);
    onStopRecording();
    onAudioLevel(0);
    
    toast({
      title: "Recording stopped",
      description: "Audio processing has been stopped"
    });
  };

  const sendAudioToWebhook = async (audioBlob: Blob, retryCount = 0) => {
    if (!webhookUrl) {
      // Simulate transcription for demo purposes
      onAudioChunk(`[${mode.toUpperCase()}] Simulated transcription chunk at ${new Date().toLocaleTimeString()}`);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');
      formData.append('source', mode);

      console.log('Sending audio to webhook:', webhookUrl);
      console.log('Audio blob size:', audioBlob.size, 'bytes');
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
        headers: {
          // Don't set Content-Type, let browser set it with boundary for FormData
        }
      });

      clearTimeout(timeoutId);

      console.log('Webhook response status:', response.status);
      console.log('Webhook response headers:', Object.fromEntries(response.headers.entries()));

      if (response.ok) {
        const responseText = await response.text();
        console.log('Raw webhook response:', responseText);
        console.log('Response length:', responseText.length);
        
        if (!responseText.trim()) {
          console.log('Empty response from webhook, skipping');
          return;
        }
        
        try {
          const jsonResponse = JSON.parse(responseText);
          console.log('Parsed JSON response:', JSON.stringify(jsonResponse, null, 2));
          
          // Handle currentChunk and fullTranscription separately
          let currentChunk = '';
          let fullTranscription = '';
          
          if (jsonResponse.currentChunk && typeof jsonResponse.currentChunk === 'string' && jsonResponse.currentChunk.trim()) {
            currentChunk = jsonResponse.currentChunk.trim();
            console.log('✅ Found currentChunk:', currentChunk);
          }
          
          if (jsonResponse.fullTranscription && typeof jsonResponse.fullTranscription === 'string' && jsonResponse.fullTranscription.trim()) {
            fullTranscription = jsonResponse.fullTranscription.trim();
            console.log('✅ Found fullTranscription:', fullTranscription);
          }
          
          // If we have either chunk or full transcription, process them
          if (currentChunk || fullTranscription) {
            console.log('✅ Processing transcription data');
            
            toast({
              title: "Transcription received",
              description: `Processed ${currentChunk ? currentChunk.length : fullTranscription.length} characters`,
              duration: 2000
            });
            
            // Send currentChunk to chunks (for individual chunk display)
            if (currentChunk) {
              let displayChunk = currentChunk;
              if (jsonResponse.chunkCount || jsonResponse.timestamp) {
                const metadata = [];
                if (jsonResponse.chunkCount) metadata.push(`Chunk ${jsonResponse.chunkCount}`);
                if (jsonResponse.timestamp) metadata.push(new Date(jsonResponse.timestamp).toLocaleTimeString());
                displayChunk = `${currentChunk} [${metadata.join(', ')}]`;
              }
              onAudioChunk(displayChunk);
            }
            
            // Send fullTranscription separately (for complete transcription display)
            if (fullTranscription) {
              onFullTranscription(fullTranscription);
            }
          } else {
            console.log('❌ No transcription text found in response');
            console.log('Available fields:', Object.keys(jsonResponse));
            onAudioChunk(`[DEBUG] Webhook response received but no transcription text found. Available fields: ${Object.keys(jsonResponse).join(', ')}`);
          }
        } catch (parseError) {
          // If not JSON, treat as plain text
          console.log('Response is not JSON, treating as plain text:', responseText);
          const plainText = responseText.trim();
          if (plainText) {
            console.log('✅ Using plain text response as transcription');
            
            toast({
              title: "Transcription received",
              description: `Processed ${plainText.length} characters`,
              duration: 2000
            });
            
            onAudioChunk(plainText);
            onFullTranscription(plainText);
          } else {
            console.log('❌ Plain text response is empty');
            onAudioChunk(`[DEBUG] Webhook returned empty plain text response`);
          }
        }
      } else {
        const errorText = await response.text();
        console.error('Webhook error:', response.status, response.statusText, errorText);
        
        // Retry on server errors (5xx) up to 2 times
        if (response.status >= 500 && retryCount < 2) {
          console.log(`Retrying request due to server error (attempt ${retryCount + 1})`);
          setTimeout(() => sendAudioToWebhook(audioBlob, retryCount + 1), 1000 * (retryCount + 1));
          return;
        }
        
        onAudioChunk(`[ERROR] Webhook returned ${response.status}: ${response.statusText}${errorText ? ' - ' + errorText : ''}`);
      }
    } catch (error) {
      console.error('Error sending audio to webhook:', error);
      
      // Retry on network errors up to 2 times
      if (retryCount < 2) {
        console.log(`Retrying after network error (attempt ${retryCount + 1})`);
        setTimeout(() => sendAudioToWebhook(audioBlob, retryCount + 1), 2000 * (retryCount + 1));
        return;
      }
      
      // Only show fallback after all retries failed
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          onAudioChunk(`[${mode.toUpperCase()}] Request timeout - webhook took too long to respond (>15s)`);
        } else if (error.message.includes('Failed to fetch')) {
          onAudioChunk(`[${mode.toUpperCase()}] Network error - check webhook URL and CORS settings`);
        } else {
          onAudioChunk(`[${mode.toUpperCase()}] Connection error: ${error.message}`);
        }
      } else {
        onAudioChunk(`[${mode.toUpperCase()}] Unknown error occurred`);
      }
    }
  };

  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const Icon = mode === 'microphone' ? (isRecording ? MicOff : Mic) : (isRecording ? MonitorOff : Monitor);
  const label = mode === 'microphone' ? 'Microphone' : 'System Audio';

  return (
    <div className="flex flex-col space-y-3">
      {/* System Audio Instructions */}
      {mode === 'system' && showSystemAudioInstructions && (
        <Alert className="bg-blue-900/20 border-blue-700">
          <Info className="h-4 w-4" />
          <AlertDescription className="text-sm">
            <strong>To capture system audio:</strong>
            <br />
            1. Select "Share screen" in the browser dialog
            <br />
            2. Check "Share audio" checkbox
            <br />
            3. Choose the tab/application with audio
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col items-center space-y-2">
        <Button
          onClick={handleToggleRecording}
          variant={isRecording ? "destructive" : "outline"}
          size="lg"
          className={`w-full h-16 ${
            isRecording 
              ? 'bg-red-600 hover:bg-red-700 text-white' 
              : 'border-slate-600 text-slate-300 hover:bg-slate-800'
          }`}
        >
          <Icon className="w-6 h-6 mr-2" />
          {isRecording ? `Stop ${label}` : `Start ${label}`}
        </Button>
        
        <div className="text-center">
          <p className="text-sm text-slate-400">{label}</p>
          {mode === 'system' && !isRecording && (
            <p className="text-xs text-slate-500">Requires screen sharing with audio</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AudioRecorder;

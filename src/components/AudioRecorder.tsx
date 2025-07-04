
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
  const accumulatedTranscriptionRef = useRef<string>('');

  // Get the most compatible MIME type
  const getBestMimeType = () => {
    const types = [
      'audio/webm', 
      'audio/mp4',
      'audio/ogg',
      ''
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
      // Reset accumulated transcription when starting new recording
      accumulatedTranscriptionRef.current = '';
      
      let stream: MediaStream;
      
      if (mode === 'microphone') {
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: true
        });
      } else {
        setShowSystemAudioInstructions(true);
        
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({ 
            audio: true,
            video: true
          });

          const audioTracks = stream.getAudioTracks();
          if (audioTracks.length === 0) {
            stream.getVideoTracks().forEach(track => track.stop());
            throw new Error('No audio track available. Please make sure to check "Share audio" when sharing your screen.');
          }

          console.log('Audio tracks found:', audioTracks.length);
          stream.getVideoTracks().forEach(track => track.stop());
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
      }

      const mimeType = getBestMimeType();
      let mediaRecorder: MediaRecorder;

      try {
        if (mimeType) {
          mediaRecorder = new MediaRecorder(stream, { mimeType });
        } else {
          mediaRecorder = new MediaRecorder(stream);
        }
      } catch (mimeError) {
        console.warn('Failed to create MediaRecorder with MIME type, trying default:', mimeError);
        try {
          mediaRecorder = new MediaRecorder(stream);
        } catch (basicError) {
          throw new Error('MediaRecorder is not supported in this browser configuration');
        }
      }

      mediaRecorderRef.current = mediaRecorder;
      console.log('MediaRecorder created successfully');

      let currentChunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (event) => {
        console.log('Data available, size:', event.data.size);
        if (event.data.size > 0) {
          currentChunks.push(event.data);
        }
      };

      // Handle real-time chunk processing
      const processChunk = async () => {
        if (currentChunks.length > 0) {
          console.log('Processing chunk with', currentChunks.length, 'pieces');
          const audioBlob = new Blob(currentChunks, { 
            type: mediaRecorder.mimeType || 'audio/webm' 
          });
          console.log('Created chunk blob, size:', audioBlob.size);
          
          // Process this chunk immediately
          await sendAudioToWebhook(audioBlob);
          
          // Clear current chunks for next batch
          currentChunks = [];
        }
      };

      mediaRecorder.onstop = async () => {
        console.log('MediaRecorder stopped');
        // Process any remaining chunks
        await processChunk();
      };

      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
        toast({
          title: "Recording error",
          description: "An error occurred during recording",
          variant: "destructive"
        });
      };

      try {
        console.log('Starting MediaRecorder...');
        mediaRecorder.start(1000); // Record in 1-second chunks for more responsive data
      } catch (startError) {
        console.error('Failed to start MediaRecorder:', startError);
        throw new Error('Failed to start recording - browser may not support this audio format');
      }
      
      // Process chunks every 3 seconds for real-time transcription
      chunkIntervalRef.current = setInterval(async () => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          console.log('Requesting data for real-time processing');
          mediaRecorderRef.current.requestData();
          
          // Wait a bit for data to be available, then process
          setTimeout(processChunk, 100);
        }
      }, 3000);

      onStartRecording();
      
      toast({
        title: `${mode === 'microphone' ? 'Microphone' : 'System audio'} recording started`,
        description: "Real-time transcription active"
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
      description: "Final transcription processed"
    });
  };

  const sendAudioToWebhook = async (audioBlob: Blob, retryCount = 0) => {
    if (!webhookUrl) {
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
      });

      clearTimeout(timeoutId);

      console.log('Webhook response status:', response.status);

      if (response.ok) {
        const responseText = await response.text();
        console.log('Raw webhook response:', responseText);
        
        if (!responseText.trim()) {
          console.log('Empty response from webhook, skipping');
          return;
        }
        
        try {
          const jsonResponse = JSON.parse(responseText);
          console.log('Parsed JSON response:', JSON.stringify(jsonResponse, null, 2));
          
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
          
          if (currentChunk || fullTranscription) {
            console.log('✅ Processing transcription data - REAL TIME UPDATE');
            
            // For real-time updates, prioritize currentChunk for immediate display
            if (currentChunk) {
              // Accumulate transcription for continuous display
              if (!accumulatedTranscriptionRef.current.includes(currentChunk)) {
                accumulatedTranscriptionRef.current += (accumulatedTranscriptionRef.current ? ' ' : '') + currentChunk;
              }
              
              // Display the chunk immediately
              let displayChunk = currentChunk;
              if (jsonResponse.chunkCount || jsonResponse.timestamp) {
                const metadata = [];
                if (jsonResponse.chunkCount) metadata.push(`Chunk ${jsonResponse.chunkCount}`);
                if (jsonResponse.timestamp) metadata.push(new Date(jsonResponse.timestamp).toLocaleTimeString());
                displayChunk = `${currentChunk} [${metadata.join(', ')}]`;
              }
              
              // Send to chunk display (for chunk history)
              onAudioChunk(displayChunk);
              
              // Update full transcription display with accumulated text
              onFullTranscription(accumulatedTranscriptionRef.current);
            }
            
            // If we have fullTranscription from webhook, use it as the complete text
            if (fullTranscription) {
              accumulatedTranscriptionRef.current = fullTranscription;
              onFullTranscription(fullTranscription);
            }
            
            // Show success toast for real-time feedback
            toast({
              title: "Live transcription",
              description: `${currentChunk ? currentChunk.substring(0, 50) : fullTranscription.substring(0, 50)}${(currentChunk || fullTranscription).length > 50 ? '...' : ''}`,
              duration: 2000
            });
            
          } else {
            console.log('❌ No transcription text found in response');
            onAudioChunk(`[DEBUG] Webhook response received but no transcription text found`);
          }
        } catch (parseError) {
          console.log('Response is not JSON, treating as plain text:', responseText);
          const plainText = responseText.trim();
          if (plainText) {
            console.log('✅ Using plain text response as transcription');
            
            // Add to accumulated transcription
            accumulatedTranscriptionRef.current += (accumulatedTranscriptionRef.current ? ' ' : '') + plainText;
            
            onAudioChunk(plainText);
            onFullTranscription(accumulatedTranscriptionRef.current);
            
            toast({
              title: "Live transcription",
              description: plainText.substring(0, 50) + (plainText.length > 50 ? '...' : ''),
              duration: 2000
            });
          }
        }
      } else {
        const errorText = await response.text();
        console.error('Webhook error:', response.status, response.statusText, errorText);
        
        if (response.status >= 500 && retryCount < 2) {
          console.log(`Retrying request due to server error (attempt ${retryCount + 1})`);
          setTimeout(() => sendAudioToWebhook(audioBlob, retryCount + 1), 1000 * (retryCount + 1));
          return;
        }
        
        onAudioChunk(`[ERROR] Webhook returned ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error sending audio to webhook:', error);
      
      if (retryCount < 2) {
        console.log(`Retrying after network error (attempt ${retryCount + 1})`);
        setTimeout(() => sendAudioToWebhook(audioBlob, retryCount + 1), 2000 * (retryCount + 1));
        return;
      }
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          onAudioChunk(`[${mode.toUpperCase()}] Request timeout - webhook took too long to respond`);
        } else if (error.message.includes('Failed to fetch')) {
          onAudioChunk(`[${mode.toUpperCase()}] Network error - check webhook URL and CORS settings`);
        } else {
          onAudioChunk(`[${mode.toUpperCase()}] Connection error: ${error.message}`);
        }
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
          {isRecording && (
            <p className="text-xs text-green-400 animate-pulse">● Live transcription active</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default AudioRecorder;


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
  const [chunkCount, setChunkCount] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const accumulatedTranscriptionRef = useRef<string>('');
  const chunkIntervalRef = useRef<NodeJS.Timeout>();
  const isProcessingRef = useRef<boolean>(false);

  // Get the most compatible MIME type
  const getSupportedMimeType = () => {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
      'audio/wav'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log('✅ Selected MIME type:', type);
        return type;
      }
    }
    
    console.log('⚠️ Using browser default MIME type');
    return '';
  };

  const startRecording = async () => {
    try {
      console.log('🎙️ Starting recording in', mode, 'mode');
      
      // Reset state
      accumulatedTranscriptionRef.current = '';
      setChunkCount(0);
      isProcessingRef.current = false;
      
      let stream: MediaStream;
      
      if (mode === 'microphone') {
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
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

          console.log('✅ Audio tracks found:', audioTracks.length);
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
        console.warn('⚠️ Audio context setup failed:', audioContextError);
      }

      // Create MediaRecorder with optimal settings
      const mimeType = getSupportedMimeType();
      let mediaRecorder: MediaRecorder;

      try {
        const options: MediaRecorderOptions = {};
        if (mimeType) {
          options.mimeType = mimeType;
        }
        
        mediaRecorder = new MediaRecorder(stream, options);
        console.log('✅ MediaRecorder created with MIME type:', mediaRecorder.mimeType);
      } catch (error) {
        console.error('❌ MediaRecorder creation failed:', error);
        throw new Error('MediaRecorder is not supported in this browser configuration');
      }

      mediaRecorderRef.current = mediaRecorder;

      // Set up continuous chunking logic
      const startContinuousChunking = () => {
        console.log('🔄 Starting continuous chunking every 3 seconds');
        
        const processChunk = async () => {
          if (!mediaRecorderRef.current || !streamRef.current || !isRecording) {
            console.log('⚠️ Recording stopped, ending chunk processing');
            return;
          }

          if (mediaRecorderRef.current.state === 'inactive') {
            console.log('📹 Starting new recording chunk');
            
            // Set up data handler for this chunk
            mediaRecorderRef.current.ondataavailable = async (event) => {
              console.log(`📦 Chunk data available, size: ${event.data.size} bytes`);
              
              if (event.data.size === 0) {
                console.warn('⚠️ Received empty chunk, skipping...');
                return;
              }

              if (!isProcessingRef.current) {
                isProcessingRef.current = true;
                const currentChunkNumber = chunkCount + 1;
                setChunkCount(currentChunkNumber);
                
                console.log(`🔄 Processing chunk #${currentChunkNumber}`);
                
                try {
                  await sendAudioToWebhook(event.data, currentChunkNumber);
                } catch (error) {
                  console.error(`❌ Failed to process chunk #${currentChunkNumber}:`, error);
                } finally {
                  isProcessingRef.current = false;
                }
              }
            };

            // Start recording for 3 seconds
            mediaRecorderRef.current.start();
            
            // Stop after 3 seconds and schedule next chunk
            setTimeout(() => {
              if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                console.log('⏹️ Stopping current chunk');
                mediaRecorderRef.current.stop();
                
                // Schedule next chunk if still recording
                if (isRecording && streamRef.current && streamRef.current.active) {
                  setTimeout(processChunk, 100); // Small delay to ensure clean state transition
                }
              }
            }, 3000);
          }
        };

        // Start the first chunk
        processChunk();
      };

      // Start continuous chunking
      startContinuousChunking();

      onStartRecording();
      
      toast({
        title: `${mode === 'microphone' ? 'Microphone' : 'System audio'} recording started`,
        description: "Real-time transcription every 3 seconds"
      });

    } catch (error) {
      console.error('❌ Error starting recording:', error);
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
    console.log('🛑 Stopping recording...');
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        console.log('⏹️ Stopping track:', track.kind);
        track.stop();
      });
    }
    
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close();
    }

    setShowSystemAudioInstructions(false);
    setChunkCount(0);
    onStopRecording();
    onAudioLevel(0);
    
    toast({
      title: "Recording stopped",
      description: `Processed ${chunkCount} chunks total`
    });
  };

  const sendAudioToWebhook = async (audioBlob: Blob, chunkNumber: number, retryCount = 0) => {
    if (!webhookUrl) {
      const simulatedText = `[${mode.toUpperCase()}] Chunk ${chunkNumber} - Simulated transcription at ${new Date().toLocaleTimeString()}`;
      onAudioChunk(simulatedText);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, `audio-chunk-${chunkNumber}.webm`);
      formData.append('source', mode);
      formData.append('chunkNumber', chunkNumber.toString());

      console.log(`📡 Sending chunk #${chunkNumber} to webhook:`, webhookUrl);
      console.log(`📊 Audio blob size: ${audioBlob.size} bytes`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      console.log(`📥 Webhook response for chunk #${chunkNumber}:`, response.status);

      if (response.ok) {
        const responseText = await response.text();
        console.log(`📄 Raw response for chunk #${chunkNumber}:`, responseText || '[EMPTY]');
        
        if (!responseText.trim()) {
          console.log(`⚠️ Empty response for chunk #${chunkNumber}, continuing...`);
          onAudioChunk(`[CHUNK ${chunkNumber}] Processing... (empty response)`);
          return;
        }
        
        try {
          const jsonResponse = JSON.parse(responseText);
          console.log(`✅ Parsed JSON for chunk #${chunkNumber}:`, JSON.stringify(jsonResponse, null, 2));
          
          let currentChunk = '';
          let fullTranscription = '';
          
          if (jsonResponse.currentChunk && typeof jsonResponse.currentChunk === 'string' && jsonResponse.currentChunk.trim()) {
            currentChunk = jsonResponse.currentChunk.trim();
            console.log(`✅ Found currentChunk #${chunkNumber}:`, currentChunk);
          }
          
          if (jsonResponse.fullTranscription && typeof jsonResponse.fullTranscription === 'string' && jsonResponse.fullTranscription.trim()) {
            fullTranscription = jsonResponse.fullTranscription.trim();
            console.log(`✅ Found fullTranscription #${chunkNumber}:`, fullTranscription);
          }
          
          if (currentChunk || fullTranscription) {
            console.log(`🔄 Processing transcription for chunk #${chunkNumber}`);
            
            if (currentChunk) {
              if (!accumulatedTranscriptionRef.current.includes(currentChunk)) {
                accumulatedTranscriptionRef.current += (accumulatedTranscriptionRef.current ? ' ' : '') + currentChunk;
              }
              
              const displayChunk = `[CHUNK ${chunkNumber}] ${currentChunk}`;
              onAudioChunk(displayChunk);
              
              onFullTranscription(accumulatedTranscriptionRef.current);
            }
            
            if (fullTranscription) {
              accumulatedTranscriptionRef.current = fullTranscription;
              onFullTranscription(fullTranscription);
            }
            
            toast({
              title: `Live transcription - Chunk ${chunkNumber}`,
              description: `${currentChunk ? currentChunk.substring(0, 50) : fullTranscription.substring(0, 50)}${(currentChunk || fullTranscription).length > 50 ? '...' : ''}`,
              duration: 2000
            });
            
          } else {
            console.log(`❌ No transcription text found in chunk #${chunkNumber}`);
            onAudioChunk(`[CHUNK ${chunkNumber}] No transcription text found`);
          }
        } catch (parseError) {
          console.log(`📝 Plain text response for chunk #${chunkNumber}:`, responseText);
          const plainText = responseText.trim();
          if (plainText) {
            console.log(`✅ Using plain text for chunk #${chunkNumber}`);
            
            accumulatedTranscriptionRef.current += (accumulatedTranscriptionRef.current ? ' ' : '') + plainText;
            
            onAudioChunk(`[CHUNK ${chunkNumber}] ${plainText}`);
            onFullTranscription(accumulatedTranscriptionRef.current);
            
            toast({
              title: `Live transcription - Chunk ${chunkNumber}`,
              description: plainText.substring(0, 50) + (plainText.length > 50 ? '...' : ''),
              duration: 2000
            });
          }
        }
      } else {
        const errorText = await response.text();
        console.error(`❌ Webhook error for chunk #${chunkNumber}:`, response.status, response.statusText, errorText);
        
        if (response.status >= 500 && retryCount < 2) {
          console.log(`🔄 Retrying chunk #${chunkNumber} (attempt ${retryCount + 1})`);
          setTimeout(() => sendAudioToWebhook(audioBlob, chunkNumber, retryCount + 1), 1000 * (retryCount + 1));
          return;
        }
        
        onAudioChunk(`[CHUNK ${chunkNumber} ERROR] Webhook returned ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error(`❌ Error sending chunk #${chunkNumber}:`, error);
      
      if (retryCount < 2) {
        console.log(`🔄 Retrying chunk #${chunkNumber} after network error (attempt ${retryCount + 1})`);
        setTimeout(() => sendAudioToWebhook(audioBlob, chunkNumber, retryCount + 1), 2000 * (retryCount + 1));
        return;
      }
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          onAudioChunk(`[CHUNK ${chunkNumber}] Request timeout - webhook took too long`);
        } else if (error.message.includes('Failed to fetch')) {
          onAudioChunk(`[CHUNK ${chunkNumber}] Network error - check webhook URL and CORS`);
        } else {
          onAudioChunk(`[CHUNK ${chunkNumber}] Connection error: ${error.message}`);
        }
      }
    }
  };

  const handleToggleRecording = () => {
    console.log('🎛️ Toggle recording button clicked, current state:', isRecording);
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
            <div className="space-y-1">
              <p className="text-xs text-green-400 animate-pulse">● Live transcription active</p>
              <p className="text-xs text-slate-500">Processed {chunkCount} chunks</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AudioRecorder;

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Monitor, MonitorOff } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

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
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIntervalRef = useRef<NodeJS.Timeout>();

  const startRecording = async () => {
    try {
      let stream: MediaStream;
      
      if (mode === 'microphone') {
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 16000
          } 
        });
      } else {
        // System audio capture via screen sharing
        stream = await navigator.mediaDevices.getDisplayMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 16000
          },
          video: false
        });
      }

      streamRef.current = stream;
      setHasPermission(true);

      // Set up audio analysis for level visualization
      audioContextRef.current = new AudioContext();
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

      // Set up MediaRecorder for chunked recording
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      const audioChunks: Blob[] = [];
      
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        if (audioChunks.length > 0) {
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          await sendAudioToWebhook(audioBlob);
        }
      };

      mediaRecorderRef.current.start();
      
      // Send chunks every 3 seconds
      chunkIntervalRef.current = setInterval(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.start();
        }
      }, 3000);

      onStartRecording();
      
      toast({
        title: `${mode === 'microphone' ? 'Microphone' : 'System audio'} recording started`,
        description: "Audio is being processed in real-time"
      });

    } catch (error) {
      console.error('Error starting recording:', error);
      toast({
        title: "Recording failed",
        description: `Unable to access ${mode === 'microphone' ? 'microphone' : 'system audio'}. Please check permissions.`,
        variant: "destructive"
      });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    
    if (chunkIntervalRef.current) {
      clearInterval(chunkIntervalRef.current);
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }

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
        {mode === 'system' && (
          <p className="text-xs text-slate-500">Requires screen sharing permission</p>
        )}
      </div>
    </div>
  );
};

export default AudioRecorder;

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Monitor, MonitorOff } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface AudioRecorderProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onAudioChunk: (text: string) => void;
  onAudioLevel: (level: number) => void;
  webhookUrl: string;
  mode: 'microphone' | 'system';
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({
  isRecording,
  onStartRecording,
  onStopRecording,
  onAudioChunk,
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
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

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
        
        // Skip empty responses
        if (!responseText.trim()) {
          console.log('Empty response from webhook, skipping');
          return;
        }
        
        // Try to parse as JSON first
        try {
          const jsonResponse = JSON.parse(responseText);
          console.log('Parsed JSON response:', JSON.stringify(jsonResponse, null, 2));
          
          // Skip generic status messages that don't contain transcription
          const genericMessages = [
            'workflow was started',
            'request received', 
            'processing',
            'accepted',
            'success',
            'ok'
          ];
          
          if (jsonResponse.message && 
              genericMessages.some(msg => 
                jsonResponse.message.toLowerCase().includes(msg.toLowerCase())
              )) {
            console.log('Skipping generic status message:', jsonResponse.message);
            return;
          }
          
          // Look for transcription text in various possible JSON fields
          let transcriptionText = '';
          
          // Check common transcription field names
          const transcriptionFields = [
            'transcription',
            'transcript', 
            'text',
            'result',
            'output',
            'content',
            'data',
            'response'
          ];
          
          for (const field of transcriptionFields) {
            if (jsonResponse[field] && typeof jsonResponse[field] === 'string') {
              transcriptionText = jsonResponse[field];
              console.log(`Found transcription in field '${field}':`, transcriptionText);
              break;
            }
          }
          
          // If no transcription found in dedicated fields, check message field
          if (!transcriptionText && jsonResponse.message && 
              !genericMessages.some(msg => 
                jsonResponse.message.toLowerCase().includes(msg.toLowerCase())
              )) {
            transcriptionText = jsonResponse.message;
            console.log('Using message field as transcription:', transcriptionText);
          }
          
          // Check for nested objects
          if (!transcriptionText && jsonResponse.data && typeof jsonResponse.data === 'object') {
            for (const field of transcriptionFields) {
              if (jsonResponse.data[field] && typeof jsonResponse.data[field] === 'string') {
                transcriptionText = jsonResponse.data[field];
                console.log(`Found transcription in nested data.${field}:`, transcriptionText);
                break;
              }
            }
          }
          
          if (transcriptionText && transcriptionText.trim() && transcriptionText.length > 2) {
            console.log('✅ Extracted transcription text:', transcriptionText);
            onAudioChunk(transcriptionText);
          } else {
            console.log('❌ No meaningful transcription found in JSON response');
            console.log('Available fields:', Object.keys(jsonResponse));
            onAudioChunk(`[DEBUG] Webhook returned JSON but no transcription text found. Available fields: ${Object.keys(jsonResponse).join(', ')}`);
          }
        } catch (parseError) {
          // If not JSON, treat as plain text
          console.log('Response is not JSON, treating as plain text:', responseText);
          if (responseText.trim() && responseText.length > 2) {
            console.log('✅ Using plain text response as transcription');
            onAudioChunk(responseText);
          } else {
            console.log('❌ Plain text response too short or empty');
            onAudioChunk(`[DEBUG] Webhook returned plain text: "${responseText}"`);
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

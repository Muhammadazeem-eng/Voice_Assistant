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

      // Set up MediaRecorder for real-time chunking
      mediaRecorderRef.current = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus'
      });

      mediaRecorderRef.current.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          console.log(`📦 Audio chunk ready: ${event.data.size} bytes`);
          await sendAudioToWebhook(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        console.log('MediaRecorder stopped');
      };

      // Start recording with 2.5-second chunks
      mediaRecorderRef.current.start(2500); // 2.5 seconds per chunk
      console.log('🎤 Started recording with 2.5-second chunks');

      onStartRecording();
      
      toast({
        title: `${mode === 'microphone' ? 'Microphone' : 'System audio'} recording started`,
        description: "Audio is being processed in real-time chunks"
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
      onAudioChunk(`[${mode.toUpperCase()}] Simulated chunk at ${new Date().toLocaleTimeString()}`);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'audio.webm');
      formData.append('source', mode);

      console.log('🚀 Sending audio chunk to webhook:', webhookUrl);
      console.log('📊 Chunk size:', audioBlob.size, 'bytes');
      
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

      console.log('📡 Webhook response status:', response.status);

      if (response.ok) {
        const responseText = await response.text();
        console.log('📝 Raw webhook response:', responseText);
        
        if (!responseText.trim()) {
          console.log('⚠️ Empty response from webhook');
          return;
        }
        
        try {
          const data = JSON.parse(responseText);
          console.log('✅ Parsed webhook response:', data);
          
          // Extract transcription data
          const currentChunk = data.currentChunk?.trim() || '';
          const fullTranscription = data.fullTranscription?.trim() || '';
          
          if (currentChunk || fullTranscription) {
            console.log('🎯 Processing transcription data');
            
            // Show success toast
            toast({
              title: "Chunk processed",
              description: `Received ${currentChunk ? currentChunk.length : fullTranscription.length} characters`,
              duration: 1500
            });
            
            // Send currentChunk if available (for individual chunks)
            if (currentChunk) {
              console.log('📤 Sending currentChunk to display:', currentChunk);
              onAudioChunk(currentChunk);
            }
            
            // Send fullTranscription if available (for complete text)
            if (fullTranscription) {
              console.log('📤 Sending fullTranscription to display:', fullTranscription);
              onFullTranscription(fullTranscription);
            }
          } else {
            console.log('❌ No transcription text found');
            onAudioChunk(`[DEBUG] No transcription in response: ${Object.keys(data).join(', ')}`);
          }
        } catch (parseError) {
          // Handle plain text response
          const plainText = responseText.trim();
          if (plainText) {
            console.log('📝 Using plain text response:', plainText);
            onAudioChunk(plainText);
            onFullTranscription(plainText);
            
            toast({
              title: "Chunk processed",
              description: `Received ${plainText.length} characters`,
              duration: 1500
            });
          } else {
            console.log('❌ Empty plain text response');
          }
        }
      } else {
        const errorText = await response.text();
        console.error('❌ Webhook error:', response.status, response.statusText, errorText);
        
        // Retry on server errors (5xx) up to 2 times
        if (response.status >= 500 && retryCount < 2) {
          console.log(`🔄 Retrying due to server error (attempt ${retryCount + 1})`);
          setTimeout(() => sendAudioToWebhook(audioBlob, retryCount + 1), 1000 * (retryCount + 1));
          return;
        }
        
        onAudioChunk(`[ERROR] Webhook ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('❌ Error sending chunk to webhook:', error);
      
      // Retry on network errors up to 2 times
      if (retryCount < 2) {
        console.log(`🔄 Retrying after network error (attempt ${retryCount + 1})`);
        setTimeout(() => sendAudioToWebhook(audioBlob, retryCount + 1), 2000 * (retryCount + 1));
        return;
      }
      
      // Show error after all retries failed
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          onAudioChunk(`[${mode.toUpperCase()}] Chunk timeout (>15s)`);
        } else if (error.message.includes('Failed to fetch')) {
          onAudioChunk(`[${mode.toUpperCase()}] Network error - check webhook URL`);
        } else {
          onAudioChunk(`[${mode.toUpperCase()}] Error: ${error.message}`);
        }
      } else {
        onAudioChunk(`[${mode.toUpperCase()}] Unknown error`);
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
        {isRecording && (
          <p className="text-xs text-green-400">Sending 2.5s chunks</p>
        )}
      </div>
    </div>
  );
};

export default AudioRecorder;

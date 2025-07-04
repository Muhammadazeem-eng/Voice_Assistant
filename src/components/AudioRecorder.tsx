
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
  const chunkingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Function to get supported audio format
  const getSupportedMimeType = () => {
    const types = [
      'audio/wav',
      'audio/mpeg',
      'audio/mp4',
      'audio/webm',
      'audio/ogg'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log(`✅ Using supported audio format: ${type}`);
        return type;
      }
    }
    
    console.log('⚠️ No preferred format supported, using default');
    return '';
  };

  // Function to convert audio blob to WAV format
  const convertToWav = async (audioBlob: Blob): Promise<Blob> => {
    try {
      // If it's already WAV, return as is
      if (audioBlob.type.includes('wav')) {
        return audioBlob;
      }

      // Create audio context for conversion
      const audioContext = new AudioContext();
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Convert to WAV
      const wavBuffer = audioBufferToWav(audioBuffer);
      return new Blob([wavBuffer], { type: 'audio/wav' });
    } catch (error) {
      console.log('⚠️ Audio conversion failed, using original format:', error);
      return audioBlob;
    }
  };

  // Helper function to convert AudioBuffer to WAV
  const audioBufferToWav = (buffer: AudioBuffer): ArrayBuffer => {
    const length = buffer.length;
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bytesPerSample = 2;
    const blockAlign = numberOfChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    
    const arrayBuffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(arrayBuffer);
    
    // WAV header
    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Convert audio data
    let offset = 44;
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        const sample = Math.max(-1, Math.min(1, channelData[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
        offset += 2;
      }
    }
    
    return arrayBuffer;
  };

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

      // Start continuous chunking
      startContinuousChunking(stream);

      onStartRecording();
      
      toast({
        title: `${mode === 'microphone' ? 'Microphone' : 'System audio'} recording started`,
        description: "Audio is being processed in 2.5-second chunks"
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

  const startContinuousChunking = (stream: MediaStream) => {
    const mimeType = getSupportedMimeType();
    
    const createChunk = () => {
      if (!isRecording || !streamRef.current) {
        return;
      }

      // Create new MediaRecorder for this chunk
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined
      });

      const audioChunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (audioChunks.length > 0) {
          const audioBlob = new Blob(audioChunks, { type: mimeType });
          console.log(`📦 Audio chunk ready: ${audioBlob.size} bytes (${mimeType})`);
          
          // Convert to WAV if needed
          const finalBlob = await convertToWav(audioBlob);
          await sendAudioToWebhook(finalBlob);
        }
        
        // Start next chunk if still recording
        if (isRecording && streamRef.current) {
          setTimeout(createChunk, 100); // Small delay to prevent overlap
        }
      };

      // Record for 2.5 seconds
      mediaRecorder.start();
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      }, 2500);
    };

    // Start first chunk
    createChunk();
  };

  const stopRecording = () => {
    if (chunkingIntervalRef.current) {
      clearInterval(chunkingIntervalRef.current);
      chunkingIntervalRef.current = null;
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
      onAudioChunk(`[${mode.toUpperCase()}] Simulated chunk at ${new Date().toLocaleTimeString()}`);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, `audio.${audioBlob.type.includes('wav') ? 'wav' : 'webm'}`);
      formData.append('source', mode);

      console.log('🚀 Sending audio chunk to webhook:', webhookUrl);
      console.log('📊 Chunk size:', audioBlob.size, 'bytes');
      console.log('🎵 Audio format:', audioBlob.type);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(webhookUrl, {
        method: 'POST',
        body: formData,
        signal: controller.signal
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
          
          const currentChunk = data.currentChunk?.trim() || '';
          const fullTranscription = data.fullTranscription?.trim() || '';
          
          if (currentChunk || fullTranscription) {
            console.log('🎯 Processing transcription data');
            
            toast({
              title: "Chunk processed",
              description: `Received transcription (${data.chunkCount || 'N/A'})`,
              duration: 1500
            });
            
            if (currentChunk) {
              console.log('📤 Sending currentChunk to display:', currentChunk);
              onAudioChunk(currentChunk);
            }
            
            if (fullTranscription) {
              console.log('📤 Sending fullTranscription to display:', fullTranscription);
              onFullTranscription(fullTranscription);
            }
          } else {
            console.log('❌ No transcription text found');
            onAudioChunk(`[DEBUG] No transcription in response: ${Object.keys(data).join(', ')}`);
          }
        } catch (parseError) {
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
        
        if (response.status >= 500 && retryCount < 2) {
          console.log(`🔄 Retrying due to server error (attempt ${retryCount + 1})`);
          setTimeout(() => sendAudioToWebhook(audioBlob, retryCount + 1), 1000 * (retryCount + 1));
          return;
        }
        
        onAudioChunk(`[ERROR] Webhook ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('❌ Error sending chunk to webhook:', error);
      
      if (retryCount < 2) {
        console.log(`🔄 Retrying after network error (attempt ${retryCount + 1})`);
        setTimeout(() => sendAudioToWebhook(audioBlob, retryCount + 1), 2000 * (retryCount + 1));
        return;
      }
      
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
          <p className="text-xs text-green-400">Continuous 2.5s chunks</p>
        )}
      </div>
    </div>
  );
};

export default AudioRecorder;

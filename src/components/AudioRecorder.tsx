
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
  const isChunkingRef = useRef<boolean>(false);

  // Function to get supported audio format - prefer webm for recording
  const getSupportedMimeType = () => {
    const types = [
      'audio/webm',
      'audio/mp4',
      'audio/mpeg'
    ];
    
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log(`✅ Using supported audio format for recording: ${type}`);
        return type;
      }
    }
    
    console.log('⚠️ No preferred format supported, using default');
    return '';
  };

  // Function to convert any audio blob to WAV format for OpenAI
  const convertToWav = async (audioBlob: Blob): Promise<Blob> => {
    try {
      console.log(`🔄 Converting ${audioBlob.type} (${audioBlob.size} bytes) to WAV for OpenAI`);
      
      // Create audio context for conversion
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000 // OpenAI prefers 16kHz
      });
      
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      
      // Convert to WAV
      const wavBuffer = audioBufferToWav(audioBuffer);
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
      
      console.log(`✅ Converted to WAV: ${wavBlob.size} bytes`);
      await audioContext.close();
      
      return wavBlob;
    } catch (error) {
      console.error('❌ Audio conversion failed:', error);
      // Return original if conversion fails
      return audioBlob;
    }
  };

  // Helper function to convert AudioBuffer to WAV with proper 16-bit PCM format
  const audioBufferToWav = (buffer: AudioBuffer): ArrayBuffer => {
    const length = buffer.length;
    const numberOfChannels = 1; // Force mono for OpenAI
    const sampleRate = buffer.sampleRate;
    const bytesPerSample = 2; // 16-bit
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
    
    // RIFF header
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, 'WAVE');
    
    // fmt chunk
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // PCM format
    view.setUint16(20, 1, true);  // PCM
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // 16-bit
    
    // data chunk
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Convert audio data to mono 16-bit PCM
    const channelData = buffer.getChannelData(0); // Use first channel only
    let offset = 44;
    
    for (let i = 0; i < length; i++) {
      const sample = Math.max(-1, Math.min(1, channelData[i]));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
    
    return arrayBuffer;
  };

  const startRecording = async () => {
    try {
      console.log(`🎙️ Starting ${mode} recording...`);
      
      // Call onStartRecording FIRST to set the recording state
      onStartRecording();
      
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
      console.log(`✅ ${mode} stream acquired successfully`);

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

      // Start continuous chunking with a small delay to ensure recording state is set
      console.log('🔄 Starting continuous chunking...');
      setTimeout(() => {
        startContinuousChunking(stream);
      }, 100);
      
      toast({
        title: `${mode === 'microphone' ? 'Microphone' : 'System audio'} recording started`,
        description: "Audio is being processed in 2.5-second chunks"
      });

    } catch (error) {
      console.error('❌ Error starting recording:', error);
      // Reset recording state if there's an error
      onStopRecording();
      toast({
        title: "Recording failed",
        description: `Unable to access ${mode === 'microphone' ? 'microphone' : 'system audio'}. Please check permissions.`,
        variant: "destructive"
      });
    }
  };

  const startContinuousChunking = (stream: MediaStream) => {
    const mimeType = getSupportedMimeType();
    console.log(`📦 Starting chunking with MIME type: ${mimeType}`);
    console.log(`🎯 Recording state when chunking starts: ${isRecording}`);
    isChunkingRef.current = true;
    
    const createChunk = () => {
      console.log(`🎯 Creating new chunk... Recording: ${isRecording}, Chunking: ${isChunkingRef.current}`);
      
      if (!isRecording || !streamRef.current || !isChunkingRef.current) {
        console.log('⏹️ Stopping chunking - conditions not met');
        console.log(`   - isRecording: ${isRecording}`);
        console.log(`   - streamRef.current: ${!!streamRef.current}`);
        console.log(`   - isChunkingRef.current: ${isChunkingRef.current}`);
        return;
      }

      // Create new MediaRecorder for this chunk
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: mimeType || undefined
      });

      const audioChunks: Blob[] = [];
      console.log('🎙️ MediaRecorder created, starting recording...');

      mediaRecorder.ondataavailable = (event) => {
        console.log(`📊 Data available: ${event.data.size} bytes, type: ${event.data.type}`);
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log(`⏹️ MediaRecorder stopped. Chunks: ${audioChunks.length}`);
        if (audioChunks.length > 0) {
          const audioBlob = new Blob(audioChunks, { type: mimeType });
          console.log(`📦 Raw audio chunk: ${audioBlob.size} bytes (${mimeType})`);
          
          // ALWAYS convert to WAV for OpenAI compatibility
          console.log('🔄 Converting to WAV format...');
          const wavBlob = await convertToWav(audioBlob);
          console.log(`🎯 Sending WAV chunk: ${wavBlob.size} bytes`);
          
          await sendAudioToWebhook(wavBlob);
        } else {
          console.log('⚠️ No audio chunks to process');
        }
        
        // Start next chunk if still recording
        if (isRecording && streamRef.current && isChunkingRef.current) {
          console.log('🔄 Scheduling next chunk in 100ms...');
          setTimeout(createChunk, 100); // Small delay to prevent overlap
        } else {
          console.log('🛑 Not scheduling next chunk - recording stopped or chunking disabled');
          console.log(`   - isRecording: ${isRecording}`);
          console.log(`   - streamRef.current: ${!!streamRef.current}`);
          console.log(`   - isChunkingRef.current: ${isChunkingRef.current}`);
        }
      };

      mediaRecorder.onerror = (event) => {
        console.error('❌ MediaRecorder error:', event);
      };

      mediaRecorder.onstart = () => {
        console.log('▶️ MediaRecorder started recording');
      };

      // Record for 2.5 seconds
      console.log('🚀 Starting MediaRecorder...');
      mediaRecorder.start();
      console.log('⏰ MediaRecorder started, will stop in 2500ms');
      
      setTimeout(() => {
        console.log(`⏸️ Attempting to stop MediaRecorder. Current state: ${mediaRecorder.state}`);
        if (mediaRecorder.state === 'recording') {
          console.log('⏸️ Stopping MediaRecorder after 2.5 seconds');
          mediaRecorder.stop();
        } else {
          console.log(`⚠️ MediaRecorder not in recording state: ${mediaRecorder.state}`);
        }
      }, 2500);
    };

    // Start first chunk
    console.log('🚀 Starting first chunk');
    createChunk();
  };

  const stopRecording = () => {
    console.log('🛑 Stopping recording...');
    isChunkingRef.current = false;
    
    if (chunkingIntervalRef.current) {
      clearInterval(chunkingIntervalRef.current);
      chunkingIntervalRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        console.log(`🔇 Stopping track: ${track.kind}`);
        track.stop();
      });
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
    console.log(`🚀 sendAudioToWebhook called - Webhook URL: ${webhookUrl ? 'Set' : 'Not set'}`);
    console.log(`📊 Audio blob size: ${audioBlob.size} bytes, type: ${audioBlob.type}`);
    
    if (!webhookUrl) {
      console.log('⚠️ No webhook URL provided, using simulated response');
      onAudioChunk(`[${mode.toUpperCase()}] Simulated chunk at ${new Date().toLocaleTimeString()}`);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, `audio.${audioBlob.type.includes('wav') ? 'wav' : 'webm'}`);
      formData.append('source', mode);

      console.log('🌐 Sending audio chunk to webhook:', webhookUrl);
      console.log('📊 Chunk size:', audioBlob.size, 'bytes');
      console.log('🎵 Audio format:', audioBlob.type);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        console.log('⏰ Request timeout after 15 seconds');
        controller.abort();
      }, 15000);

      console.log('📡 Making fetch request...');
      const response = await fetch(webhookUrl, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      console.log('📡 Webhook response status:', response.status);
      console.log('📡 Webhook response headers:', Object.fromEntries(response.headers.entries()));

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
          console.log('⚠️ JSON parse failed, trying plain text response');
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

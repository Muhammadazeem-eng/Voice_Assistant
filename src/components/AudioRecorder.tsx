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

  const sendAudioToWebhook = async (audioBlob: Blob) => {
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
      const response = await fetch(webhookUrl, {
        method: 'POST',
        body: formData
      });

      if (response.ok) {
        const responseText = await response.text();
        console.log('Webhook response:', responseText);
        
        // Try to parse as JSON first
        try {
          const jsonResponse = JSON.parse(responseText);
          console.log('Parsed JSON response:', jsonResponse);
          
          // Extract transcription text from various possible JSON structures
          let transcriptionText = '';
          
          if (jsonResponse.transcription) {
            transcriptionText = jsonResponse.transcription;
          } else if (jsonResponse.text) {
            transcriptionText = jsonResponse.text;
          } else if (jsonResponse.result) {
            transcriptionText = jsonResponse.result;
          } else if (jsonResponse.message && jsonResponse.message !== "Workflow was started") {
            transcriptionText = jsonResponse.message;
          }
          
          if (transcriptionText && transcriptionText.trim()) {
            console.log('Extracted transcription:', transcriptionText);
            onAudioChunk(transcriptionText);
          } else {
            console.log('No transcription found in JSON response, using raw response');
            onAudioChunk(responseText);
          }
        } catch (parseError) {
          // If not JSON, treat as plain text
          console.log('Response is not JSON, treating as plain text:', responseText);
          if (responseText.trim()) {
            onAudioChunk(responseText);
          }
        }
      } else {
        console.error('Webhook error:', response.status, response.statusText);
        onAudioChunk(`[ERROR] Webhook returned ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error sending audio to webhook:', error);
      // Fallback to simulated transcription
      onAudioChunk(`[${mode.toUpperCase()}] Connection error - simulated transcription at ${new Date().toLocaleTimeString()}`);
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

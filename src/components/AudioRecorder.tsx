
import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Monitor, MonitorOff, Info } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface AudioRecorderProps {
  isRecording: boolean;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onFullTranscription: (text: string) => void;
  onAudioLevel: (level: number) => void;
  webhookUrl: string;
  mode: 'microphone' | 'system';
}

const AudioRecorder: React.FC<AudioRecorderProps> = ({
  isRecording,
  onStartRecording,
  onStopRecording,
  onFullTranscription,
  onAudioLevel,
  webhookUrl,
  mode
}) => {
  const [hasPermission, setHasPermission] = useState(false);
  const [showSystemAudioInfo, setShowSystemAudioInfo] = useState(false);
  const [isVoiceDetected, setIsVoiceDetected] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunkIntervalRef = useRef<NodeJS.Timeout>();
  const voiceActivityRef = useRef<boolean>(false);
  const silenceTimeoutRef = useRef<NodeJS.Timeout>();

  // Voice activity detection parameters
  const VOICE_THRESHOLD = 0.01; // Minimum amplitude for voice detection
  const SILENCE_DURATION = 2000; // 2 seconds of silence before stopping
  const MIN_VOICE_DURATION = 500; // Minimum voice duration to consider valid

  const detectVoiceActivity = (audioData: Float32Array): boolean => {
    // Calculate RMS (Root Mean Square) for voice activity detection
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i] * audioData[i];
    }
    const rms = Math.sqrt(sum / audioData.length);
    
    // Check if RMS exceeds voice threshold
    return rms > VOICE_THRESHOLD;
  };

  const startRecording = async () => {
    try {
      let stream: MediaStream;
      
      if (mode === 'microphone') {
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: 16000,
            channelCount: 1
          } 
        });
      } else {
        // System audio requires screen sharing with audio
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({ 
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              sampleRate: 16000,
              channelCount: 2
            },
            video: true // Required for getDisplayMedia
          });

          // Check if audio track is available
          const audioTracks = stream.getAudioTracks();
          if (audioTracks.length === 0) {
            // Stop video track since we only need audio
            stream.getVideoTracks().forEach(track => track.stop());
            
            toast({
              title: "No audio detected",
              description: "Make sure to check 'Share audio' when sharing your screen. Try again and select a tab/application with audio.",
              variant: "destructive"
            });
            return;
          }

          // Stop video track since we only need audio for transcription
          stream.getVideoTracks().forEach(track => track.stop());
          
          toast({
            title: "System audio connected",
            description: "Successfully capturing system audio for transcription",
          });

        } catch (screenError) {
          console.error('Screen sharing error:', screenError);
          
          if (screenError.name === 'NotAllowedError') {
            toast({
              title: "Screen sharing cancelled",
              description: "System audio capture requires screen sharing permission. Click the info icon for instructions.",
              variant: "destructive"
            });
          } else {
            toast({
              title: "System audio unavailable",
              description: "Unable to access system audio. Click the info icon for setup instructions.",
              variant: "destructive"
            });
          }
          return;
        }
      }

      streamRef.current = stream;
      setHasPermission(true);

      // Set up audio analysis for level visualization and voice detection
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      source.connect(analyserRef.current);
      
      analyserRef.current.fftSize = 2048;
      analyserRef.current.smoothingTimeConstant = 0.8;
      const bufferLength = analyserRef.current.fftSize;
      const dataArray = new Float32Array(bufferLength);
      const frequencyData = new Uint8Array(analyserRef.current.frequencyBinCount);

      const updateAudioLevel = () => {
        if (analyserRef.current && isRecording) {
          // Get time domain data for voice activity detection
          analyserRef.current.getFloatTimeDomainData(dataArray);
          
          // Get frequency data for level visualization
          analyserRef.current.getByteFrequencyData(frequencyData);
          const average = frequencyData.reduce((a, b) => a + b) / frequencyData.length;
          onAudioLevel((average / 255) * 100);

          // Voice activity detection
          const hasVoice = detectVoiceActivity(dataArray);
          
          if (hasVoice) {
            if (!voiceActivityRef.current) {
              console.log('🎤 Voice detected, starting transcription');
              voiceActivityRef.current = true;
              setIsVoiceDetected(true);
            }
            
            // Clear silence timeout when voice is detected
            if (silenceTimeoutRef.current) {
              clearTimeout(silenceTimeoutRef.current);
              silenceTimeoutRef.current = undefined;
            }
          } else {
            // Start silence timer if voice was previously detected
            if (voiceActivityRef.current && !silenceTimeoutRef.current) {
              silenceTimeoutRef.current = setTimeout(() => {
                console.log('🔇 Silence detected, pausing transcription');
                voiceActivityRef.current = false;
                setIsVoiceDetected(false);
                silenceTimeoutRef.current = undefined;
              }, SILENCE_DURATION);
            }
          }
          
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
        if (event.data.size > 0 && voiceActivityRef.current) {
          // Only process chunks when voice activity is detected
          audioChunks.push(event.data);
          console.log('📊 Audio chunk captured with voice activity');
        }
      };

      mediaRecorderRef.current.onstop = async () => {
        if (audioChunks.length > 0) {
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          await sendAudioToWebhook(audioBlob);
        }
      };

      onStartRecording();
      mediaRecorderRef.current.start();
      
      // Send chunks every 3 seconds, but only process if voice is detected
      chunkIntervalRef.current = setInterval(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
          mediaRecorderRef.current.start();
        }
      }, 3000);
      
      toast({
        title: `${mode === 'microphone' ? 'Microphone' : 'System audio'} recording started`,
        description: "Listening for voice activity..."
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

    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }

    voiceActivityRef.current = false;
    setIsVoiceDetected(false);
    onStopRecording();
    onAudioLevel(0);
    
    toast({
      title: "Recording stopped",
      description: "Audio processing has been stopped"
    });
  };

  const sendAudioToWebhook = async (audioBlob: Blob, retryCount = 0) => {
    if (!webhookUrl) {
      onFullTranscription(`[${mode.toUpperCase()}] Simulated transcription at ${new Date().toLocaleTimeString()}`);
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
          
          if (jsonResponse.fullTranscription && typeof jsonResponse.fullTranscription === 'string' && jsonResponse.fullTranscription.trim()) {
            const fullTranscription = jsonResponse.fullTranscription.trim();
            console.log('✅ Found fullTranscription:', fullTranscription);
            
            // Only update transcription if it contains meaningful content
            if (fullTranscription.length > 10) { // Filter out very short responses
              toast({
                title: "Transcription updated",
                description: `Processed ${fullTranscription.length} characters`,
                duration: 2000
              });
              
              onFullTranscription(fullTranscription);
            }
          } else {
            console.log('❌ No fullTranscription found in response');
          }
        } catch (parseError) {
          // If not JSON, treat as plain text
          console.log('Response is not JSON, treating as plain text:', responseText);
          const plainText = responseText.trim();
          if (plainText && plainText.length > 10) {
            console.log('✅ Using plain text response as transcription');
            
            toast({
              title: "Transcription updated",
              description: `Processed ${plainText.length} characters`,
              duration: 2000
            });
            
            onFullTranscription(plainText);
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
      }
    } catch (error) {
      console.error('Error sending audio to webhook:', error);
      
      // Retry on network errors up to 2 times
      if (retryCount < 2) {
        console.log(`Retrying after network error (attempt ${retryCount + 1})`);
        setTimeout(() => sendAudioToWebhook(audioBlob, retryCount + 1), 2000 * (retryCount + 1));
        return;
      }
    }
  };

  const handleToggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      if (mode === 'system' && !isRecording) {
        setShowSystemAudioInfo(true);
        setTimeout(() => setShowSystemAudioInfo(false), 5000);
      }
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
      
      {/* Voice activity indicator */}
      {isRecording && mode === 'microphone' && (
        <div className="flex items-center gap-2 text-xs">
          <div className={`w-2 h-2 rounded-full ${isVoiceDetected ? 'bg-green-500 animate-pulse' : 'bg-slate-500'}`}></div>
          <span className="text-slate-400">
            {isVoiceDetected ? 'Voice detected' : 'Waiting for voice...'}
          </span>
        </div>
      )}
      
      <div className="text-center">
        <div className="flex items-center justify-center gap-2">
          <p className="text-sm text-slate-400">{label}</p>
          {mode === 'system' && (
            <Info 
              className="w-4 h-4 text-slate-500 cursor-help" 
              onClick={() => setShowSystemAudioInfo(!showSystemAudioInfo)}
            />
          )}
        </div>
        
        {mode === 'system' && showSystemAudioInfo && (
          <div className="mt-2 p-3 bg-slate-800 rounded-lg border border-slate-600">
            <p className="text-xs text-slate-300 mb-2 font-medium">To capture system audio:</p>
            <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside text-left">
              <li>Click "Share screen" when prompted</li>
              <li>Check "Share audio" checkbox</li>
              <li>Choose the tab/app with audio</li>
              <li>Click "Share" to start capture</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
};

export default AudioRecorder;

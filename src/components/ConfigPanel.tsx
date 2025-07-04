
import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings, Eye, EyeOff } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface ConfigPanelProps {
  config: {
    openaiApiKey: string;
    webhookUrl: string;
  };
  onConfigUpdate: (key: string, value: string) => void;
}

const ConfigPanel: React.FC<ConfigPanelProps> = ({ config, onConfigUpdate }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <Card className="bg-slate-900/50 border-slate-700 mb-6">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <div className="p-4 cursor-pointer hover:bg-slate-800/30 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-slate-400" />
                <h3 className="text-lg font-semibold text-slate-50">Configuration</h3>
              </div>
              <Button variant="ghost" size="sm" className="text-slate-400">
                {isOpen ? 'Hide' : 'Show'} Settings
              </Button>
            </div>
          </div>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="px-4 pb-4 border-t border-slate-700">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="apiKey" className="text-slate-300">
                  OpenAI API Key
                </Label>
                <div className="relative">
                  <Input
                    id="apiKey"
                    type={showApiKey ? "text" : "password"}
                    placeholder="sk-..."
                    value={config.openaiApiKey}
                    onChange={(e) => onConfigUpdate('openaiApiKey', e.target.value)}
                    className="bg-slate-800 border-slate-600 text-slate-50 pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-full px-3 text-slate-400 hover:text-slate-200"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
                <p className="text-xs text-slate-400">
                  Required for AI chat functionality
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="webhookUrl" className="text-slate-300">
                  Webhook URL
                </Label>
                <Input
                  id="webhookUrl"
                  type="url"
                  placeholder="https://your-webhook-endpoint.com/transcribe"
                  value={config.webhookUrl}
                  onChange={(e) => onConfigUpdate('webhookUrl', e.target.value)}
                  className="bg-slate-800 border-slate-600 text-slate-50"
                />
                <p className="text-xs text-slate-400">
                  Endpoint for audio transcription processing
                </p>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export default ConfigPanel;

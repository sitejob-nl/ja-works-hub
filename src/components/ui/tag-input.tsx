import { useState, KeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

const TagInput = ({ value, onChange, placeholder = 'Typ en druk Enter...' }: TagInputProps) => {
  const [input, setInput] = useState('');

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      if (!value.includes(input.trim())) {
        onChange([...value, input.trim()]);
      }
      setInput('');
    }
    if (e.key === 'Backspace' && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5 p-2 border rounded-md bg-background min-h-[38px]">
      {value.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1 text-xs">
          {tag}
          <X className="h-3 w-3 cursor-pointer" onClick={() => onChange(value.filter((t) => t !== tag))} />
        </Badge>
      ))}
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={value.length === 0 ? placeholder : ''}
        className="border-0 p-0 h-6 min-w-[120px] flex-1 shadow-none focus-visible:ring-0"
      />
    </div>
  );
};

export default TagInput;

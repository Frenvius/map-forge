import React from 'react';
import { Search } from 'lucide-react';

interface PaletteSearchProps {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  children?: React.ReactNode;
}

const PaletteSearch = ({ value, placeholder, onChange, children }: PaletteSearchProps) => (
  <div className="flex items-center gap-1.5 rounded border border-input bg-input px-2">
    <Search className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="h-7 w-full bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
    />
    {children}
  </div>
);

export default PaletteSearch;

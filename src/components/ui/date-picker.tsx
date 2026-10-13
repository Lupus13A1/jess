import * as React from "react";
import dayjs from "dayjs";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface DatePickerProps {
  value?: string | null; // ISO 'YYYY-MM-DD'
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  minYear?: number;
  maxYear?: number;
  className?: string;
  formatDisplay?: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export function DatePicker({
  value,
  onChange,
  placeholder = "Select date",
  disabled = false,
  minYear = 1930,
  maxYear = new Date().getFullYear() + 5,
  className,
  formatDisplay = "D MMMM YYYY",
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  // Parse ISO string (YYYY-MM-DD) avoiding timezone shift
  const selectedDate = React.useMemo(() => {
    if (!value) return undefined;
    const d = dayjs(value);
    return d.isValid() ? d.toDate() : undefined;
  }, [value]);

  const [month, setMonth] = React.useState<Date>(() => selectedDate || new Date());

  // Sync displayed month when value changes
  React.useEffect(() => {
    if (selectedDate) {
      setMonth(selectedDate);
    }
  }, [selectedDate]);

  // Year list descending
  const years = React.useMemo(() => {
    const list: number[] = [];
    for (let y = maxYear; y >= minYear; y--) {
      list.push(y);
    }
    return list;
  }, [minYear, maxYear]);

  const handleSelect = (d?: Date) => {
    if (!d) return;
    const iso = dayjs(d).format("YYYY-MM-DD");
    onChange?.(iso);
    setOpen(false);
  };

  const handleClear = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    onChange?.("");
  };

  const handleToday = (e: React.MouseEvent) => {
    e.stopPropagation();
    const today = new Date();
    setMonth(today);
    onChange?.(dayjs(today).format("YYYY-MM-DD"));
    setOpen(false);
  };

  const formattedDisplay = React.useMemo(() => {
    if (!value) return "";
    const d = dayjs(value);
    return d.isValid() ? d.format(formatDisplay) : value;
  }, [value, formatDisplay]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "flex w-full h-10 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors text-left",
            !value && "text-muted-foreground",
            className
          )}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <CalendarIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium text-foreground">
              {formattedDisplay || <span className="text-muted-foreground font-normal">{placeholder}</span>}
            </span>
          </div>

          {value && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={handleClear}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClear(); }}
              className="ml-2 p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              title="Clear date"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        className="w-auto p-0 border border-border shadow-2xl rounded-xl overflow-hidden bg-popover z-50"
        align="start"
      >
        {/* Month & Year Select Jump Bar */}
        <div className="flex items-center justify-between gap-2 p-3 border-b border-border/60 bg-muted/30">
          <Select
            value={String(dayjs(month).month())}
            onValueChange={(val) => {
              setMonth(dayjs(month).month(Number(val)).toDate());
            }}
          >
            <SelectTrigger className="h-8 text-xs font-medium w-[125px] bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-56 z-[60]">
              {MONTHS.map((m, idx) => (
                <SelectItem key={m} value={String(idx)} className="text-xs">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={String(dayjs(month).year())}
            onValueChange={(val) => {
              setMonth(dayjs(month).year(Number(val)).toDate());
            }}
          >
            <SelectTrigger className="h-8 text-xs font-mono font-medium w-[95px] bg-background border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-56 font-mono z-[60]">
              {years.map((y) => (
                <SelectItem key={y} value={String(y)} className="text-xs">
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Calendar Grid */}
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={handleSelect}
          month={month}
          onMonthChange={setMonth}
          initialFocus
          className="p-3"
        />

        {/* Footer with Clear & Today */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-border/60 bg-muted/20 text-xs">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleToday}
            className="h-7 px-2 text-xs font-medium text-primary hover:text-primary"
          >
            Today
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default DatePicker;

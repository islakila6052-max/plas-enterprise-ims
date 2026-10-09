// src/components/ui/SearchableSelect.jsx
import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import { Icon } from "@/components/ui/icons";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

/**
 * Debounced, searchable single-select combobox.
 *
 * The dropdown options are resolved asynchronously via `onSearch(query)` (which
 * should return a Promise resolving to an array of option objects). Typing is
 * debounced by 500ms so we never query the database on every keystroke.
 *
 * Props:
 *  - value:        currently selected option value (controlled)
 *  - displayText:  label to show when the dropdown is closed (e.g. selected name)
 *  - onSearch:     async (query: string) => Option[]   (Option = any object)
 *  - onSelect:     (option) => void
 *  - getOptionValue / getOptionLabel: accessors for an Option
 */
export default function SearchableSelect({
  label,
  value,
  displayText,
  onSearch,
  onSelect,
  getOptionValue = (o) => o.value,
  getOptionLabel = (o) => o.label,
  disabled = false,
  placeholder = "Search…",
  error,
  required = false,
  id,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef(null);
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;
  const debounced = useDebouncedValue(query, 500);

  useEffect(() => {
    let active = true;
    if (!open) return;
    setLoading(true);
    Promise.resolve(onSearchRef.current(debounced))
      .then((res) => {
        if (active) setOptions(res || []);
      })
      .catch(() => {
        if (active) setOptions([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [debounced, open]);

  useEffect(() => {
    function onDoc(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const shownText = open ? query : displayText || (value ? String(value) : "");

  return (
    <div className="w-full" ref={boxRef}>
      {label && (
        <label
          htmlFor={id}
          className="mb-1.5 block text-sm font-medium text-slate-700">
          {label}
          {required && <span className="text-red-500"> *</span>}
        </label>
      )}
      <div className="relative">
        <input
          id={id}
          type="text"
          autoComplete="off"
          disabled={disabled}
          value={shownText}
          placeholder={disabled ? "Select an institution first" : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => !disabled && setOpen(true)}
          className={cn(
            "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
            error && "border-red-400 focus:ring-red-400/30",
          )}
        />
        <Icon
          name="search"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
        />
        {open && !disabled && (
          <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {loading ? (
              <div className="px-3 py-2 text-sm text-slate-400">Searching…</div>
            ) : options.length === 0 ? (
              <div className="px-3 py-2 text-sm text-slate-400">No results</div>
            ) : (
              options.map((opt) => {
                const selected = String(getOptionValue(opt)) === String(value);
                return (
                  <button
                    type="button"
                    key={getOptionValue(opt)}
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                      onSelect(opt);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-2 text-left text-sm transition hover:bg-brand-50",
                      selected ? "bg-brand-50 text-brand-700" : "text-slate-700",
                    )}>
                    <span className="truncate">{getOptionLabel(opt)}</span>
                    {selected && <Icon name="checkCircle" className="h-4 w-4 shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

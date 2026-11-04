import { useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent, FocusEvent, InputHTMLAttributes, KeyboardEvent } from 'react';
import { formatInt } from './format';

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'max'>;

interface NumberFieldProps extends NativeProps {
  value: number;
  /** Called on every keystroke, so the plan updates while the user types. */
  onCommit: (value: number) => void;
  max?: number;
  /** When true an empty field means 0. Otherwise the last value stands until a digit is typed. */
  emptyIsZero?: boolean;
}

/** Whole-number input that keeps it-IT thousands separators while typing. */
export default function NumberField({
  value, onCommit, max = 99_999_999, emptyIsZero = false, ...inputProps
}: NumberFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const digitsBeforeCaret = useRef<number | null>(null);
  // The digits being typed; null when idle, so the store's value (slider, assistant) shows.
  const [draft, setDraft] = useState<string | null>(null);

  // Adding a separator shifts the text, so the caret is put back after the same digit.
  useLayoutEffect(() => {
    const input = inputRef.current;
    const wanted = digitsBeforeCaret.current;
    if (!input || wanted === null) return;
    digitsBeforeCaret.current = null;
    let position = 0;
    for (let seen = 0; position < input.value.length && seen < wanted; position += 1) {
      if (/\d/.test(input.value[position])) seen += 1;
    }
    input.setSelectionRange(position, position);
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const { value: typed, selectionStart } = event.target;
    digitsBeforeCaret.current = typed.slice(0, selectionStart ?? typed.length).replace(/\D/g, '').length;
    const digits = typed.replace(/\D/g, '');
    if (digits === '') {
      setDraft('');
      if (emptyIsZero) onCommit(0);
      return;
    }
    const next = Math.min(Number(digits), max);
    setDraft(String(next));
    onCommit(next);
  };

  const shown = draft === null ? formatInt(value) : draft === '' ? '' : formatInt(Number(draft));

  return (
    <input
      {...inputProps}
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={shown}
      onChange={handleChange}
      onFocus={(event: FocusEvent<HTMLInputElement>) => event.target.select()}
      onBlur={() => setDraft(null)}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  );
}

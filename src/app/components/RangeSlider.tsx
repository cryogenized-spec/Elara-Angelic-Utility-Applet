import { useState } from 'react';

type RangeSliderProps = {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  valueLabel: string;
  minLabel?: string;
  maxLabel?: string;
  onChange: (value: number) => void;
};

export function RangeSlider({ id, label, value, min, max, step = 1, valueLabel, minLabel, maxLabel, onChange }: RangeSliderProps) {
  const [hot, setHot] = useState(false);

  return (
    <div className="range-setting">
      <div className="range-setting__header">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{valueLabel}</output>
      </div>
      <input
        id={id}
        className={`range-input${hot ? ' is-hot' : ''}`}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setHot(true); }}
        onPointerUp={() => setHot(false)}
        onPointerCancel={() => setHot(false)}
        onKeyDown={(event) => {
          if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End' || event.key === 'PageUp' || event.key === 'PageDown') setHot(true);
        }}
        onKeyUp={() => setHot(false)}
        onBlur={() => setHot(false)}
      />
      <div className="range-setting__scale" aria-hidden="true"><span>{minLabel ?? min}</span><span>{maxLabel ?? max}</span></div>
    </div>
  );
}

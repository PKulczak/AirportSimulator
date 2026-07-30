import { useCallback, useEffect, useRef } from 'react';

export interface WeightClassMix {
  heavy: number;
  medium: number;
  light: number;
}

type Divider = 'heavyMedium' | 'mediumLight';

interface WeightClassMixSliderProps {
  /** Always assumed to sum to 100 — each divider drag preserves that by
   * construction (see `handlePointerMove`), so callers never need to
   * renormalize. */
  value: WeightClassMix;
  onChange: (value: WeightClassMix) => void;
}

const SEGMENT_STYLE = {
  heavy: { bg: 'bg-slate-700', text: 'text-white', label: 'Heavy' },
  medium: { bg: 'bg-slate-400', text: 'text-white', label: 'Medium' },
  light: { bg: 'bg-slate-200', text: 'text-slate-700', label: 'Light' },
} as const;

/** A single stacked bar (Heavy | Medium | Light, always summing to 100%) with
 * two draggable dividers instead of three separate percentage inputs —
 * dragging the left divider trades Heavy for Medium, the right divider
 * trades Medium for Light. Both pointer-drag (mouse/touch/pen, via the
 * Pointer Events API) and arrow-key nudging are supported on each divider. */
export default function WeightClassMixSlider({ value, onChange }: WeightClassMixSliderProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<Divider | null>(null);
  // Read via refs inside the window listener (attached once) rather than
  // depending on `value`/`onChange` directly — avoids tearing down and
  // re-attaching a window-level listener on every pixel of drag movement.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const heavyMediumBoundary = value.heavy;
  const mediumLightBoundary = value.heavy + value.medium;

  const percentFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track) {
      return 0;
    }
    const rect = track.getBoundingClientRect();
    const fraction = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return Math.round(Math.min(100, Math.max(0, fraction * 100)));
  }, []);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      const divider = draggingRef.current;
      if (!divider) {
        return;
      }
      const percent = percentFromClientX(event.clientX);
      const current = valueRef.current;
      const currentHeavyMedium = current.heavy;
      const currentMediumLight = current.heavy + current.medium;

      if (divider === 'heavyMedium') {
        const newHeavy = Math.min(percent, currentMediumLight);
        onChangeRef.current({
          heavy: newHeavy,
          medium: currentMediumLight - newHeavy,
          light: current.light,
        });
      } else {
        const newBoundary = Math.max(percent, currentHeavyMedium);
        onChangeRef.current({
          heavy: current.heavy,
          medium: newBoundary - currentHeavyMedium,
          light: 100 - newBoundary,
        });
      }
    }

    function stopDragging() {
      draggingRef.current = null;
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopDragging);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopDragging);
    };
  }, [percentFromClientX]);

  const startDragging = (divider: Divider) => (event: React.PointerEvent) => {
    event.preventDefault();
    draggingRef.current = divider;
    // Keeps reporting move/up events for this pointer even if it strays off
    // the small handle element mid-drag (most relevant on touch).
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const nudge = (divider: Divider, delta: number) => {
    if (divider === 'heavyMedium') {
      const newHeavy = Math.min(Math.max(0, value.heavy + delta), mediumLightBoundary);
      onChange({ heavy: newHeavy, medium: mediumLightBoundary - newHeavy, light: value.light });
    } else {
      const newBoundary = Math.min(
        Math.max(heavyMediumBoundary, mediumLightBoundary + delta),
        100,
      );
      onChange({
        heavy: value.heavy,
        medium: newBoundary - heavyMediumBoundary,
        light: 100 - newBoundary,
      });
    }
  };

  const handleKeyDown = (divider: Divider) => (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      nudge(divider, -1);
      event.preventDefault();
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      nudge(divider, 1);
      event.preventDefault();
    }
  };

  const dividerClass =
    'absolute inset-y-0 z-10 -ml-1.5 w-3 cursor-ew-resize touch-none rounded-sm ' +
    'border border-slate-500 bg-white shadow focus:outline-none focus-visible:ring-2 ' +
    'focus-visible:ring-brand-accent-active';

  return (
    <div
      ref={trackRef}
      className="relative h-10 w-full select-none overflow-hidden rounded-md border border-slate-300"
    >
      {(['heavy', 'medium', 'light'] as const).map((segment) => {
        const style = SEGMENT_STYLE[segment];
        const left = segment === 'heavy' ? 0 : segment === 'medium' ? heavyMediumBoundary : mediumLightBoundary;
        const width = value[segment];
        return (
          <div
            key={segment}
            className={`absolute inset-y-0 flex items-center justify-center overflow-hidden text-xs font-semibold ${style.bg} ${style.text}`}
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            {width >= 12 && (
              <span className="truncate px-1">
                {style.label} {width}%
              </span>
            )}
          </div>
        );
      })}

      <div
        role="slider"
        tabIndex={0}
        aria-label="Boundary between Heavy and Medium aircraft percentage"
        aria-valuemin={0}
        aria-valuemax={mediumLightBoundary}
        aria-valuenow={heavyMediumBoundary}
        aria-orientation="horizontal"
        onPointerDown={startDragging('heavyMedium')}
        onKeyDown={handleKeyDown('heavyMedium')}
        className={dividerClass}
        style={{ left: `${heavyMediumBoundary}%` }}
      />
      <div
        role="slider"
        tabIndex={0}
        aria-label="Boundary between Medium and Light aircraft percentage"
        aria-valuemin={heavyMediumBoundary}
        aria-valuemax={100}
        aria-valuenow={mediumLightBoundary}
        aria-orientation="horizontal"
        onPointerDown={startDragging('mediumLight')}
        onKeyDown={handleKeyDown('mediumLight')}
        className={dividerClass}
        style={{ left: `${mediumLightBoundary}%` }}
      />
    </div>
  );
}

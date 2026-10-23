import { useId } from 'react'
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form'

export type Option<T extends string | number> = { value: T; label: string }

/**
 * Segmented single choice (radio group): big touch targets, keyboard and screen reader friendly. `hint` is a short help
 * line under the legend (the group's description). More than six options wrap into rows, each target at least 44 px.
 */
export function ChoiceField<V extends FieldValues, T extends string | number>({
  control,
  name,
  legend,
  options,
  hint,
}: {
  control: Control<V, any, any>
  name: Path<V>
  legend: string
  options: readonly Option<T>[]
  hint?: string
}) {
  const id = useId()
  const wraps = options.length > 6
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const describedBy = [hint ? `${id}-hint` : null, fieldState.error ? `${id}-error` : null].filter(Boolean).join(' ')
        return (
          <div className="grid gap-2">
            <span id={`${id}-legend`} className="text-sm font-semibold text-muted">
              {legend}
            </span>
            {hint && (
              <span id={`${id}-hint`} className="-mt-1 text-sm text-muted">
                {hint}
              </span>
            )}
            <div
              role="radiogroup"
              aria-labelledby={`${id}-legend`}
              aria-describedby={describedBy || undefined}
              className={wraps ? 'flex flex-wrap gap-2' : 'flex gap-2'}
            >
              {options.map((option) => (
                <label key={option.value} className={wraps ? 'min-w-11 flex-1' : 'flex-1'}>
                  <input
                    type="radio"
                    name={field.name}
                    value={option.value}
                    checked={field.value === option.value}
                    onChange={() => field.onChange(option.value)}
                    onBlur={field.onBlur}
                    className="peer sr-only"
                  />
                  <span className="grid min-h-12 cursor-pointer place-items-center rounded-control border border-control-line bg-surface px-2 text-base font-medium tabular-nums transition-colors hover:bg-raised peer-checked:border-accent peer-checked:bg-accent peer-checked:font-bold peer-checked:text-on-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
                    {option.label}
                  </span>
                </label>
              ))}
            </div>
            {fieldState.error && (
              <p id={`${id}-error`} role="alert" className="text-sm text-danger">
                {fieldState.error.message}
              </p>
            )}
          </div>
        )
      }}
    />
  )
}

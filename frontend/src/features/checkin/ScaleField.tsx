import { useId } from 'react'
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form'

export type Option<T extends string | number> = { value: T; label: string }

/** Segmented single choice (radio group): big touch targets, keyboard and screen reader friendly. */
export function ChoiceField<V extends FieldValues, T extends string | number>({
  control,
  name,
  legend,
  options,
}: {
  control: Control<V, any, any>
  name: Path<V>
  legend: string
  options: readonly Option<T>[]
}) {
  const id = useId()
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <div className="grid gap-1.5">
          <span id={`${id}-legend`} className="text-sm font-medium">
            {legend}
          </span>
          <div
            role="radiogroup"
            aria-labelledby={`${id}-legend`}
            aria-describedby={fieldState.error ? `${id}-error` : undefined}
            className="flex gap-1.5"
          >
            {options.map((option) => (
              <label key={option.value} className="flex-1">
                <input
                  type="radio"
                  name={field.name}
                  value={option.value}
                  checked={field.value === option.value}
                  onChange={() => field.onChange(option.value)}
                  onBlur={field.onBlur}
                  className="peer sr-only"
                />
                <span className="grid min-h-11 cursor-pointer place-items-center rounded-control border border-line bg-surface px-2 text-base peer-checked:border-accent peer-checked:bg-accent peer-checked:font-semibold peer-checked:text-on-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
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
      )}
    />
  )
}

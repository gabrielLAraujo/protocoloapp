/** Shown by a second tab: the app runs in one tab at a time. */
export function OtherTabNotice() {
  return (
    <main className="mx-auto grid min-h-dvh max-w-md place-content-center gap-2 p-4 text-center">
      <p className="text-lg font-semibold">O app está aberto em outra aba.</p>
      <p className="text-sm text-muted">Use a outra aba, ou feche-a e recarregue esta.</p>
    </main>
  )
}

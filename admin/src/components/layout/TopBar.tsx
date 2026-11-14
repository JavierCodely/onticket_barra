import { ThemeToggle } from "@/features/theme/ThemeToggle"

export function TopBar() {
  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-background px-4">
      <span className="font-semibold tracking-tight">Onticket</span>
      <ThemeToggle />
    </header>
  )
}

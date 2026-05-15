import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";

/**
 * Auth layout — minimal, vibe-free.
 * Same hairline-bordered, type-led aesthetic as the marketing pages.
 * No gradient blobs, no grid washes, no glass.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex bg-background relative">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-[42%] bg-foreground dark:bg-surface relative flex-col justify-between p-12 border-r border-border">
        <div className="relative z-10">
          <Link href="/" className="flex items-center gap-3">
            <div className="relative w-8 h-8 bg-violet flex items-center justify-center">
              <span className="font-display font-black text-white text-sm leading-none">F</span>
            </div>
            <span className="font-display font-bold text-lg text-background dark:text-foreground tracking-tight">
              FORGE
            </span>
          </Link>
        </div>

        <div className="relative z-10 max-w-md">
          <p className="text-[10px] uppercase tracking-[0.18em] text-background/50 dark:text-muted font-medium mb-5">
            AI-powered workspace
          </p>
          <h2 className="font-display font-extrabold text-4xl text-background dark:text-foreground leading-[1.05] tracking-[-0.025em] mb-5">
            Write, search, organise — together with the AI that actually understands your project.
          </h2>
          <p className="text-background/55 dark:text-muted leading-relaxed text-[15px]">
            Persistent project memory. Reasoning when you need it. Verified citations. One workspace.
          </p>
        </div>

        <div className="relative z-10 flex gap-10 text-background/40 dark:text-muted text-[10px] uppercase tracking-[0.15em] font-medium">
          <span>200M+ sources</span>
          <span>DOI verified</span>
          <span>Persistent memory</span>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 relative">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>

        {/* Mobile logo */}
        <Link href="/" className="lg:hidden flex items-center gap-2.5 mb-10">
          <div className="relative w-7 h-7 bg-violet flex items-center justify-center">
            <span className="font-display font-black text-white text-xs leading-none">F</span>
          </div>
          <span className="font-display font-bold text-lg text-foreground tracking-tight">FORGE</span>
        </Link>

        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}

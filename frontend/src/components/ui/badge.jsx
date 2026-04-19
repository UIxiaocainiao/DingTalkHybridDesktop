import { cva } from "class-variance-authority";

import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-1 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-[hsl(var(--foreground))] text-[hsl(var(--background))]",
        secondary:
          "border-transparent bg-[hsl(var(--secondary))] text-[hsl(var(--secondary-foreground))]",
        outline:
          "border-[hsl(var(--border))] bg-transparent text-[hsl(var(--foreground))]",
        success:
          "border-transparent bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
        warning:
          "border-transparent bg-amber-500/14 text-amber-700 dark:text-amber-300",
        destructive:
          "border-transparent bg-red-500/12 text-red-600 dark:text-red-400",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  },
);

function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

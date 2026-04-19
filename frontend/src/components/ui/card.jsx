import { cn } from "../../lib/utils";

function Card({ className, ...props }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--card-foreground))]",
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }) {
  return <div className={cn("flex flex-col space-y-2 p-4", className)} {...props} />;
}

function CardTitle({ className, ...props }) {
  return <h3 className={cn("text-base font-semibold leading-none tracking-tight", className)} {...props} />;
}

function CardDescription({ className, ...props }) {
  return (
    <p
      className={cn("text-sm leading-6 text-[hsl(var(--muted-foreground))]", className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }) {
  return <div className={cn("p-4", className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent };

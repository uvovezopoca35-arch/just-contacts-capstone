import * as React from "react"
import { cn } from "@/lib/utils"

export interface NeoButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'pink' | 'outline' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
}

const NeoButton = React.forwardRef<HTMLButtonElement, NeoButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading, children, ...props }, ref) => {
    const variants = {
      primary: 'bg-accent-blue text-white',
      secondary: 'bg-accent-yellow text-black',
      pink: 'bg-accent-pink text-white',
      outline: 'bg-white text-black',
      danger: 'bg-red-500 text-white',
    };

    const sizes = {
      sm: 'px-3 py-1 text-xs',
      md: 'px-6 py-2 text-sm font-bold',
      lg: 'px-8 py-4 text-lg font-extrabold uppercase tracking-tight',
      icon: 'p-3 flex items-center justify-center',
    };

    return (
      <button
        ref={ref}
        disabled={isLoading || props.disabled}
        className={cn(
          "neo-brutalism-button flex items-center justify-center gap-2",
          variants[variant],
          sizes[size],
          isLoading && "opacity-70 cursor-not-allowed",
          className
        )}
        {...props}
      >
        {isLoading ? (
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
        ) : children}
      </button>
    );
  }
)
NeoButton.displayName = "NeoButton"

export { NeoButton }

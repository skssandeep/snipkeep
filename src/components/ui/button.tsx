import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Variants map to existing popup.css classes — no Tailwind required.
const buttonVariants = cva('', {
  variants: {
    variant: {
      default:     'btn-primary',
      outline:     'btn-ghost',
      destructive: 'btn-ghost danger',
      ghost:       'btn-ghost',
      secondary:   'btn-ghost',
      link:        'btn-ghost',
    },
    size: {
      default: '',
      sm:      'small',
      lg:      'full-width',
      icon:    '',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        className={cn(buttonVariants({ variant, size }), className)}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }

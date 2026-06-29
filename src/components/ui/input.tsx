import * as React from "react";

import { composeNoFileDropHandler } from "@/lib/file-input";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onDragEnter, onDragOver, onDrop, ...props }, ref) => {
    const isFileInput = type === "file";

    return (
      <input
        type={type}
        onDragEnter={isFileInput ? composeNoFileDropHandler(onDragEnter) : onDragEnter}
        onDragOver={isFileInput ? composeNoFileDropHandler(onDragOver) : onDragOver}
        onDrop={isFileInput ? composeNoFileDropHandler(onDrop) : onDrop}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
